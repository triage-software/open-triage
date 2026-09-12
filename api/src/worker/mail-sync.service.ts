import { ImapFlow } from 'imapflow';
import { PrismaService } from '../prisma.service';
import { QUEUES, JOBS } from './queues';
import type { Producer } from './producer';
import {
  mailboxConfig,
  imapFlowOptions,
  syncErrorText,
  type ImapConfig,
} from './mailbox-config';
import { parseIncomingMail } from './mail-parser';
import { statusAfterInbound, capThreadIds } from './threading';

const BATCH_SIZE = 20; // ported from the prototype (20 messages per batch)

export class MailSyncService {
  private readonly logger = new Logger(MailSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly producer: Producer,
  ) {}

  /** Enqueue a poll for every active mailbox with credentials. */
  async enqueuePollForAll(): Promise<number> {
    const mailboxes = await this.prisma.mailbox.findMany({
      where: { active: true, kind: 'imap' },
      select: { id: true },
    });
    let queued = 0;
    for (const mailbox of mailboxes) {
      const ok = await this.producer.enqueuePollMailbox(mailbox.id);
      if (ok) queued += 1;
    }
    return queued;
  }

  /**
   * Poll one mailbox via IMAP and upsert conversations/messages.
   * Cursor semantics ported from the prototype (mail-sync.ts): UIDVALIDITY
   * invalidates the cursor; UID ranges are inclusive and can reverse when the
   * start exceeds the newest UID — filtered explicitly so an empty increment
   * stays empty. The cursor commits only after the DB write succeeds.
   */
  async pollMailbox(mailboxId: string): Promise<{ fetched: number; imported: number }> {
    const mailbox = await this.prisma.mailbox.findUnique({ where: { id: mailboxId } });
    if (!mailbox || !mailbox.active) return { fetched: 0, imported: 0 };

    const config = mailboxConfig(mailbox, process.env.SESSION_SECRET ?? '');
    if (config.mode !== 'imap') {
      this.logger.warn(`mailbox ${mailbox.id}: ${config.error ?? 'unconfigured'}`);
      return { fetched: 0, imported: 0 };
    }

    const fetched = await this.fetchSince(config.imap, mailbox.imapUidValidity, mailbox.imapLastUid ?? 0);
    let imported = 0;
    for (const source of fetched) {
      try {
        imported += await this.importMessage(mailbox, source.uidValidity, source.uid, source.source, source.internalDate);
      } catch (err) {
        // One poisoned message must not stop the rest of the batch.
        this.logger.error(`mailbox ${mailbox.id} uid ${source.uid}: import failed — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await this.prisma.mailbox.update({
      where: { id: mailbox.id },
      data: { lastSyncAt: new Date() },
    });
    this.logger.log(`mailbox ${mailbox.id}: fetched ${fetched.length}, imported ${imported}`);
    return { fetched: fetched.length, imported };
  }

  private async fetchSince(
    config: ImapConfig,
    storedUidValidity: string | null,
    storedLastUid: number,
  ): Promise<{ uidValidity: string; uid: number; source: Buffer; internalDate?: Date }[]> {
    const client = new ImapFlow(imapFlowOptions(config));
    // ImapFlow emits transport errors as well as rejecting pending operations.
    client.on('error', () => {});
    const deadline = setTimeout(() => client.close(), 120_000);
    deadline.unref();
    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX', { readOnly: true });
      try {
        if (!client.mailbox) throw new Error('No mailbox selected');
        const uidValidity = String(client.mailbox.uidValidity);
        const lastUid = storedUidValidity === uidValidity ? storedLastUid : 0;
        // UID ranges are inclusive and can reverse when the start exceeds the
        // newest UID — filter explicitly so an empty increment stays empty.
        const found = await client.search({ uid: `${lastUid + 1}:*` }, { uid: true });
        const uids = (found || []).filter((uid) => uid > lastUid).sort((a, b) => a - b);
        const out: { uidValidity: string; uid: number; source: Buffer; internalDate?: Date }[] = [];
        for (const uid of uids.slice(0, BATCH_SIZE)) {
          const message = await client.fetchOne(
            String(uid),
            { source: true, internalDate: true },
            { uid: true },
          );
          if (message && typeof message === 'object' && message.source) {
            out.push({
              uidValidity,
              uid,
              source: message.source,
              internalDate:
                typeof message === 'object' && message.internalDate instanceof Date
                  ? message.internalDate
                  : undefined,
            });
          }
        }
        return out;
      } finally {
        lock.release();
      }
    } finally {
      clearTimeout(deadline);
      client.close();
    }
  }

  /** Idempotent import of one raw message (dedupe by Message-ID / delivery key). */
  private async importMessage(
    mailbox: { id: string; tenantId: string },
    uidValidity: string,
    uid: number,
    source: Buffer,
    internalDate?: Date,
  ): Promise<number> {
    const parsed = await parseIncomingMail(source, internalDate);
    if (!parsed.from) return 0; // no sender → cannot attach to a customer
    const deliveryKey = `imap:${mailbox.id}:${uidValidity}:${uid}`;

    // Advance the cursor even for ignored duplicates — the UID is consumed.
    const advanceCursor = () =>
      this.prisma.mailbox.update({
        where: { id: mailbox.id },
        data: {
          imapUidValidity: uidValidity,
          imapLastUid: Math.max(uid, 0),
        },
      });

    const existing = await this.prisma.message.findFirst({
      where: { tenantId: mailbox.tenantId, deliveryKey },
      select: { id: true },
    });
    if (existing) {
      await advanceCursor();
      return 0;
    }

    // Threading: References/In-Reply-To → newest matching conversation;
    // else an open conversation with the same customer on this mailbox;
    // else a new conversation.
    const conversations = await this.prisma.conversation.findMany({
      where: { tenantId: mailbox.tenantId, mailboxId: mailbox.id },
      orderBy: { lastMessageAt: 'desc' },
      select: { id: true, messageIds: true, status: true, customerEmail: true },
    });
    let matched: string | null = null;
    for (const conversation of conversations) {
      if (isThreadMatch(parsed.references, conversation)) {
        matched = conversation.id;
        break;
      }
    }
    if (!matched) {
      const byCustomer = conversations.find((c) => c.customerEmail === parsed.from);
      matched = byCustomer?.id ?? null;
    }

    const messageId = parsed.messageId;
    const messageIds = capThreadIds([
      ...(matched ? (conversations.find((c) => c.id === matched)?.messageIds ?? []) : []),
      ...(messageId ? [messageId] : []),
    ]);

    const messageData = {
      tenantId: mailbox.tenantId,
      direction: 'in' as const,
      authorType: 'customer' as const,
      authorName: parsed.fromName ?? parsed.from,
      body: parsed.body,
      messageId: messageId ?? undefined,
      inReplyTo: parsed.inReplyTo ?? undefined,
      sentAt: parsed.date,
      deliveryKey,
    };

    let finalConversationId: string;
    if (matched === null) {
      // Nested create keeps the Message row inside the same transaction and
      // resolves the relation without knowing the id up front.
      const created = await this.prisma.conversation.create({
        data: {
          tenantId: mailbox.tenantId,
          mailboxId: mailbox.id,
          subject: parsed.subject,
          customerEmail: parsed.from,
          messageIds,
          references: capThreadIds(parsed.references),
          lastMessageAt: parsed.date,
          messages: { create: messageData },
        },
        select: { id: true },
      });
      finalConversationId = created.id;
      await advanceCursor();
    } else {
      const conversationId = matched;
      finalConversationId = conversationId;
      await this.prisma.$transaction([
        this.prisma.conversation.update({
          where: { id: conversationId },
          data: {
            lastMessageAt: parsed.date,
            status: statusAfterInbound(
              (conversations.find((c) => c.id === conversationId)?.status ?? 'open') as 'open',
            ),
            ...(messageId ? { messageIds: { push: messageId } } : {}),
            references: { set: capThreadIds([...parsed.references]) },
          },
        }),
        this.prisma.message.create({
          data: { conversationId, ...messageData },
        }),
        advanceCursor(),
      ]);
    }

    // Triggers AI classification (fire-and-forget; degrades without Redis).
    await this.producer.enqueueClassify(mailbox.tenantId, finalConversationId);
    return 1;
  }
}

import { Logger } from '@nestjs/common';
import { isThreadMatch } from './threading';