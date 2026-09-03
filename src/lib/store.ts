import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { seedState } from "./seed";
import { migrateMailboxes, removeSampleMail } from "./mailboxes";
import { isActiveUser, migrateTeam } from "./team";
import { mergeIncomingMail, type IncomingMail } from "./mail-import";
import {
  categories,
  draftKey,
  latestVersion,
  priorities,
  statuses,
  suggestReply,
} from "./types";
import type { Conversation, DemoState, MailSyncState, Presence, PublicState } from "./types";

const root = path.join(process.cwd(), "data", "prototype");
const file = path.join(root, "state.json");
type Runtime = { queue: Promise<unknown>; presence: Map<string, Presence> };
const runtimeGlobal = globalThis as typeof globalThis & {
  openTriageRuntime?: Runtime;
};
const runtime = (runtimeGlobal.openTriageRuntime ??= {
  queue: Promise.resolve(),
  presence: new Map(),
});

export class ActionError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = "INVALID_ACTION",
  ) {
    super(message);
  }
}

function serial<T>(operation: () => Promise<T>): Promise<T> {
  const next = runtime.queue.then(operation, operation);
  runtime.queue = next.catch(() => undefined);
  return next;
}
async function atomicWrite(filename: string, text: string) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temp = `${filename}.${randomUUID()}.tmp`;
  await writeFile(temp, text, "utf8");
  await rename(temp, filename);
}
function documentMarkdown(
  state: DemoState,
  doc: DemoState["knowledge"][number],
  index: number,
) {
  const version = doc.versions[index];
  return `---\nid: ${doc.id}\nmailbox: ${doc.mailboxId}\nversion: ${version.version}\nstatus: ${version.status}\nauthor: ${state.users.find((u) => u.id === version.userId)?.name ?? version.userId}\ndate: ${version.createdAt}\n---\n\n# ${version.title}\n\n${version.body}\n`;
}
async function materialize(state: DemoState, previous?: DemoState) {
  const generationRoot = path.join(root, "generations", state.generation);
  for (const doc of state.knowledge) {
    const previousCount =
      previous?.knowledge.find((d) => d.id === doc.id)?.versions.length ?? 0;
    for (let i = previousCount; i < doc.versions.length; i++) {
      await atomicWrite(
        path.join(
          generationRoot,
          "knowledge",
          doc.mailboxId,
          doc.id,
          `v${doc.versions[i].version}.md`,
        ),
        documentMarkdown(state, doc, i),
      );
    }
  }
  for (const archive of state.archives.slice(previous?.archives.length ?? 0)) {
    await atomicWrite(
      path.join(
        generationRoot,
        "archives",
        archive.mailboxId,
        `${archive.conversationId}-v${archive.version}.md`,
      ),
      archive.markdown,
    );
  }
}
async function load(): Promise<DemoState> {
  try {
    const original = await readFile(file, "utf8");
    const state = JSON.parse(original) as DemoState;
    if (migrateMailboxes(state)) {
      await atomicWrite(
        path.join(
          root,
          "backups",
          `${state.generation}-before-mailboxes-v2.json`,
        ),
        original,
      );
      await materialize(state);
      await atomicWrite(file, JSON.stringify(state, null, 2));
    }
    if (state.schemaVersion === 2) {
      await atomicWrite(
        path.join(root, "backups", `${state.generation}-before-team-v3.json`),
        JSON.stringify(state, null, 2),
      );
      migrateTeam(state);
      await atomicWrite(file, JSON.stringify(state, null, 2));
    }
    if (state.schemaVersion === 3) {
      await atomicWrite(
        path.join(
          root,
          "backups",
          `${state.generation}-before-remove-samples-v4.json`,
        ),
        JSON.stringify(state, null, 2),
      );
      removeSampleMail(state);
      await atomicWrite(file, JSON.stringify(state, null, 2));
    }
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const state = seedState();
    await materialize(state);
    await atomicWrite(file, JSON.stringify(state, null, 2));
    return state;
  }
}
function snapshot(state: DemoState): PublicState {
  for (const [key, item] of runtime.presence)
    if (
      Date.now() - item.seenAt > 45_000 ||
      !state.users.some(
        (user) => user.id === item.userId && isActiveUser(user),
      ) ||
      !state.conversations.some(
        (conversation) => conversation.id === item.conversationId,
      )
    )
      runtime.presence.delete(key);
  const { appliedRequests: _requests, archives, ...visible } = state;
  return {
    ...visible,
    archiveCount: archives.length,
    presence: [...runtime.presence.values()],
  };
}
export function getState() {
  return serial(async () => snapshot(await load()));
}

export function getMailSync() {
  return serial(async () => (await load()).mailSync?.test);
}

