import { Queue } from 'bullmq';
import IORedis, { Redis } from 'ioredis';

/** Queue names — one BullMQ queue per concern (SPEC-0001 worker topology). */
export const QUEUES = {
  mailSync: 'ot-mail-sync',
  mailSend: 'ot-mail-send',
  notification: 'ot-notification',
  ai: 'ot-ai',
} as const;

/** Job names inside each queue (processors dispatch on job.name). */
export const JOBS = {
  // ot-mail-sync
  tick: 'tick',
  // ot-mail-send
  sendReply: 'send-reply',
  sentCopy: 'sent-copy',
  // ot-notification
  inviteMail: 'invite-mail',
  verifyMail: 'verify-mail',
  // ot-ai
  classify: 'classify',
  draft: 'draft',
} as const;

/**
 * A shared Redis connection for BullMQ. Returns null when REDIS_URL is not
 * configured — producers then degrade to the documented MVP fallbacks
 * (setupToken in the invite response, verify token in server logs) instead of
 * failing tenant flows.
 */
export function createConnection(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  // maxRetriesPerRequest: null is required by BullMQ blocking operations.
  return new IORedis(url, { maxRetriesPerRequest: null, lazyConnect: false });
}

export function createQueue(name: string, connection: Redis | null): Queue | null {
  return connection ? new Queue(name, { connection }) : null;
}