// API → prototype view-model mapping (prototype-at-root).
// The shared workspace components speak the prototype's Polish view-model
// (src/lib/types.ts); this module is the single boundary where NestJS API
// payloads (Prisma enums, REST shapes) are adapted. Display copy stays Polish.
import { categories, draftKey, priorities } from "./types";
import type {
  Category,
  Conversation,
  Draft,
  Email,
  InternalComment,
  KnowledgeDocument,
  KnowledgeVersion,
  Mailbox,
  Notification,
  Priority,
  PublicState,
  Status,
  User,
} from "./types";
import type { AiSettingsPublic, AiTriage } from "./ai-types";
import { knowledgeStamp } from "./ai-types";

export type ApiRole = "owner" | "admin" | "agent";
export type ApiStatus = "open" | "in_progress" | "pending" | "resolved";
export type ApiPriority = "low" | "normal" | "high" | "urgent";

export interface ApiSessionUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  locale: string;
}

export interface ApiWorkspacePayload {
  users: { id: string; name: string | null; email: string; role: string; locale: string }[];
  mailboxes: {
    id: string;
    name: string;
    kind: "imap" | "channel";
    host: string | null;
    user: string | null;
    active: boolean;
    lastSyncAt?: string | null;
  }[];
  conversations: ApiConversationSummary[];
  drafts: {
    conversationId: string;
    mode: "reply" | "comment";
    text: string;
    version: number;
    baseRevision: number;
    updatedAt: string;
  }[];
  notifications: {
    id: string;
    conversationId: string;
    type: string;
    title: string;
    body: string;
    readAt: string | null;
    createdAt: string;
  }[];
  knowledge: {
    id: string;
    mailboxId: string | null;
    category: string | null;
    status: string;
    title: string;
    updatedAt: string;
    versions: {
      version: number;
      title: string;
      content: string;
      status: string;
      userId: string | null;
      createdAt: string;
    }[];
  }[];
  aiSettings: { configured: boolean; model: string; version: number };
}

export interface ApiConversationSummary {
  id: string;
  subject: string;
  status: ApiStatus;
  priority: ApiPriority;
  category: string | null;
  customerEmail: string;
  assigneeId: string | null;
  assigneeName: string | null;
  mailboxId: string;
  createdAt: string;
  lastMessageAt: string;
  messageCount: number;
  commentCount: number;
  lastMessage: {
    body: string;
    direction: "in" | "out";
    authorType: "customer" | "agent" | "ai";
    authorName: string | null;
    sentAt: string;
  } | null;
  aiCategory: string | null;
  aiPriority: string | null;
  aiReason: string | null;
  aiDraftText: string | null;
  aiDraftSourceIds: string[];
  aiDraftModel: string | null;
  aiDraftAt: string | null;
  lastMessageSentAt: string | null;
}

export interface ApiConversationDetail {
  id: string;
  subject: string;
  status: ApiStatus;
  priority: ApiPriority;
  category: string | null;
  customerEmail: string;
  assigneeId: string | null;
  mailboxId: string;
  createdAt: string;
  lastMessageAt: string;
  mailbox: { id: string; name: string; user: string | null; kind: string; host: string | null; active: boolean };
  messages: {
    id: string;
    direction: "in" | "out";
    authorType: "customer" | "agent" | "ai";
    authorUserId: string | null;
    authorName: string | null;
    body: string;
    sentAt: string;
  }[];
  comments: {
    id: string;
    body: string;
    createdAt: string;
    userId: string;
    user: { id: string; name: string | null; email: string };
  }[];
  // Present because GET /v1/conversations/:id returns the full Prisma row.
  aiCategory?: string | null;
  aiPriority?: string | null;
  aiReason?: string | null;
  aiDraftText?: string | null;
  aiDraftSourceIds?: string[];
  aiDraftModel?: string | null;
  aiDraftAt?: string | null;
}

// ---- enum dictionaries ----

export const apiStatusToPl: Record<ApiStatus, Status> = {
  open: "Nowe",
  in_progress: "W toku",
  pending: "Oczekuje na klienta",
  resolved: "Zakończone",
};
export const plStatusToApi: Record<Status, ApiStatus> = {
  Nowe: "open",
  "W toku": "in_progress",
  "Oczekuje na klienta": "pending",
  Zakończone: "resolved",
};
export const apiPriorityToPl: Record<ApiPriority, Priority> = {
  low: "Niski",
  normal: "Normalny",
  high: "Wysoki",
  urgent: "Krytyczny",
};
export const plPriorityToApi: Record<Priority, ApiPriority> = {
  Krytyczny: "urgent",
  Wysoki: "high",
  Normalny: "normal",
  Niski: "low",
};

