import { createHash } from "node:crypto";
import { z } from "zod";
import { categories, priorities } from "./types";
import type { Conversation, KnowledgeDocument, Mailbox } from "./types";
import { knowledgeStamp } from "./ai-types";
import { AiError } from "./ai-settings-store";

export function buildAiContext(conversation: Conversation, mailbox: Mailbox, knowledge: KnowledgeDocument[]) {
  const words = new Set(`${conversation.subject} ${conversation.emails.at(-1)?.body ?? ""}`.toLocaleLowerCase("pl").match(/[\p{L}\p{N}]{4,}/gu) ?? []);
  const documents = knowledge.filter((doc) => doc.mailboxId === mailbox.id && doc.versions.at(-1)?.status === "approved")
    .map((doc) => {
      const version = doc.versions.at(-1)!;
      const text = `${version.title} ${version.body}`.toLocaleLowerCase("pl");
      return { id: doc.id, version: version.version, title: version.title, body: version.body.slice(0, 8000), score: [...words].filter((word) => text.includes(word)).length };
    }).filter((doc) => doc.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 8)
    // Select by relevance, then serialize in a stable order for prefix caching.
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(({ score: _score, ...doc }) => doc);
  const data = {
    mailbox: { id: mailbox.id, name: mailbox.name, email: mailbox.email },
    subject: conversation.subject,
    // Deliberate allowlist: no comments, drafts, activity, settings, or outbox.
    emails: conversation.emails.slice(-12).map((email) => ({
      direction: email.direction, from: email.from, to: email.to,
      createdAt: email.createdAt, body: email.body.slice(0, 6000),
    })),
    documents,
  };
  return {
    data,
    hash: createHash("sha256").update(JSON.stringify(data)).digest("hex"),
    knowledgeStamp: knowledgeStamp(knowledge, mailbox.id),
  };
}
export type AiContext = ReturnType<typeof buildAiContext>;
export const aiOutputSchema = z.object({
  text: z.string().max(12000),
  sourceIds: z.array(z.string()).max(8),
  needsHuman: z.boolean(),
  reason: z.string().max(2000),
  category: z.enum(categories),
  priority: z.enum(priorities),
}).strict();

export function validateAiOutput(value: unknown, context: AiContext) {
  const parsed = aiOutputSchema.safeParse(value);
  if (!parsed.success) throw new AiError("Model zwrócił nieprawidłową propozycję. Spróbuj ponownie.", 502, "INVALID_AI_RESPONSE");
  const answer = parsed.data;
  if (answer.sourceIds.some((id) => !context.data.documents.some((doc) => doc.id === id)))
    throw new AiError("Model wskazał źródło spoza wiedzy tej skrzynki. Propozycja została odrzucona.", 502, "INVALID_AI_SOURCE");
  if (context.data.documents.length && !answer.sourceIds.length)
    throw new AiError("Model pominął trafną wiedzę tej skrzynki. Propozycja została odrzucona.", 502, "INVALID_AI_SOURCE");
  if (context.data.documents.length && (answer.needsHuman || !answer.text.trim()))
    throw new AiError("Model nie zastosował trafnej wiedzy tej skrzynki. Propozycja została odrzucona.", 502, "INVALID_AI_RESPONSE");
  const sources = [...new Set(answer.sourceIds)].map((id) => {
    const doc = context.data.documents.find((doc) => doc.id === id)!;
    return { id: doc.id, title: doc.title, version: doc.version };
  });
  const hasKnowledge = sources.length > 0;
  return {
    text: hasKnowledge ? answer.text.trim() : "",
    sources,
    needsHuman: answer.needsHuman || !hasKnowledge,
    reason: hasKnowledge ? answer.reason : "Brak zatwierdzonego źródła rozwiązania. Przekaż sprawę człowiekowi lub uzupełnij wiedzę tej skrzynki.",
    category: answer.category,
    priority: answer.priority,
  };
}
