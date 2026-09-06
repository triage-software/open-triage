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
  model: string;
  generatedAt: string;
  generatedBy: string;
  publicRevision: number;
  settingsVersion: number;
  knowledgeStamp: string;
  contextHash: string;
  usage?: AiUsage;
}
export interface AiClassification {
  category: Category;
  priority: Priority;
  reason: string;
  model: string;
  generatedAt: string;
  settingsVersion: number;
  contextHash: string;
  usage?: AiUsage;
}
export interface AiTriage {
  id: string;
  status: "pending" | "applied" | "manual" | "error";
  attempts: number;
  nextAttemptAt?: string;
  error?: string;
  result?: AiClassification;
}
export function knowledgeStamp(knowledge: KnowledgeDocument[], mailboxId: string) {
  return knowledge.filter((doc) => doc.mailboxId === mailboxId && doc.versions.at(-1)?.status === "approved")
    .map((doc) => `${doc.id}:${doc.versions.at(-1)!.version}`).sort().join("|");
}
