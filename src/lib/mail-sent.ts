import type { ImapFlow } from "imapflow";
import type { OutgoingMail } from "./types";

export async function saveSentMessage(
  client: Pick<ImapFlow, "list" | "getMailboxLock" | "search" | "append" | "fetch" | "mailbox">,
  job: OutgoingMail,
  raw: Buffer,
  configuredFolder?: string,
) {
  const folders = await client.list();
  const folder = folders.find((item) => configuredFolder
    ? item.path === configuredFolder : item.specialUse === "\\Sent")?.path;
  if (!folder) throw new Error("Sent folder unavailable");
  const lock = await client.getMailboxLock(folder, { readOnly: true });
  try {
    // Reconcile uncertain APPEND acknowledgements before creating another copy.
    const existing = await client.search({ header: { "message-id": job.email.messageId! } }, { uid: true });
    if (existing === false) throw new Error("Cannot confirm whether the sent copy exists");
    let found = existing.length > 0;
    // home.pl can omit an existing Message-ID from SEARCH HEADER results. FETCH
    // envelopes provide the actual headers without downloading message bodies.
    if (!found && client.mailbox && client.mailbox.exists > 0) {
      for await (const message of client.fetch("1:*", { envelope: true })) {
        if (message.envelope?.messageId === job.email.messageId) found = true;
      }
    }
    if (!found) {
      const result = await client.append(folder, raw, ["\\Seen"], new Date(job.email.createdAt));
      if (!result) throw new Error("Sent copy not acknowledged");
    }
    return folder;
  } finally {
    lock.release();
  }
}
