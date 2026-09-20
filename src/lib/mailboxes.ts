import type { DemoState, Mailbox } from "./types";

export const mailboxes: Mailbox[] = [
  {
    id: "general",
    name: "Open Triage · Ogólna",
    email: "hello@opentriage.com",
    color: "#c98d68",
    description: "Skrzynka docelowa · jeszcze niepodłączona",
    mode: "unconnected",
  },
  {
    id: "support",
    name: "Open Triage · Wsparcie",
    email: "help@opentriage.com",
    color: "#874c00",
    description: "Skrzynka docelowa · jeszcze niepodłączona",
    mode: "unconnected",
  },
  {
    id: "test",
    name: "Open Triage · Test",
    email: "support@opentriage.com",
    color: "#91887d",
    description: "Skrzynka testowa · odbiór IMAP nie jest podłączony",
    mode: "unconnected",
  },
];

export const testMailbox = mailboxes.find((box) => box.id === "test")!;

export function syncMailboxProfiles(state: DemoState): boolean {
  let changed = false;
  state.mailboxes = state.mailboxes.map((mailbox) => {
    const profile = mailboxes.find((item) => item.id === mailbox.id);
    if (!profile) return mailbox;
    const next = { ...structuredClone(profile), mode: mailbox.mode };
    if (JSON.stringify(mailbox) === JSON.stringify(next)) return mailbox;
    changed = true;
    return next;
  });
  return changed;
}

// Keep conversation and comment IDs stable so existing links and drafts survive.
export function migrateMailboxes(state: DemoState): boolean {
  if (state.schemaVersion !== 1) return false;
  const previousAddresses = new Set(state.mailboxes.map((box) => box.email));
  state.mailboxes = structuredClone(mailboxes);
  for (const conversation of state.conversations) {
    conversation.mailboxId = testMailbox.id;
    for (const email of conversation.emails) {
      if (previousAddresses.has(email.from)) email.from = testMailbox.email;
      if (previousAddresses.has(email.to)) email.to = testMailbox.email;
    }
  }
  for (const document of state.knowledge) document.mailboxId = testMailbox.id;
  for (const archive of state.archives) archive.mailboxId = testMailbox.id;
  state.schemaVersion = 2;
  state.revision++;
  return true;
}

export function removeSampleMail(state: DemoState): boolean {
  if (state.schemaVersion !== 3) return false;
  const removedIds = new Set(
    state.conversations
      .filter(
        (conversation) =>
          conversation.mailboxId === testMailbox.id &&
          /^(atlas|bento|cobalt|test)-[1-8]$/.test(conversation.id),
      )
      .map((conversation) => conversation.id),
  );
  state.conversations = state.conversations.filter(
    (item) => !removedIds.has(item.id),
  );
  state.drafts = state.drafts.filter(
    (item) => !removedIds.has(item.conversationId),
  );
  state.notifications = state.notifications.filter(
    (item) => !removedIds.has(item.conversationId),
  );
  state.archives = state.archives.filter(
    (item) => !removedIds.has(item.conversationId),
  );
  state.knowledge = state.knowledge.filter(
    (document) =>
      !(document.conversationId && removedIds.has(document.conversationId)) &&
      !(
        document.mailboxId === testMailbox.id &&
        /^(atlas|bento|cobalt|test)-doc-\d+$/.test(document.id)
      ),
  );
  state.mailboxes = state.mailboxes.map((box) =>
    box.id === testMailbox.id ? { ...testMailbox } : box,
  );
  state.schemaVersion = 4;
  state.revision++;
  return true;
}