export function saveMailSync(
  update: Partial<MailSyncState>,
  messages: IncomingMail[] = [],
) {
  return serial(async () => {
    const state = await load();
    const imported = mergeIncomingMail(state, "test", messages);
    state.mailSync ??= {};
    state.mailSync.test = {
      ...(state.mailSync.test ?? { status: "unconfigured" }),
      ...update,
    };
    const mailbox = state.mailboxes.find((box) => box.id === "test")!;
    mailbox.mode = state.mailSync.test.lastSuccessAt ? "imap" : "unconnected";
    if (update.status === "unconfigured") mailbox.mode = "unconnected";
    mailbox.description = mailbox.mode === "imap"
      ? "Odbiór IMAP · automatyczne sprawdzanie co 30 s"
      : "Skrzynka testowa · oczekuje na połączenie IMAP";
    state.revision++;
    await atomicWrite(file, JSON.stringify(state, null, 2));
    return imported;
  });
}

const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9:_-]+$/);
const bodyText = z.string().max(30_000);
const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("updateConversation"),
    conversationId: id,
    patch: z
      .object({
        category: z.enum(categories).optional(),
        priority: z.enum(priorities).optional(),
        status: z.enum(statuses).optional(),
        assigneeId: id.nullable().optional(),
      })
      .strict(),
  }),
  z.object({
    type: z.literal("saveDraft"),
    conversationId: id,
    mode: z.enum(["reply", "comment"]),
    text: bodyText,
    basePublicRevision: z.number().int().nonnegative(),
    expectedVersion: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("sendReply"),
    conversationId: id,
    text: bodyText.min(1),
    expectedPublicRevision: z.number().int().nonnegative(),
    draftVersion: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("addComment"),
    conversationId: id,
    text: bodyText.min(1),
    draftVersion: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("suggestion"),
    conversationId: id,
    dismissed: z.boolean(),
  }),
  z.object({
    type: z.literal("knowledge"),
    documentId: id,
    expectedVersion: z.number().int().positive(),
    title: z.string().trim().min(1).max(200),
    body: bodyText.trim().min(1),
    status: z.enum(["pending", "approved", "rejected"]),
  }),
  z.object({
    type: z.literal("createKnowledge"),
    mailboxId: id,
    category: z.enum(categories),
    title: z.string().trim().min(1).max(200),
    body: bodyText.trim().min(1),
  }),
  z.object({
    type: z.literal("readNotifications"),
    notificationIds: z.array(id).max(1000),
  }),
]);
const requestSchema = z.object({
  requestId: z.uuid(),
  userId: id,
  generation: z.uuid(),
  action: actionSchema,
});
export type DemoAction = z.infer<typeof actionSchema>;

function findConversation(state: DemoState, conversationId: string) {
  const conversation = state.conversations.find((c) => c.id === conversationId);
  if (!conversation) throw new ActionError("Nie znaleziono rozmowy.", 404);
  return conversation;
}
function addActivity(
  conversation: Conversation,
  userId: string,
  text: string,
  now: string,
) {
  conversation.activities.push({
    id: randomUUID(),
    userId,
    text,
    createdAt: now,
  });
}
function notify(
  state: DemoState,
  conversation: Conversation,
  type: DemoState["notifications"][number]["type"],
  title: string,
  now: string,
) {
  state.notifications.unshift({
    id: randomUUID(),
    type,
    title,
    body: conversation.subject,
    conversationId: conversation.id,
    createdAt: now,
    readBy: [],
  });
}
function closeConversation(
  state: DemoState,
  conversation: Conversation,
  userId: string,
  now: string,
) {
  conversation.closureVersion++;
  const emailSections = conversation.emails.map((email) => ({
    createdAt: email.createdAt,
    text: `## ${email.direction === "inbound" ? "Klient" : "Odpowiedź demonstracyjna"} — ${email.authorName}\n\n${email.createdAt}\n\n${email.body}`,
  }));
  const noteSections = conversation.comments.map((comment) => ({
    createdAt: comment.createdAt,
    text: `## WEWNĘTRZNY KOMENTARZ — ${state.users.find((u) => u.id === comment.userId)?.name}\n\n${comment.createdAt}\n\n${comment.body}`,
  }));
  state.archives.push({
    conversationId: conversation.id,
    mailboxId: conversation.mailboxId,
    version: conversation.closureVersion,
    createdAt: now,
    markdown: `# ${conversation.subject}\n\nRozmowa: ${conversation.id}\nSkrzynka: ${conversation.mailboxId}\nWersja zamknięcia: ${conversation.closureVersion}\n\n${[
      ...emailSections,
      ...noteSections,
    ]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((s) => s.text)
      .join("\n\n---\n\n")}\n`,
  });
  const lastReply = conversation.emails
    .filter((e) => e.direction === "outbound")
    .at(-1);
  const draft = suggestReply(conversation, state.knowledge);
  state.knowledge.push({
    id: randomUUID(),
    mailboxId: conversation.mailboxId,
    category: conversation.category,
    conversationId: conversation.id,
    versions: [
      {
        version: 1,
        title: `Wnioski: ${conversation.subject}`,
        body:
          lastReply?.body ??
          (draft.sources.length
            ? latestVersion(
                state.knowledge.find((d) => d.id === draft.sources[0].id)!,
              ).body
            : "Brak udokumentowanego rozwiązania. Uzupełnij wnioski przed zatwierdzeniem."),
        status: "pending",
        userId,
        createdAt: now,
      },
    ],
  });
}

