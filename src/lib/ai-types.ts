import type { KnowledgeDocument, Suggestion, Category, Priority } from "./types";

export const defaultAiModel = "z-ai/glm-5.3";
export interface AiSettingsPublic {
  version: number;
  configured: boolean;
  model: string;
  verifiedAt?: string;
}
export interface AiModel { id: string; name: string; reasoning: boolean }
export interface AiUsage {
  cost: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}
export interface AiUsageSummary extends AiUsage { requests: number }
export interface AiKeyUsage {
  usage: number;
  usageDaily?: number;
  usageWeekly?: number;
  usageMonthly?: number;
  limit?: number;
  remaining?: number;
  freeTier: boolean;
}
export interface AiSuggestion extends Suggestion {
  reason: string;
  category: Category;
  priority: Priority;
  model: string;
  generatedAt: string;
  generatedBy: string;
  publicRevision: number;
  settingsVersion: number;
  knowledgeStamp: string;
  contextHash: string;
  usage?: AiUsage;
}
export function knowledgeStamp(knowledge: KnowledgeDocument[], mailboxId: string) {
  return knowledge.filter((doc) => doc.mailboxId === mailboxId && doc.versions.at(-1)?.status === "approved")
    .map((doc) => `${doc.id}:${doc.versions.at(-1)!.version}`).sort().join("|");
}
