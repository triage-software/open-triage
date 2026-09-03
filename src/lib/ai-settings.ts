import "server-only";
import path from "node:path";
import { createAiSettingsStore } from "./ai-settings-store";

const shared = globalThis as typeof globalThis & { openTriageAiSettingsQueue?: { queue: Promise<unknown> } };
const runtime = shared.openTriageAiSettingsQueue ??= { queue: Promise.resolve() };
export const aiSettings = createAiSettingsStore(
  path.join(process.cwd(), "data/prototype/settings/openrouter.json"),
  runtime,
);