export function applyAction(input: unknown) {
  return serial(async () => {
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success)
      throw new ActionError(
        "Nieprawidłowe dane operacji. Sprawdź wymagane pola i długość tekstu.",
      );
    const { requestId, userId, generation, action } = parsed.data;
    const state = await load();
    if (!state.users.some((u) => u.id === userId && isActiveUser(u)))
      throw new ActionError("Nieznany użytkownik.");
    if (state.generation !== generation)
      throw new ActionError(
        "Dane demo zostały przywrócone. Odśwież widok.",
        409,
        "RESET",
      );
    if (state.appliedRequests.includes(requestId)) return snapshot(state);
    const previous = structuredClone(state);
    const now = new Date().toISOString();
    const conversation =
      "conversationId" in action
        ? findConversation(state, action.conversationId)
        : null;
    if (action.type === "updateConversation" && conversation) {
      const patch = action.patch;
      if (
        patch.assigneeId &&
        !state.users.some((u) => u.id === patch.assigneeId && isActiveUser(u))
      )
        throw new ActionError("Nieznany pracownik.");
      if (
        patch.assigneeId !== undefined &&
        patch.assigneeId !== conversation.assigneeId
      ) {
        const name = state.users.find((u) => u.id === patch.assigneeId)?.name;
        addActivity(
          conversation,
          userId,
          name ? `przypisuje rozmowę: ${name}` : "usuwa przypisanie",
          now,
        );
        notify(
          state,
          conversation,
          "assignment",
          name
            ? `Rozmowa przypisana: ${name}`
            : "Rozmowa oczekuje na przypisanie",
          now,
        );
      }
      if (patch.priority && patch.priority !== conversation.priority) {
        addActivity(
          conversation,
          userId,
          `zmienia priorytet na „${patch.priority}”`,
          now,
        );
        if (patch.priority === "Krytyczny")
          notify(state, conversation, "urgent", "Zgłoszenie krytyczne", now);
      }
      if (patch.category && patch.category !== conversation.category)
        addActivity(
          conversation,
          userId,
          `zmienia kategorię na „${patch.category}”`,
          now,
        );
      const shouldArchive =
        patch.status === "Zakończone" && conversation.status !== "Zakończone";
      if (patch.status && patch.status !== conversation.status) {
        addActivity(
          conversation,
          userId,
          `zmienia status na „${patch.status}”`,
          now,
        );
      }
      Object.assign(conversation, patch, { updatedAt: now });
      if (shouldArchive) closeConversation(state, conversation, userId, now);
    } else if (action.type === "saveDraft" && conversation) {
      const key = draftKey(conversation.id, userId, action.mode);
      const existing = state.drafts.find((d) => d.key === key);
      if ((existing?.version ?? 0) !== action.expectedVersion)
        throw new ActionError(
          "Ten szkic został zmieniony w innej karcie tego samego pracownika. Twój tekst pozostaje w edytorze.",
          409,
          "DRAFT_CONFLICT",
        );
      if (action.basePublicRevision > conversation.publicRevision)
        throw new ActionError("Nieprawidłowa wersja rozmowy.");
      const draft = {
        key,
        conversationId: conversation.id,
        userId,
        mode: action.mode,
        text: action.text,
        basePublicRevision: action.basePublicRevision,
        version: (existing?.version ?? 0) + 1,
        updatedAt: now,
      };
      if (existing) Object.assign(existing, draft);
      else state.drafts.push(draft);
    } else if (
      (action.type === "sendReply" || action.type === "addComment") &&
      conversation
    ) {
      const text = action.text.trim();
      if (!text) throw new ActionError("Wpisz treść przed zapisaniem.");
      const mode = action.type === "sendReply" ? "reply" : "comment";
      const draft = state.drafts.find(
        (d) => d.key === draftKey(conversation.id, userId, mode),
      );
      if ((draft?.version ?? 0) !== action.draftVersion)
        throw new ActionError(
          "Szkic zmienił się w innej karcie. Sprawdź jego treść.",
          409,
          "DRAFT_CONFLICT",
        );
      if (action.type === "sendReply") {
        if (action.expectedPublicRevision !== conversation.publicRevision)
          throw new ActionError(
            "W rozmowie pojawiła się nowa wiadomość. Przejrzyj ją przed wysłaniem swojej odpowiedzi.",
            409,
            "NEW_REPLY",
          );
        const mailbox = state.mailboxes.find(
          (b) => b.id === conversation.mailboxId,
        )!;
        if (mailbox.mode !== "demo")
          throw new ActionError(
            mailbox.mode === "imap"
              ? "Odbiór IMAP działa. Wysyłanie SMTP nie jest jeszcze podłączone."
              : "Ta skrzynka nie jest podłączona. Wysyłanie wiadomości jest niedostępne.",
            409,
            "MAILBOX_NOT_CONNECTED",
          );
        conversation.emails.push({
          id: randomUUID(),
          direction: "outbound",
          authorName: state.users.find((u) => u.id === userId)!.name,
          userId,
          from: mailbox.email,
          to: conversation.customer.email,
          body: text,
          demo: true,
          createdAt: now,
        });
        conversation.publicRevision++;
        conversation.status = "Oczekuje na klienta";
        addActivity(
          conversation,
          userId,
          "wysyła odpowiedź demonstracyjną",
          now,
        );
      } else {
        conversation.comments.push({
          id: randomUUID(),
          userId,
          body: text,
          createdAt: now,
        });
      }
      if (draft)
        Object.assign(draft, {
          text: "",
          version: draft.version + 1,
          basePublicRevision: conversation.publicRevision,
          updatedAt: now,
        });
      conversation.updatedAt = now;
    } else if (action.type === "suggestion" && conversation) {
      conversation.suggestionDismissed = action.dismissed;
    } else if (action.type === "knowledge") {
      const document = state.knowledge.find((d) => d.id === action.documentId);
      if (!document) throw new ActionError("Nie znaleziono dokumentu.", 404);
      const latest = latestVersion(document);
      if (latest.version !== action.expectedVersion)
        throw new ActionError(
          "Dokument zmienił się w innej karcie. Otwórz aktualną wersję przed zapisem.",
          409,
          "DOCUMENT_CONFLICT",
        );
      document.versions.push({
        version: latest.version + 1,
        title: action.title,
        body: action.body,
        status: action.status,
        userId,
        createdAt: now,
      });
    } else if (action.type === "createKnowledge") {
      if (!state.mailboxes.some((b) => b.id === action.mailboxId))
        throw new ActionError("Nieznana skrzynka.");
      state.knowledge.push({
        id: randomUUID(),
        mailboxId: action.mailboxId,
        category: action.category,
        versions: [
          {
            version: 1,
            title: action.title,
            body: action.body,
            status: "pending",
            userId,
            createdAt: now,
          },
        ],
      });
    } else if (action.type === "readNotifications") {
      for (const notification of state.notifications)
        if (
          action.notificationIds.includes(notification.id) &&
          !notification.readBy.includes(userId)
        )
          notification.readBy.push(userId);
    }
    state.revision++;
    state.appliedRequests.push(requestId);
    // Commit state only after its Markdown copies exist; an interrupted operation
    // can leave an unreferenced file, but never acknowledges an absent archive.
    await materialize(state, previous);
    await atomicWrite(file, JSON.stringify(state, null, 2));
    return snapshot(state);
  });
}

