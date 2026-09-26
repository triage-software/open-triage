import { Worker } from 'bullmq';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { KnowledgeIndexService } from '../knowledge/knowledge-index.service';
import { WorkerModule } from './worker.module';
import { Producer } from './producer';
import { MailSyncService } from './mail-sync.service';
import { MailSendService } from './mail-send.service';
import { NotificationService } from './notifications.service';
import { AiTriageService } from './ai-triage.service';
import { QUEUES, JOBS } from './queues';
import type { Redis } from 'ioredis';
import type {
  SendReplyPayload,
  SentCopyPayload,
  InviteMailPayload,
  VerifyMailPayload,
  PasswordResetMailPayload,
  DraftPayload,
} from './producer';

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 30_000);
const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

/**
 * Standalone worker entrypoint (docker-compose `worker` service): boots a Nest
 * application context for DI, then starts BullMQ consumers. A repeatable
 * self-rescheduling job on ot-mail-sync drives IMAP polling for all mailboxes.
 * Without REDIS_URL the worker exits cleanly — the compose stack always ships
 * redis, and local dev without redis keeps the MVP fallbacks.
 */
async function bootstrap() {
  const logger = new Logger('worker');
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['log', 'error', 'warn'],
  });
  app.enableShutdownHooks();

  const producer = app.get(Producer);
  const connection = producer.connectionForWorkers();
  if (!connection) {
    logger.warn('REDIS_URL not set — worker idles (no consumers). MVP fallbacks stay active.');
    return;
  }

  const mailSync = app.get(MailSyncService);
  const mailSend = app.get(MailSendService);
  const notifications = app.get(NotificationService);
  const ai = app.get(AiTriageService);

  const pollWorker = new Worker(
    QUEUES.mailSync,
    async (job) => {
      const data = job.data as { mailboxId?: string; all?: boolean };
      if (data.all) {
        const queued = await mailSync.enqueuePollForAll();
        logger.log(`poll-all: enqueued ${queued} mailbox poll(s)`);
        return;
      }
      if (data.mailboxId) {
        await mailSync.pollMailbox(data.mailboxId);
      }
    },
    { connection: connection as Redis, concurrency: 2 },
  );

  const sendWorker = new Worker(
    QUEUES.mailSend,
    async (job) => {
      if (job.name === JOBS.sendReply) {
        const result = await mailSend.sendReply(job.data as SendReplyPayload);
        if (result.alreadyDone) logger.log(`send ${job.id}: already delivered (idempotent)`);
        return;
      }
      if (job.name === JOBS.sentCopy) {
        await mailSend.appendSentCopy(job.data as SentCopyPayload);
        return;
      }
      logger.warn(`mail-send: unknown job ${job.name}`);
    },
    { connection: connection as Redis, concurrency: 2 },
  );

  const notificationWorker = new Worker(
    QUEUES.notification,
    async (job) => {
      if (job.name === JOBS.inviteMail) {
        await notifications.sendInviteMail(job.data as InviteMailPayload, APP_URL);
        return;
      }
      if (job.name === JOBS.verifyMail) {
        await notifications.sendVerifyMail(job.data as VerifyMailPayload, APP_URL);
        return;
      }
      if (job.name === JOBS.passwordResetMail) {
        await notifications.sendPasswordResetMail(job.data as PasswordResetMailPayload, APP_URL);
        return;
      }
      logger.warn(`notification: unknown job ${job.name}`);
    },
    { connection: connection as Redis, concurrency: 2 },
  );

  const aiWorker = new Worker(
    QUEUES.ai,
    async (job) => {
      if (job.name === JOBS.classify) {
        const data = job.data as { tenantId: string; conversationId: string };
        await ai.classify(data.tenantId, data.conversationId);
        return;
      }
      if (job.name === JOBS.draft) {
        const data = job.data as DraftPayload;
        await ai.draft(data.tenantId, data.conversationId, data.userId);
        return;
      }
      logger.warn(`ai: unknown job ${job.name}`);
    },
    { connection: connection as Redis, concurrency: 1 },
  );

  // Repeatable scheduler: enqueues poll-all every interval (survives restarts).
  await producer.enqueuePollAllScheduler(POLL_INTERVAL_MS);

  const workers = [pollWorker, sendWorker, notificationWorker, aiWorker];
  for (const worker of workers) {
    worker.on('failed', (job, err) => {
      // A transport error may contain message data. Reset-link details must
      // never enter logs; the hashed job identity still identifies the failure.
      const reason = job?.name === JOBS.passwordResetMail ? 'password reset delivery failed' : err.message;
      logger.warn(`${worker.name} job ${job?.id ?? '?'} failed: ${reason}`);
    });
  }
  logger.log(`worker ready (poll every ${POLL_INTERVAL_MS / 1000}s, queues: ${Object.values(QUEUES).join(', ')})`);

  const shutdown = async (signal: string) => {
    logger.log(`${signal} received — shutting workers down`);
    for (const worker of workers) {
      try {
        await worker.close();
      } catch {
        /* already closed */
      }
    }
    await producer.close();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void bootstrap();