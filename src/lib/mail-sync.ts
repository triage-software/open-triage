import "server-only";
import { ImapFlow } from "imapflow";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getMailSync, saveMailSync } from "./store";
import { parseIncomingMail } from "./mail-parser";
import type { IncomingMail } from "./mail-import";
import { retrySentCopies } from "./mail-send";
import { startAiTriage } from "./ai-triage-service";

const intervalMs = 30_000;
type SyncRuntime = {
  timer?: ReturnType<typeof setInterval>;
  pending?: Promise<void>;
  run?: () => Promise<void>;
};
const shared = globalThis as typeof globalThis & { openTriageMailSync?: SyncRuntime };
const runtime = (shared.openTriageMailSync ??= {});

function settings() {
  const password = process.env.TRIAGE_IMAP_PASSWORD;
  const host = process.env.TRIAGE_IMAP_HOST;
  const user = process.env.TRIAGE_IMAP_USER;
  if (!password || !host || user !== "test@sellersk.it") return null;
  return { password, host, user, port: Number(process.env.TRIAGE_IMAP_PORT || 993) };
}

function syncError(error: unknown) {
  const failure = error as { authenticationFailed?: boolean; code?: string };
  if (failure.authenticationFailed) return "Serwer odrzucił login lub hasło do skrzynki.";
  if (failure.code === "ENOTFOUND") return "Nie można odnaleźć serwera IMAP.";
  if (["ETIMEDOUT", "ETIMEOUT"].includes(failure.code ?? ""))
    return "Serwer IMAP nie odpowiedział na czas. Ponawiamy co 30 s.";
  // Protocol error objects can include credentials or mail content. Never expose
  // them through the API, state files, or development console.
  return "Nie udało się pobrać poczty. Ponawiamy co 30 s; zapisane maile pozostają w panelu.";
}

async function receive() {
  const config = settings();
  if (!config) {
    await saveMailSync({ status: "unconfigured", error: undefined });
    return;
  }
  await saveMailSync({
    status: "syncing",
    lastAttemptAt: new Date().toISOString(),
    error: undefined,
  });
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: true,
    auth: { user: config.user, pass: config.password },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 25_000,
  });
  // ImapFlow emits transport errors as well as rejecting pending operations.
  client.on("error", () => {});
  const deadline = setTimeout(() => client.close(), 120_000);
  deadline.unref();
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try {
      if (!client.mailbox) throw new Error("No mailbox selected");
      const uidValidity = String(client.mailbox.uidValidity);
      const cursor = await getMailSync();
      let lastUid = cursor?.uidValidity === uidValidity ? cursor.lastUid ?? 0 : 0;
      // UID ranges are inclusive and can reverse when the start exceeds the
      // newest UID. Filter explicitly so an empty increment stays empty.
      const found = await client.search({ uid: `${lastUid + 1}:*` }, { uid: true });
      const uids = (found || []).filter((uid) => uid > lastUid).sort((a, b) => a - b);
      for (let offset = 0; offset < uids.length; offset += 20) {
        const batch: IncomingMail[] = [];
        for (const uid of uids.slice(offset, offset + 20)) {
          const message = await client.fetchOne(String(uid), {
            source: true,
            internalDate: true,
          }, { uid: true });
          if (message) {
            if (!message.source) throw new Error("Missing message source");
            const parsed = await parseIncomingMail(
              message.source, uidValidity, uid,
              message.internalDate instanceof Date ? message.internalDate : undefined,
            );
            // Retain full MIME (including attachments) before acknowledging the
            // import cursor. Mail filenames use server UIDs, never mail subjects.
            const directory = path.join(process.cwd(), "data/prototype/mail/test", uidValidity);
            await mkdir(directory, { recursive: true, mode: 0o700 });
            const filename = path.join(directory, `${uid}.eml`);
            const temporary = `${filename}.${randomUUID()}.tmp`;
            await writeFile(temporary, message.source, { mode: 0o600 });
            await rename(temporary, filename);
            batch.push(parsed);
          }
          lastUid = uid;
        }
        // Incoming mail and cursor commit together under the shared write queue.
        await saveMailSync({ uidValidity, lastUid }, batch);
        startAiTriage();
      }
      await saveMailSync({
        status: "connected",
        uidValidity,
        lastUid,
        messageCount: client.mailbox.exists,
        lastSuccessAt: new Date().toISOString(),
        error: undefined,
      });
    } finally {
      lock.release();
    }
  } catch (error) {
    await saveMailSync({ status: "error", error: syncError(error) });
  } finally {
    clearTimeout(deadline);
    client.close();
  }
}

export function syncTestMailbox() {
  // Also resume pending classifications after restart or provider recovery,
  // even when no new mail arrives or IMAP is temporarily unavailable.
  startAiTriage();
  if (!runtime.pending) {
    runtime.pending = receive().finally(() => { runtime.pending = undefined; });
  }
  return runtime.pending;
}

export function startMailSync() {
  runtime.run = syncTestMailbox;
  if (runtime.timer) return;
  const tick = () => {
    void runtime.run?.().catch(() => {
      console.error("Nie można zapisać stanu synchronizacji IMAP na dysku.");
    });
    void retrySentCopies().catch(() => {
      console.error("Nie można sprawdzić oczekujących kopii wiadomości wysłanych.");
    });
  };
  runtime.timer = setInterval(tick, intervalMs);
  runtime.timer.unref();
  tick();
}
