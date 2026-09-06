import "server-only";
import { randomUUID } from "node:crypto";
import { aiSettings } from "./ai-settings";
import { isAiError } from "./ai-settings-store";
import { selectedModel } from "./ai-service";
import { buildClassificationContext } from "./ai-context";
import { completeAiClassification } from "./openrouter-client";
import { failAiTriage, getState, recordAiUsage, saveAiClassification } from "./store";

const shared = globalThis as typeof globalThis & { openTriageClassificationRuntime?: { pending?: Promise<void> } };
const runtime = shared.openTriageClassificationRuntime ??= {};

// A single worker drains persisted import markers. No network calls hold the
// state write queue or IMAP lock; pending work survives a server restart.
export function processAiTriage() {
  if (!runtime.pending) runtime.pending = drain().finally(() => { runtime.pending = undefined; });
  return runtime.pending;
}

export function startAiTriage() {
  void processAiTriage().catch(() => {
    console.error("Nie można przetworzyć zapisanej kolejki klasyfikacji AI.");
  });
}

async function drain() {
  while (true) {
    const settings = await aiSettings.get();
    if (!settings.apiKey) return;
    const state = await getState();
    const conversation = state.conversations.find((item) => item.aiTriage &&
      (item.aiTriage.status === "pending" || (item.aiTriage.status === "error" &&
        Date.parse(item.aiTriage.nextAttemptAt ?? "") <= Date.now())));
    const job = conversation?.aiTriage;
    if (!conversation || !job) return;
    try {
      const mailbox = state.mailboxes.find((item) => item.id === conversation.mailboxId);
      if (!mailbox) throw new Error("Missing mailbox");
      const context = buildClassificationContext(conversation, mailbox);
      const model = await selectedModel(settings.model);
      const usageId = randomUUID();
      const result = await completeAiClassification(context, settings.apiKey, model, fetch, (usage) => recordAiUsage({
        id: usageId, conversationId: conversation.id, model: model.id, generatedAt: new Date().toISOString(), ...usage,
      }));
      await saveAiClassification(conversation.id, state.generation, job.id, {
        ...result, model: model.id, generatedAt: new Date().toISOString(),
        settingsVersion: settings.version, contextHash: context.hash,
      });
    } catch (error) {
      await failAiTriage(conversation.id, state.generation, job.id,
        isAiError(error) ? error.message : "Nie udało się przypisać kategorii i priorytetu. Spróbujemy ponownie.");
    }
  }
}
