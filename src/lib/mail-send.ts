import "server-only";
import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { smtpConfig } from "./mail-config";
import { deliverReply } from "./mail-delivery";
import { saveSentMessage } from "./mail-sent";
import type { OutgoingMail } from "./types";
import {
  ActionError, prepareOutgoingReply, claimOutgoingReply, acceptOutgoingReply,
  failOutgoingReply, getOutgoingMail, getState, saveSentCopy, recoverOutgoingReplies,
} from "./store";

type SendRuntime = {
  active: Map<string, Promise<void>>;
  initial?: Promise<void>;
  copying?: Promise<void>;
};
const shared = globalThis as typeof globalThis & { openTriageSending?: SendRuntime };
const runtime: SendRuntime = (shared.openTriageSending ??= { active: new Map() });

function initialize() {
  return runtime.initial ??= recoverOutgoingReplies([]);
}

async function appendSentCopy(job: OutgoingMail, raw: Buffer) {
  const client = new ImapFlow({
    host: process.env.TRIAGE_IMAP_HOST!, port: Number(process.env.TRIAGE_IMAP_PORT || 993), secure: true,
    auth: { user: "support@example.com", pass: process.env.TRIAGE_IMAP_PASSWORD! },
    logger: false, disableAutoIdle: true, connectionTimeout: 15_000,
    greetingTimeout: 15_000, socketTimeout: 30_000,
  });
  client.on("error", () => {});
  try {
    await client.connect();
    return await saveSentMessage(client, job, raw, process.env.TRIAGE_IMAP_SENT_FOLDER);
  } finally {
    client.close();
  }
}

function deliver(job: OutgoingMail) {
  const existing = runtime.active.get(job.requestId);
  if (existing) return existing;
  const pending = deliverReply(job, {
    claim: (raw) => claimOutgoingReply(job.requestId, raw),
    send: async (raw) => {
      const config = smtpConfig();
      if (!config) throw Object.assign(new Error("SMTP unavailable"), { code: "EAUTH" });
      const transport = nodemailer.createTransport(config);
      try {
        const result = await transport.sendMail({
          envelope: { from: job.email.from, to: [job.email.to] }, raw,
        });
        if (!result.accepted.some((address) => address.toString().toLowerCase() === job.email.to.toLowerCase()))
          throw Object.assign(new Error("Recipient rejected"), { code: "EENVELOPE" });
      } finally {
        transport.close();
      }
    },
    accept: () => acceptOutgoingReply(job.requestId),
    fail: (unknown, message) => failOutgoingReply(job.requestId, unknown, message),
    copy: (raw) => appendSentCopy(job, raw),
    saveCopy: (folder) => saveSentCopy(job.requestId, folder),
  }).finally(() => runtime.active.delete(job.requestId));
  runtime.active.set(job.requestId, pending);
  return pending;
}

export async function sendMailboxReply(input: unknown) {
  await initialize();
  const job = await prepareOutgoingReply(input);
  try {
    await deliver(job);
  } catch (error) {
    if (error instanceof ActionError && error.code === "DELIVERY_UNKNOWN") {
      try {
        const current = (await getOutgoingMail(job.requestId))[0];
        if (current?.status === "sending")
          await failOutgoingReply(job.requestId, true, error.message);
      } catch { /* A full disk can also prevent persisting the unknown result. */ }
    }
    if (error instanceof ActionError) throw error;
    // Never leak SMTP/IMAP responses or message bodies in API error logs.
    throw new ActionError("Nie udało się potwierdzić całej operacji. Ponów sprawdzenie tej samej wysyłki.", 409, "DELIVERY_UNKNOWN");
  }
  return getState();
}

export function retrySentCopies() {
  return runtime.copying ??= (async () => {
    await initialize();
    const pending = await getOutgoingMail();
    await Promise.allSettled(pending.slice(0, 3).map(deliver));
  })().finally(() => { runtime.copying = undefined; });
}