const roleLabels: Record<string, string> = {
  owner: "Właściciel",
  admin: "Administrator",
  agent: "Agent",
};

export function isCategory(value: string | null | undefined): value is Category {
  return !!value && (categories as readonly string[]).includes(value);
}
export function isPriority(value: string | null | undefined): value is Priority {
  return !!value && (priorities as readonly string[]).includes(value);
}
export function toCategory(value: string | null | undefined): Category {
  return isCategory(value) ? value : "Inne";
}
export function toPriority(value: string | null | undefined): Priority {
  return isPriority(value) ? value : "Normalny";
}

// ---- identity helpers ----

const userPalette = ["#6b6157", "#874c00", "#c98d68", "#453e37", "#91887d", "#8c6850"];
const mailboxPalette = ["#c98d68", "#874c00", "#91887d", "#6b6157", "#453e37", "#ad4e00"];

function hashOf(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

export function userColor(id: string): string {
  return userPalette[hashOf(id) % userPalette.length];
}
export function mailboxColor(id: string): string {
  return mailboxPalette[hashOf(id) % mailboxPalette.length];
}

export function initialsOf(name: string | null, email: string): string {
  const source = name?.trim() || email.split("@")[0] || "?";
  return source
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** Display ticket number derived from the stable conversation id (display-only). */
export function numberFromId(id: string): number {
  return (hashOf(id) % 90000) + 10000;
}

function customerOf(email: string): { name: string; email: string; company: string } {
  const [local, domain] = email.split("@");
  const name = (local ?? email)
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return { name: name || email, email, company: domain ?? "" };
}

// ---- mapping ----

function mapUsers(payload: ApiWorkspacePayload, session: ApiSessionUser): User[] {
  const seen = new Set<string>();
  const users: User[] = [];
  const push = (u: { id: string; name: string | null; email: string; role: string }) => {
    if (seen.has(u.id)) return;
    seen.add(u.id);
    users.push({
      id: u.id,
      name: u.name?.trim() || u.email,
      initials: initialsOf(u.name, u.email),
      color: userColor(u.id),
      role: roleLabels[u.role] ?? u.role,
      active: true,
    });
  };
  // The session user leads the directory even if mid-deactivation lists lag.
  push({ id: session.id, name: session.name, email: session.email, role: session.role });
  for (const u of payload.users) push(u);
  return users;
}

function mapMailboxes(payload: ApiWorkspacePayload): Mailbox[] {
  return payload.mailboxes.map((box) => {
    const connected = box.active && box.kind === "imap" && !!box.host;
    return {
      id: box.id,
      name: box.name,
      email: box.user ?? box.name,
      color: mailboxColor(box.id),
      description: connected
        ? `IMAP · ${box.host}`
        : box.kind === "channel"
          ? "Kanał · niepodłączony"
          : "Skrzynka · oczekuje na połączenie IMAP",
      mode: connected ? "imap" : "unconnected",
      canSend: connected,
    };
  });
}

function mapKnowledge(payload: ApiWorkspacePayload, mailboxes: Mailbox[]): KnowledgeDocument[] {
  const fallbackMailbox = mailboxes[0]?.id ?? "";
  // Oldest first so newly created documents land at the end (prototype order).
  return payload.knowledge
    .slice()
    .reverse()
    .map((item) => {
      const versions: KnowledgeVersion[] = item.versions.length
        ? item.versions.map((v) => ({
            version: v.version,
            title: v.title,
            body: v.content,
            status: (["pending", "approved", "rejected"] as const).includes(v.status as never)
              ? (v.status as KnowledgeVersion["status"])
              : "pending",
            userId: v.userId ?? "",
            createdAt: v.createdAt,
          }))
        : [
            {
              version: 1,
              title: item.title,
              body: "",
              status: "pending",
              userId: "",
              createdAt: item.updatedAt,
            },
          ];
      return {
        id: item.id,
        mailboxId: item.mailboxId ?? fallbackMailbox,
        category: toCategory(item.category),
        versions,
      };
    });
}

function mapNotifications(
  payload: ApiWorkspacePayload,
  session: ApiSessionUser,
): Notification[] {
  return payload.notifications.map((n) => ({
    id: n.id,
    type: (["assignment", "urgent", "escalation"] as const).includes(n.type as never)
      ? (n.type as Notification["type"])
      : "escalation",
    conversationId: n.conversationId,
    title: n.title,
    body: n.body,
    createdAt: n.createdAt,
    readBy: n.readAt ? [session.id] : [],
  }));
}

function mapDrafts(payload: ApiWorkspacePayload, session: ApiSessionUser): Draft[] {
  return payload.drafts.map((d) => ({
    key: draftKey(d.conversationId, session.id, d.mode),
    conversationId: d.conversationId,
    userId: session.id,
    mode: d.mode,
    text: d.text,
    basePublicRevision: d.baseRevision,
    version: d.version,
    updatedAt: d.updatedAt,
  }));
}

function aiSuggestionOf(
  summary: ApiConversationSummary,
  publicRevision: number,
  knowledge: KnowledgeDocument[],
): Conversation["aiSuggestion"] {
  if (!summary.aiDraftAt && !summary.aiDraftText) return undefined;
  // A message newer than the generation marks the suggestion stale by bumping
  // its recorded revision past the conversation's current one.
  const stale =
    !!summary.aiDraftAt && !!summary.lastMessageSentAt &&
    new Date(summary.lastMessageSentAt).getTime() > new Date(summary.aiDraftAt).getTime();
  const text = summary.aiDraftText ?? "";
  return {
    text,
    sources: summary.aiDraftSourceIds
      .map((id) => knowledge.find((doc) => doc.id === id))
      .filter((doc): doc is KnowledgeDocument => !!doc)
      .map((doc) => {
        const version = doc.versions[doc.versions.length - 1];
        return { id: doc.id, title: version.title, version: version.version };
      }),
    needsHuman: !text.trim(),
    reason: summary.aiReason ?? "",
    model: summary.aiDraftModel ?? "",
    generatedAt: summary.aiDraftAt ?? new Date().toISOString(),
    generatedBy: "ai",
    publicRevision: stale ? publicRevision + 1 : publicRevision,
    settingsVersion: 0,
    knowledgeStamp: knowledgeStamp(knowledge, summary.mailboxId),
    contextHash: "",
  };
}

function aiTriageOf(summary: {
  category: string | null;
  priority: ApiPriority;
  aiCategory: string | null;
  aiPriority: string | null;
  aiReason: string | null;
  aiDraftModel: string | null;
  aiDraftAt: string | null;
}): AiTriage | undefined {
  if (!summary.aiCategory) return undefined;
  const applied =
    summary.category === summary.aiCategory &&
    summary.priority === (plPriorityToApi as Record<string, ApiPriority>)[summary.aiPriority ?? ""];
  return {
    id: `${summary.category ?? "conv"}-ai`,
    status: applied ? "applied" : "manual",
    attempts: 0,
    result: {
      category: toCategory(summary.aiCategory),
      priority: toPriority(summary.aiPriority),
      reason: summary.aiReason ?? "",
      model: summary.aiDraftModel ?? "",
      generatedAt: summary.aiDraftAt ?? new Date().toISOString(),
      settingsVersion: 0,
      contextHash: "",
    },
  };
}

function previewEmail(summary: ApiConversationSummary, mailbox: Mailbox | undefined): Email[] {
  if (!summary.lastMessage) return [];
  const last = summary.lastMessage;
  return [
    {
      id: `${summary.id}:preview`,
      direction: last.direction === "in" ? "inbound" : "outbound",
      authorName: last.authorName ?? customerOf(summary.customerEmail).name,
      userId: undefined,
      from: last.direction === "in" ? summary.customerEmail : mailbox?.email ?? "",
      to: last.direction === "in" ? mailbox?.email ?? "" : summary.customerEmail,
      body: last.body,
      createdAt: last.sentAt,
    },
  ];
}

/** Summary row → prototype Conversation. Timeline content is preview-only;
 *  the driver swaps in the full detail via mapApiConversationDetail. */
export function mapApiConversationSummary(
  summary: ApiConversationSummary,
  mailboxes: Mailbox[],
  knowledge: KnowledgeDocument[],
): Conversation {
  const mailbox = mailboxes.find((m) => m.id === summary.mailboxId);
  return {
    id: summary.id,
    number: numberFromId(summary.id),
    mailboxId: summary.mailboxId,
    subject: summary.subject,
    customer: customerOf(summary.customerEmail),
    category: toCategory(summary.category),
    priority: apiPriorityToPl[summary.priority] ?? "Normalny",
    status: apiStatusToPl[summary.status] ?? "W toku",
    assigneeId: summary.assigneeId,
    createdAt: summary.createdAt,
    updatedAt: summary.lastMessageAt,
    publicRevision: summary.messageCount,
    emails: previewEmail(summary, mailbox),
    comments: [],
    activities: [],
    suggestionDismissed: false,
    closureVersion: 0,
    aiSuggestion: aiSuggestionOf(summary, summary.messageCount, knowledge),
    aiTriage: aiTriageOf(summary),
  };
}

/** GET /v1/conversations/:id → full prototype Conversation. */
export function mapApiConversationDetail(
  detail: ApiConversationDetail,
  mailboxes: Mailbox[],
  session: ApiSessionUser,
  knowledge: KnowledgeDocument[] = [],
): Conversation {
  const mailbox = mailboxes.find((m) => m.id === detail.mailboxId);
  const emails: Email[] = detail.messages.map((m) => ({
    id: m.id,
    direction: m.direction === "in" ? "inbound" : "outbound",
    authorName:
      m.authorName ??
      (m.direction === "in" ? customerOf(detail.customerEmail).name : (session.name ?? session.email)),
    userId: m.authorUserId ?? undefined,
    from: m.direction === "in" ? detail.customerEmail : mailbox?.email ?? "",
    to: m.direction === "in" ? mailbox?.email ?? "" : detail.customerEmail,
    body: m.body,
    createdAt: m.sentAt,
  }));
  const comments: InternalComment[] = detail.comments.map((c) => ({
    id: c.id,
    userId: c.userId,
    body: c.body,
    createdAt: c.createdAt,
  }));
  const lastSentAt = detail.messages.at(-1)?.sentAt ?? null;
  const summaryShape: ApiConversationSummary = {
    id: detail.id,
    subject: detail.subject,
    status: detail.status,
    priority: detail.priority,
    category: detail.category,
    customerEmail: detail.customerEmail,
    assigneeId: detail.assigneeId,
    assigneeName: null,
    mailboxId: detail.mailboxId,
    createdAt: detail.createdAt,
    lastMessageAt: detail.lastMessageAt,
    messageCount: emails.length,
    commentCount: comments.length,
    lastMessage: null,
    aiCategory: detail.aiCategory ?? null,
    aiPriority: detail.aiPriority ?? null,
    aiReason: detail.aiReason ?? null,
    aiDraftText: detail.aiDraftText ?? null,
    aiDraftSourceIds: detail.aiDraftSourceIds ?? [],
    aiDraftModel: detail.aiDraftModel ?? null,
    aiDraftAt: detail.aiDraftAt ?? null,
    lastMessageSentAt: lastSentAt,
  };
  return {
    id: detail.id,
    number: numberFromId(detail.id),
    mailboxId: detail.mailboxId,
    subject: detail.subject,
    customer: customerOf(detail.customerEmail),
    category: toCategory(detail.category),
    priority: apiPriorityToPl[detail.priority] ?? "Normalny",
    status: apiStatusToPl[detail.status] ?? "W toku",
    assigneeId: detail.assigneeId,
    createdAt: detail.createdAt,
    updatedAt: detail.lastMessageAt,
    publicRevision: emails.length,
    emails,
    comments,
    activities: [],
    suggestionDismissed: false,
    closureVersion: 0,
    aiSuggestion: aiSuggestionOf(summaryShape, emails.length, knowledge),
    aiTriage: aiTriageOf(summaryShape),
  };
}

export interface MappedWorkspaceState {
  state: PublicState;
  user: User;
}

/** GET /v1/workspace/state → full prototype PublicState + session user. */
export function mapApiWorkspaceState(
  payload: ApiWorkspacePayload,
  session: ApiSessionUser,
  options: { revision: number; dismissed?: Set<string>; details?: Map<string, Conversation> } = {
    revision: 1,
  },
): MappedWorkspaceState {
  const users = mapUsers(payload, session);
  const user =
    users.find((u) => u.id === session.id) ??
    ({
      id: session.id,
      name: session.name ?? session.email,
      initials: initialsOf(session.name, session.email),
      color: userColor(session.id),
      role: roleLabels[session.role] ?? session.role,
    } satisfies User);
  const mailboxes = mapMailboxes(payload);
  const knowledge = mapKnowledge(payload, mailboxes);
  const aiSettings: AiSettingsPublic = {
    version: payload.aiSettings.version,
    configured: payload.aiSettings.configured,
    model: payload.aiSettings.model,
  };
  const conversations = payload.conversations.map((summary) => {
    const mapped = mapApiConversationSummary(summary, mailboxes, knowledge);
    const loaded = options.details?.get(summary.id);
    if (loaded) {
      // Refresh scalars but keep the loaded timeline (avoid preview-only flash).
      mapped.emails = loaded.emails;
      mapped.comments = loaded.comments;
      if (!mapped.aiSuggestion && loaded.aiSuggestion) mapped.aiSuggestion = loaded.aiSuggestion;
    }
    if (options.dismissed?.has(summary.id)) mapped.suggestionDismissed = true;
    return mapped;
  });
  const state: PublicState = {
    schemaVersion: 4,
    revision: options.revision,
    generation: "db",
    users,
    mailboxes,
    conversations,
    drafts: mapDrafts(payload, session),
    knowledge,
    notifications: mapNotifications(payload, session),
    archiveCount: 0,
    aiSettings,
    aiUsageSummary: { requests: 0, cost: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    presence: [],
    outgoing: [],
  };
  return { state, user };
}

