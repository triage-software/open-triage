import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  mailboxConfig,
  imapFlowOptions,
  type SmtpConfig,
  type ImapConfig,
} from './mailbox-config';
import { composeReplyRaw } from './mail-composer';
import { statusAfterAgentSend, capThreadIds, outboundMessageId, replySubject } from './threading';
import type { Producer, SendReplyPayload, SentCopyPayload } from './producer';

/**
 * SMTP send ported from the proven prototype (mail-delivery.ts + mail-send.ts):
 *  1. compose raw MIME once, 2. send via SMTP with explicit envelope,
 *  3. store Message row (commit), 4. copy to IMAP Sent folder (retryable).
 * Only the Sent copy is retried — the public reply is never re-sent.
 * Idempotency: Message.deliveryKey (unique) is the send identity; a repeated
 * job finds the stored row and only tops up the Sent-copy side task.
 */
export class MailSendService {
  private readonly logger = new Logger(MailSendService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly producer: Producer,
  ) {}

  async sendReply(payload: SendReplyPayload): Promise<{ alreadyDone: boolean }> {
    // deliveryKey format: `send-<uuid>`; RFC Message-ID derives from the uuid.
    const uuid = payload.deliveryKey.replace(/^send-/, '');
    const messageId = outboundMessageId(uuid, payload.from);

    const existing = await this.prisma.message.findUnique({
      where: { deliveryKey: payload.deliveryKey },
      select: { id: true, sentCopyFolder: true },
    });
    if (existing) {
      // Reply stored; if the Sent copy never landed, requeue just the copy.
      if (!existing.sentCopyFolder) {
        await this.queueSentCopy(payload, messageId);
      }
      return { alreadyDone: true };
    }

    const conversation = await this.prisma.conversation.findFirst({
      where: { id: payload.conversationId, tenantId: payload.tenantId },
      select: { id: true, mailboxId: true, subject: true, status: true, messageIds: true, customerEmail: true },
    });
    if (!conversation) throw new Error('conversation not found');
    const mailbox = await this.prisma.mailbox.findUnique({ where: { id: conversation.mailboxId } });
    if (!mailbox) throw new Error('mailbox not found');
    const config = mailboxConfig(mailbox, process.env.SESSION_SECRET ?? '');
    if (config.mode !== 'imap') throw new Error('mailbox not connected');
    if (!config.smtp) throw new Error('SMTP not configured for this mailbox');
    if (!payload.to || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(payload.to)) {
      throw new Error('conversation has no valid recipient address');
    }
    if (!payload.body.trim()) throw new Error('reply body is empty');

    const references = capThreadIds([
      ...payload.references,
      ...(payload.inReplyTo ? [payload.inReplyTo] : []),
    ]);
    const raw = await composeReplyRaw({
      from: payload.from,
      fromName: payload.fromName,
      to: payload.to,
      subject: replySubject(payload.subject),
      body: payload.body,
      messageId,
      inReplyTo: payload.inReplyTo,
      references,
      date: new Date(payload.date),
    });

    await this.smtpSend(config.smtp, payload.from, [payload.to], raw);

    // SMTP accepted → commit. A failure below must never re-send.
    await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          tenantId: payload.tenantId,
          conversationId: payload.conversationId,
          direction: 'out',
          authorType: 'agent',
          authorUserId: payload.userId,
          authorName: payload.fromName ?? payload.from,
          body: payload.body,
          messageId,
          inReplyTo: payload.inReplyTo ?? undefined,
          sentAt: new Date(payload.date),
          deliveryKey: payload.deliveryKey,
        },
      }),
      this.prisma.conversation.update({
        where: { id: payload.conversationId },
        data: {
          lastMessageAt: new Date(payload.date),
          status: statusAfterAgentSend(conversation.status as 'open'),
          messageIds: { push: messageId },
          references: { set: references },
        },
      }),
    ]);
    this.logger.log(`reply delivered: conversation ${payload.conversationId} (${payload.deliveryKey})`);

    await this.queueSentCopy(payload, messageId, raw);
    return { alreadyDone: false };
  }

  /** Append the raw message to the mailbox's Sent folder (idempotent). */
  async appendSentCopy(payload: SentCopyPayload): Promise<void> {
    const mailbox = await this.prisma.mailbox.findUnique({ where: { id: payload.mailboxId } });
    if (!mailbox) throw new Error('mailbox not found');
    const config = mailboxConfig(mailbox, process.env.SESSION_SECRET ?? '');
    if (config.mode !== 'imap') throw new Error('mailbox not connected');

    const existing = await this.prisma.message.findUnique({
      where: { deliveryKey: payload.deliveryKey },
      select: { sentCopyFolder: true },
    });
    if (existing?.sentCopyFolder) return; // copy already recorded

    const raw = Buffer.from(payload.raw, 'base64');
    const folder = await this.appendSent(config.imap, raw, new Date(payload.date), mailbox.sentFolder);
    await this.prisma.message.update({
      where: { deliveryKey: payload.deliveryKey },
      data: { sentCopyFolder: folder },
    });
    this.logger.log(`sent copy appended for ${payload.deliveryKey} → ${folder}`);
  }

  private async queueSentCopy(payload: SendReplyPayload, messageId: string, raw?: Buffer): Promise<void> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: payload.conversationId },
      select: { mailboxId: true },
    });
    if (!conversation) return;
    const finalRaw =
      raw ??
      (await composeReplyRaw({
        from: payload.from,
        fromName: payload.fromName,
        to: payload.to,
        subject: replySubject(payload.subject),
        body: payload.body,
        messageId,
        inReplyTo: payload.inReplyTo,
        references: capThreadIds([...payload.references, ...(payload.inReplyTo ? [payload.inReplyTo] : [])]),
        date: new Date(payload.date),
      }));
    await this.producer.enqueueSentCopy({
      deliveryKey: payload.deliveryKey,
      mailboxId: conversation.mailboxId,
      raw: finalRaw.toString('base64'),
      date: payload.date,
    });
  }

  private async smtpSend(config: SmtpConfig, from: string, to: string[], raw: Buffer): Promise<void> {
    const transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
      logger: false,
      debug: false,
    });
    try {
      const result = await transport.sendMail({ envelope: { from, to }, raw });
      const accepted = result.accepted.map((a) => a.toString().toLowerCase());
      if (!to.every((t) => accepted.includes(t.toLowerCase()))) {
        throw Object.assign(new Error('recipient rejected'), { code: 'EENVELOPE' });
      }
    } finally {
      transport.close();
    }
  }

  /** Append raw mail into the Sent folder; reconcile uncertain ACKs first. */
  private async appendSent(
    config: ImapConfig,
    raw: Buffer,
    date: Date,
    configuredFolder: string | null,
  ): Promise<string> {
    const client = new ImapFlow(imapFlowOptions(config));
    client.on('error', () => {});
    try {
      await client.connect();
      const folders = await client.list();
      const folder = folders.find((item) =>
        configuredFolder ? item.path === configuredFolder : item.specialUse === '\\Sent',
      )?.path;
      if (!folder) throw new Error('Sent folder unavailable');
      const lock = await client.getMailboxLock(folder, { readOnly: true });
      try {
        // Reconcile uncertain APPEND acknowledgements before creating a duplicate.
        const message = this.messageIdFromRaw(raw);
        const existing = message
          ? await client.search({ header: { 'message-id': message } }, { uid: true })
          : [];
        if (existing === false) throw new Error('Cannot confirm whether the sent copy exists');
        if ((existing?.length ?? 0) > 0) return folder;
        const result = await client.append(folder, raw, ['\\Seen'], date);
        if (!result) throw new Error('Sent copy not acknowledged');
        return folder;
      } finally {
        lock.release();
      }
    } finally {
      client.close();
    }
  }

  private messageIdFromRaw(raw: Buffer): string | null {
    const header = raw.toString('utf8').slice(0, 8192);
    const match = header.match(/^Message-ID:\s*(<[^>]+>)\s*$/im);
    return match?.[1] ?? null;
  }
}