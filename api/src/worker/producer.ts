import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Queue } from 'bullmq';
import { QUEUES, JOBS, createConnection, createQueue } from './queues';
import type { Redis } from 'ioredis';

/**
 * Central place where API + worker enqueue mail/AI jobs. Every producer call
 * degrades gracefully to `false` when Redis is unavailable — callers fall back
 * to the documented MVP behavior (invite setupToken in the response, verify
 * token in server logs, synchronous AI draft). Password reset has no token
 * fallback and requires configured SMTP delivery.
 */
@Injectable()
export class Producer {
  private readonly connection: Redis | null;
  private readonly mailSync: Queue | null;
  private readonly mailSend: Queue | null;
  private readonly notification: Queue | null;
  private readonly ai: Queue | null;

  constructor() {
    this.connection = createConnection();
    this.mailSync = createQueue(QUEUES.mailSync, this.connection);
    this.mailSend = createQueue(QUEUES.mailSend, this.connection);
    this.notification = createQueue(QUEUES.notification, this.connection);
    this.ai = createQueue(QUEUES.ai, this.connection);
  }

  get available(): boolean {
    return this.connection !== null;
  }

  /** Reset tokens have no response/log fallback: queued SMTP delivery is required. */
  get passwordResetDeliveryEnabled(): boolean {
    const host = process.env.SMTP_SYSTEM_HOST ?? process.env.SMTP_HOST;
    const from = process.env.SMTP_SYSTEM_FROM ?? process.env.SMTP_FROM;
    return this.notification !== null && Boolean(host && from);
  }

  /** Shared connection for Worker instances (null → run consumers disabled). */
  connectionForWorkers(): Redis | null {
    return this.connection;
  }

  async close(): Promise<void> {
    await Promise.allSettled([
      this.mailSync?.close(),
      this.mailSend?.close(),
      this.notification?.close(),
      this.ai?.close(),
      this.connection?.quit(),
    ]);
  }

  async enqueuePollMailbox(mailboxId: string): Promise<boolean> {
    if (!this.mailSync) return false;
    try {
      await this.mailSync.add(JOBS.tick, { mailboxId }, { jobId: `poll-${mailboxId}`, removeOnComplete: true, removeOnFail: 500 });
      return true;
    } catch {
      return false;
    }
  }

  async enqueuePollAll(): Promise<boolean> {
    if (!this.mailSync) return false;
    try {
      await this.mailSync.add(JOBS.tick, { all: true }, { jobId: 'poll-all', removeOnComplete: true, removeOnFail: 500 });
      return true;
    } catch {
      return false;
    }
  }

  async enqueueSendReply(payload: SendReplyPayload): Promise<boolean> {
    if (!this.mailSend) return false;
    try {
      await this.mailSend.add(
        JOBS.sendReply,
        payload,
        // Idempotency: the deliveryKey IS the job identity; completed jobs are
        // kept so a duplicate enqueue is deduplicated by BullMQ itself.
        { jobId: payload.deliveryKey, removeOnComplete: 1000, removeOnFail: 500, attempts: 1 },
      );
      return true;
    } catch {
      return false;
    }
  }

  async enqueueSentCopy(payload: SentCopyPayload): Promise<boolean> {
    if (!this.mailSend) return false;
    try {
      await this.mailSend.add(JOBS.sentCopy, payload, { jobId: `copy-${payload.deliveryKey}`, removeOnComplete: 1000, removeOnFail: 500, attempts: 5 });
      return true;
    } catch {
      return false;
    }
  }

  async enqueueInviteMail(payload: InviteMailPayload): Promise<boolean> {
    // No system SMTP configured → the worker could not deliver; the caller
    // must keep the MVP fallback (setupToken in the response).
    if (!process.env.SMTP_SYSTEM_HOST) return false;
    if (!this.notification) return false;
    try {
      await this.notification.add(JOBS.inviteMail, payload, { jobId: `invite-${payload.token}`, removeOnComplete: 500, removeOnFail: 500, attempts: 3 });
      return true;
    } catch {
      return false;
    }
  }

  async enqueueVerifyMail(payload: VerifyMailPayload): Promise<boolean> {
    // Same rule as invite mail: no system SMTP → log-token fallback.
    if (!process.env.SMTP_SYSTEM_HOST) return false;
    if (!this.notification) return false;
    try {
      await this.notification.add(JOBS.verifyMail, payload, { jobId: `verify-${payload.token}`, removeOnComplete: 500, removeOnFail: 500, attempts: 3 });
      return true;
    } catch {
      return false;
    }
  }

  async enqueuePasswordResetMail(payload: PasswordResetMailPayload): Promise<boolean> {
    if (!this.passwordResetDeliveryEnabled || !this.notification) return false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      // Shared worker connections retry indefinitely. Bound this public request
      // so a Redis outage cannot leave the reset form pending forever. A late
      // enqueue may still occur; callers invalidate the token on a false result.
      return await Promise.race([
        this.notification.add(JOBS.passwordResetMail, payload, {
          jobId: `password-reset-${createHash('sha256').update(payload.token).digest('hex')}`,
          removeOnComplete: true,
          removeOnFail: true,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
        }).then(() => true),
        new Promise<boolean>((resolve) => {
          timeout = setTimeout(() => resolve(false), 5000);
        }),
      ]);
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  async enqueueClassify(tenantId: string, conversationId: string): Promise<boolean> {
    if (!this.ai) return false;
    try {
      await this.ai.add(JOBS.classify, { tenantId, conversationId }, { jobId: `classify-${conversationId}`, removeOnComplete: 500, removeOnFail: 500, attempts: 3 });
      return true;
    } catch {
      return false;
    }
  }

  async enqueueDraft(payload: DraftPayload, jobId?: string): Promise<boolean> {
    if (!this.ai) return false;
    try {
      await this.ai.add(JOBS.draft, payload, { ...(jobId ? { jobId } : {}), removeOnComplete: 500, removeOnFail: 500, attempts: 1 });
      return true;
    } catch {
      return false;
    }
  }

  /** Upserts the repeatable poll-all scheduler job (worker startup). */
  async enqueuePollAllScheduler(everyMs: number): Promise<boolean> {
    if (!this.mailSync) return false;
    try {
      await this.mailSync.upsertJobScheduler(
        'poll-all-scheduler',
        { every: everyMs },
        { name: JOBS.tick, data: { all: true }, opts: { removeOnComplete: true, removeOnFail: 500 } },
      );
      return true;
    } catch {
      return false;
    }
  }
}

export interface SendReplyPayload {
  deliveryKey: string;
  tenantId: string;
  conversationId: string;
  messageId: string;
  inReplyTo: string | null;
  references: string[];
  from: string;
  fromName: string | null;
  to: string;
  subject: string;
  body: string;
  userId: string;
  date: string;
}

export interface SentCopyPayload {
  deliveryKey: string;
  mailboxId: string;
  raw: string; // base64
  date: string;
}

export interface InviteMailPayload {
  tenantId: string;
  email: string;
  token: string;
  locale: string;
  inviterName: string | null;
  tenantName: string;
}

export interface VerifyMailPayload {
  email: string;
  token: string;
  locale: string;
}

export interface PasswordResetMailPayload {
  email: string;
  token: string;
  locale: string;
  accountName: string;
}

export interface DraftPayload {
  tenantId: string;
  conversationId: string;
  userId: string;
}