import type { AiSettingsPublic, AiSuggestion, AiUsage, AiUsageSummary } from "./ai-types";

export const categories = [
  "Awaria",
  "Licencja",
  "Sprzedaż",
  "Support",
  "Inne",
] as const;
export const priorities = ["Krytyczny", "Wysoki", "Normalny", "Niski"] as const;
export const statuses = [
  "Nowe",
  "W toku",
  "Oczekuje na klienta",
  "Zakończone",
] as const;
export type Category = (typeof categories)[number];
export type Priority = (typeof priorities)[number];
export type Status = (typeof statuses)[number];
export type Variant = "inbox" | "queue" | "board";
export type ComposerMode = "reply" | "comment";
export interface User {
  id: string;
  name: string;
  initials: string;
  color: string;
  role: string;
  signature?: EmployeeSignature;
  active?: boolean;
}
export interface EmployeeSignature {
  custom?: { mjml: string; html: string; text: string; version: number; updatedAt: string; updatedBy: string };
  name: string;
  title: string;
  email: string;
  phone?: string;
  website: string;
  company: string;
}
export interface Mailbox {
  id: string;
  name: string;
  email: string;
  color: string;
  description: string;
  mode: "demo" | "unconnected" | "imap";
  canSend?: boolean;
}
export interface MailSyncState {
  status: "unconfigured" | "syncing" | "connected" | "error";
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  error?: string;
  uidValidity?: string;
  lastUid?: number;
  messageCount?: number;
}
export interface Email {
  id: string;
  direction: "inbound" | "outbound";
  authorName: string;
  userId?: string;
  from: string;
  to: string;
  body: string;
  createdAt: string;
  demo?: boolean;
  messageId?: string;
  references?: string[];
  imap?: { uidValidity: string; uid: number; folder: "INBOX" };
  attachments?: { name: string; size: number }[];
  sentCopy?: { status: "pending" | "saved"; folder?: string; error?: string };
  signature?: EmployeeSignature;
}
export interface OutgoingMail {
  requestId: string;
  conversationId: string;
  userId: string;
  draftVersion: number;
  basePublicRevision: number;
  subject: string;
  inReplyTo?: string;
  email: Email;
  raw?: string;
  status: "prepared" | "sending" | "sent" | "failed" | "unknown";
  error?: string;
}
// Internal comments never share the outbound email shape or delivery path.
export interface InternalComment {
  id: string;
  userId: string;
  body: string;
  createdAt: string;
}
export interface Activity {
  id: string;
  userId: string;
  text: string;
  createdAt: string;
}
export interface Conversation {
  id: string;
  number: number;
  mailboxId: string;
  subject: string;
  customer: { name: string; email: string; company: string };
  category: Category;
  priority: Priority;
  status: Status;
  assigneeId: string | null;
  createdAt: string;
  updatedAt: string;
  publicRevision: number;
  emails: Email[];
  comments: InternalComment[];
  activities: Activity[];
  suggestionDismissed: boolean;
  closureVersion: number;
  aiSuggestion?: AiSuggestion;
}
export interface Draft {
  key: string;
  conversationId: string;
  userId: string;
  mode: ComposerMode;
  text: string;
  basePublicRevision: number;
  version: number;
  updatedAt: string;
}
export interface KnowledgeVersion {
  version: number;
  title: string;
  body: string;
  status: "pending" | "approved" | "rejected";
  userId: string;
  createdAt: string;
}
export interface KnowledgeDocument {
  id: string;
  mailboxId: string;
  category: Category;
  conversationId?: string;
  versions: KnowledgeVersion[];
}
export interface Notification {
  id: string;
  type: "assignment" | "urgent" | "escalation";
  conversationId: string;
  title: string;
  body: string;
  createdAt: string;
  readBy: string[];
}
export interface Archive {
  conversationId: string;
  mailboxId: string;
  version: number;
  createdAt: string;
  markdown: string;
}
export interface Presence {
  sessionId: string;
  userId: string;
  conversationId: string;
  mode: "viewing" | "replying" | "commenting";
  seenAt: number;
}
export interface DemoState {
  schemaVersion: 1 | 2 | 3 | 4;
  revision: number;
  generation: string;
  users: User[];
  mailboxes: Mailbox[];
  conversations: Conversation[];
  drafts: Draft[];
  knowledge: KnowledgeDocument[];
  notifications: Notification[];
  archives: Archive[];
  appliedRequests: string[];
  mailSync?: Record<string, MailSyncState>;
  outbox?: OutgoingMail[];
  aiUsage?: (AiUsage & { id: string; conversationId: string; model: string; generatedAt: string })[];
}
export type PublicState = Omit<DemoState, "appliedRequests" | "archives" | "outbox" | "aiUsage"> & {
  archiveCount: number;
  aiSettings: AiSettingsPublic;
  aiUsageSummary: AiUsageSummary;
  presence: Presence[];
  outgoing: Pick<OutgoingMail, "requestId" | "conversationId" | "status" | "error">[];
};
export interface Suggestion {
  text: string;
  sources: { id: string; title: string; version: number }[];
  needsHuman: boolean;
}
export const draftKey = (
  conversationId: string,
  userId: string,
  mode: ComposerMode,
) => `${conversationId}:${userId}:${mode}`;
export const latestVersion = (document: KnowledgeDocument) =>
  document.versions[document.versions.length - 1];

export function suggestReply(
  conversation: Conversation,
  knowledge: KnowledgeDocument[],
): Suggestion {
  const sources = knowledge.filter(
    (doc) =>
      doc.mailboxId === conversation.mailboxId &&
      doc.category === conversation.category &&
      latestVersion(doc).status === "approved",
  );
  if (!sources.length || conversation.category === "Inne")
    return { text: "", sources: [], needsHuman: true };
  // Deliberately deterministic: only approved public knowledge is used, never comments.
  const source = sources.at(-1)!;
  const version = latestVersion(source);
  return {
    text: `Dzień dobry,\n\ndziękujemy za wiadomość. ${version.body.replace(/^#+\s.*$/gm, "").trim()}\n\nJeśli możemy pomóc w czymś jeszcze, prosimy o odpowiedź.\nPozdrawiamy,\nZespół obsługi klienta`,
    sources: [
      { id: source.id, title: version.title, version: version.version },
    ],
    needsHuman: conversation.category === "Awaria",
  };
}