const presenceSchema = z.object({
  sessionId: z.uuid(),
  userId: id,
  conversationId: id.nullable(),
  mode: z.enum(["viewing", "replying", "commenting"]),
  generation: z.uuid(),
});
export function heartbeat(input: unknown) {
  return serial(async () => {
    const parsed = presenceSchema.safeParse(input);
    if (!parsed.success) throw new ActionError("Nieprawidłowa obecność.");
    const presence = parsed.data;
    const state = await load();
    if (presence.generation !== state.generation)
      throw new ActionError("Demo zostało przywrócone.", 409);
    if (!state.users.some((u) => u.id === presence.userId && isActiveUser(u)))
      throw new ActionError("Nieznany użytkownik.");
    if (presence.conversationId === null)
      runtime.presence.delete(presence.sessionId);
    else {
      findConversation(state, presence.conversationId);
      runtime.presence.set(presence.sessionId, {
        ...presence,
        conversationId: presence.conversationId,
        seenAt: Date.now(),
      });
    }
    return { ok: true };
  });
}

export function getArchive(conversationId: string) {
  return serial(async () => {
    const state = await load();
    const archive = state.archives
      .filter((a) => a.conversationId === conversationId)
      .at(-1);
    if (!archive)
      throw new ActionError(
        "Ta rozmowa nie ma jeszcze archiwum. Zakończ ją, aby utworzyć plik.",
        404,
      );
    return archive.markdown;
  });
}

export function repairMarkdown() {
  return serial(async () => materialize(await load()));
}
