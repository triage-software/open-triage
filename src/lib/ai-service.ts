import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { aiSettings } from "./ai-settings";
import { AiError } from "./ai-settings-store";
import { buildAiContext } from "./ai-context";
import { completeAiReply, getAiKeyUsage, listAiModels, verifyAiKey } from "./openrouter-client";
import { getState, recordAiUsage, saveAiSuggestion } from "./store";
import { isActiveUser } from "./team";
import type { AiModel, AiSuggestion } from "./ai-types";

const shared = globalThis as typeof globalThis & { openTriageAiRuntime?: {
  models?: { items: AiModel[]; expiresAt: number };
  modelRequest?: Promise<AiModel[]>;
  requests: Map<string, Promise<AiSuggestion>>;
} };
const runtime: NonNullable<typeof shared.openTriageAiRuntime> = shared.openTriageAiRuntime ??= { requests: new Map() };

export async function getAiModels() {
  if (runtime.models && runtime.models.expiresAt > Date.now()) return runtime.models.items;
  if (!runtime.modelRequest) runtime.modelRequest = listAiModels().then((items) => {
    runtime.models = { items, expiresAt: Date.now() + 3_600_000 };
    return items;
  }).finally(() => { runtime.modelRequest = undefined; });
  return runtime.modelRequest;
}
async function selectedModel(id: string) {
  const model = (await getAiModels()).find((item) => item.id === id);
  if (!model) throw new AiError("Wybrany model jest niedostępny lub nie obsługuje wymaganej struktury odpowiedzi. Zmień model w ustawieniach.", 400, "UNSUPPORTED_MODEL");
  return model;
}
export async function testAiConnection() {
  const settings = await aiSettings.get();
  if (!settings.apiKey) throw new AiError("Najpierw zapisz klucz OpenRouter w ustawieniach.", 400, "AI_NOT_CONFIGURED");
  await verifyAiKey(settings.apiKey);
  await selectedModel(settings.model);
  return aiSettings.markVerified(settings.version);
}
export async function getOpenRouterUsage() {
  const settings = await aiSettings.get();
  if (!settings.apiKey) throw new AiError("Najpierw zapisz klucz OpenRouter w ustawieniach.", 400, "AI_NOT_CONFIGURED");
  return getAiKeyUsage(settings.apiKey);
}
const inputSchema = z.object({
  conversationId: z.string().min(1).max(100),
  generation: z.string().min(1).max(100),
  userId: z.string().min(1).max(100),
  force: z.boolean().optional(),
}).strict();

export async function generateAiSuggestion(input: unknown) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new AiError("Nieprawidłowe żądanie generowania.");
  const { conversationId, generation, userId, force } = parsed.data;
  const state = await getState();
  if (state.generation !== generation) throw new AiError("Dane zmieniły się. Odśwież panel.", 409, "STALE_AI_CONTEXT");
  if (!state.users.some((user) => user.id === userId && isActiveUser(user))) throw new AiError("Wybierz aktywnego pracownika.");
  const conversation = state.conversations.find((item) => item.id === conversationId);
  const mailbox = state.mailboxes.find((item) => item.id === conversation?.mailboxId);
  if (!conversation || !mailbox) throw new AiError("Nie znaleziono rozmowy.", 404);
  const settings = await aiSettings.get();
  if (!settings.apiKey) throw new AiError("Dodaj klucz OpenRouter w Ustawieniach, aby generować odpowiedzi.", 400, "AI_NOT_CONFIGURED");
  const context = buildAiContext(conversation, mailbox, state.knowledge);
  const previous = conversation.aiSuggestion;
  if (!force && previous && previous.publicRevision === conversation.publicRevision &&
      previous.contextHash === context.hash && previous.knowledgeStamp === context.knowledgeStamp && previous.settingsVersion === settings.version)
    return previous;
  const key = `${generation}:${conversationId}:${conversation.publicRevision}:${context.hash}:${context.knowledgeStamp}:${settings.version}`;
  const pending = runtime.requests.get(key);
  if (pending) return pending;
  const apiKey = settings.apiKey;
  const request = (async () => {
    const model = await selectedModel(settings.model);
    const usageId = randomUUID();
    const result = await completeAiReply(context, apiKey, model, fetch, (usage) => recordAiUsage({
      id: usageId, conversationId, model: model.id, generatedAt: new Date().toISOString(), ...usage,
    }));
    return saveAiSuggestion(conversationId, generation, {
      ...result, model: model.id, generatedAt: new Date().toISOString(), generatedBy: userId,
      publicRevision: conversation.publicRevision, settingsVersion: settings.version,
      knowledgeStamp: context.knowledgeStamp, contextHash: context.hash,
    });
  })().finally(() => runtime.requests.delete(key));
  runtime.requests.set(key, request);
  return request;
}
