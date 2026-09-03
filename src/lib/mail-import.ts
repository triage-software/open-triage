import { randomUUID } from "node:crypto";
import type { DemoState, Email } from "./types";

export interface IncomingMail {
  subject: string;
  email: Email;
}

// Called inside the store's write queue, against the newest state. Never replace
// conversations wholesale: another worker may have edited a draft or comment.
export function mergeIncomingMail(
  state: DemoState,
  mailboxId: string,
  messages: IncomingMail[],
) {
  let imported = 0;
  for (const { subject, email } of messages) {
    const conversations = state.conversations.filter(
      (conversation) => conversation.mailboxId === mailboxId,
    );
    if (
      conversations.some((conversation) =>
        conversation.emails.some(
          (existing) =>
            existing.id === email.id ||
            (email.messageId && existing.messageId === email.messageId),
        ),
      )
    ) continue;

    const references = new Set(email.references ?? []);
    const conversation = conversations.find((item) =>
      item.emails.some(
        (existing) => existing.messageId && references.has(existing.messageId),
      ),
    );
    if (conversation) {
      conversation.emails.push(email);
      conversation.publicRevision++;
      conversation.updatedAt = new Date().toISOString();
      conversation.suggestionDismissed = false;
      if (
        conversation.status === "Zakończone" ||
        conversation.status === "Oczekuje na klienta"
      ) conversation.status = "W toku";
    } else {
      state.conversations.push({
        id: randomUUID(),
        number: Math.max(0, ...state.conversations.map((item) => item.number)) + 1,
        mailboxId,
        subject,
        customer: { name: email.authorName, email: email.from, company: "" },
        category: "Inne",
        priority: "Normalny",
        status: "Nowe",
        assigneeId: null,
        createdAt: email.createdAt,
        updatedAt: email.createdAt,
        publicRevision: 1,
        emails: [email],
        comments: [],
        activities: [],
        suggestionDismissed: false,
        closureVersion: 0,
      });
    }
    imported++;
  }
  return imported;
}
