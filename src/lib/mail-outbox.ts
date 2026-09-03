import type { DemoState, OutgoingMail } from "./types";
import { signatureFor } from "./signatures";

export class MailError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = "INVALID_ACTION") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface ReplyRequest {
  requestId: string;
  userId: string;
  generation: string;
  action: {
    conversationId: string;
    text: string;
    expectedPublicRevision: number;
    draftVersion: number;
  };
}

export function reserveReply(state: DemoState, request: ReplyRequest): OutgoingMail {
  const { requestId, userId, generation, action } = request;
  const user = state.users.find((item) => item.id === userId && item.active !== false);
  if (!user) throw new MailError("Nieznany użytkownik.");
  if (state.generation !== generation) throw new MailError("Odśwież dane panelu.", 409, "RESET");
  const existing = state.outbox?.find((job) => job.requestId === requestId);
  if (existing) {
    if (existing.userId !== userId || existing.conversationId !== action.conversationId || existing.email.body !== action.text.trim())
      throw new MailError("Identyfikator wysyłki dotyczy innej wiadomości.", 409, "REQUEST_CONFLICT");
    return existing;
  }
  if (state.appliedRequests.includes(requestId))
    throw new MailError("Ten identyfikator został już użyty w innej operacji.", 409, "REQUEST_CONFLICT");
  const conversation = state.conversations.find((item) => item.id === action.conversationId);
  if (!conversation) throw new MailError("Nie znaleziono rozmowy.", 404);
  const mailbox = state.mailboxes.find((item) => item.id === conversation.mailboxId);
  if (mailbox?.id !== "test" || mailbox.email !== "test@sellersk.it" || mailbox.mode !== "imap")
    throw new MailError("Wysyłanie nie jest podłączone dla tej skrzynki.", 409, "MAILBOX_NOT_CONNECTED");
  if (state.outbox?.some((job) => job.conversationId === conversation.id && ["prepared", "sending", "unknown"].includes(job.status)))
    throw new MailError("W tej rozmowie trwa już wysyłka albo wymaga sprawdzenia jej wyniku.", 409, "SEND_PENDING");
  if (conversation.publicRevision !== action.expectedPublicRevision)
    throw new MailError("Pojawiła się nowa wiadomość. Przejrzyj ją przed wysłaniem.", 409, "NEW_REPLY");
  const draft = state.drafts.find((item) => item.key === `${conversation.id}:${userId}:reply`);
  if ((draft?.version ?? 0) !== action.draftVersion)
    throw new MailError("Szkic zmienił się w innej karcie.", 409, "DRAFT_CONFLICT");
  if (!action.text.trim()) throw new MailError("Wpisz treść wiadomości.");
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(conversation.customer.email))
    throw new MailError("W rozmowie brakuje prawidłowego adresu odbiorcy.");
  const previousEmail = conversation.emails.filter((email) => email.messageId).at(-1);
  const job: OutgoingMail = {
    requestId,
    conversationId: conversation.id,
    userId,
    draftVersion: action.draftVersion,
    basePublicRevision: conversation.publicRevision,
    subject: /^(re|odp):/i.test(conversation.subject) ? conversation.subject : `Re: ${conversation.subject}`,
    inReplyTo: previousEmail?.messageId,
    status: "prepared",
    email: {
      id: requestId,
      messageId: `<${requestId}@sellersk.it>`,
      references: [...new Set(conversation.emails.flatMap((email) => [
        ...(email.references ?? []), ...(email.messageId ? [email.messageId] : []),
      ]))].slice(-50),
      direction: "outbound",
      authorName: user.name,
      userId,
      from: mailbox.email,
      to: conversation.customer.email,
      body: action.text.trim(),
      createdAt: new Date().toISOString(),
      signature: signatureFor(user, mailbox.email),
    },
  };
  (state.outbox ??= []).push(job);
  return job;
}

export function claimReply(state: DemoState, requestId: string, raw: string) {
  const job = state.outbox!.find((item) => item.requestId === requestId)!;
  if (job.status !== "prepared") throw new MailError("Ta wysyłka została już rozpoczęta.", 409, "SEND_PENDING");
  const conversation = state.conversations.find((item) => item.id === job.conversationId)!;
  const draft = state.drafts.find((item) => item.key === `${job.conversationId}:${job.userId}:reply`);
  if (conversation.publicRevision !== job.basePublicRevision || (draft?.version ?? 0) !== job.draftVersion) {
    job.status = "failed";
    job.error = "Rozmowa lub szkic zmieniły się przed wysłaniem. Przejrzyj nowe dane.";
    return false;
  }
  job.raw = raw;
  job.status = "sending";
  return true;
}

export function acceptReply(state: DemoState, requestId: string) {
  const job = state.outbox!.find((item) => item.requestId === requestId)!;
  if (job.status === "sent") return;
  const conversation = state.conversations.find((item) => item.id === job.conversationId)!;
  job.status = "sent";
  job.error = undefined;
  job.email.sentCopy = { status: "pending" };
  const noNewMail = conversation.publicRevision === job.basePublicRevision;
  conversation.emails.push(structuredClone(job.email));
  conversation.publicRevision++;
  if (noNewMail) conversation.status = "Oczekuje na klienta";
  conversation.updatedAt = new Date().toISOString();
  conversation.activities.push({
    id: `sent-${requestId}`, userId: job.userId,
    text: `wysyła odpowiedź z ${job.email.from}`, createdAt: conversation.updatedAt,
  });
  const draft = state.drafts.find((item) => item.key === `${job.conversationId}:${job.userId}:reply`);
  // A different tab of the same person can edit while SMTP is in progress.
  if (draft?.version === job.draftVersion && draft.text.trim() === job.email.body) {
    draft.text = "";
    draft.version++;
    draft.basePublicRevision = conversation.publicRevision;
    draft.updatedAt = conversation.updatedAt;
  }
  state.appliedRequests.push(requestId);
}

export function recordSentCopy(state: DemoState, requestId: string, folder?: string) {
  const job = state.outbox!.find((item) => item.requestId === requestId)!;
  const copy = folder
    ? { status: "saved" as const, folder }
    : { status: "pending" as const, error: "Mail wysłany. Ponawiamy zapis kopii w folderze Wysłane." };
  job.email.sentCopy = copy;
  const email = state.conversations.find((item) => item.id === job.conversationId)?.emails.find((item) => item.id === requestId);
  if (email) email.sentCopy = copy;
}
