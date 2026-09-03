import { mkdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { defaultAiModel, type AiSettingsPublic } from "./ai-types";

export class AiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = "AI_ERROR") {
    super(message); this.name = "OpenTriageAiError"; this.status = status; this.code = code;
  }
}
// In-flight requests can retain an old error class during Next development reloads.
export function isAiError(error: unknown): error is AiError {
  return error instanceof Error && error.name === "OpenTriageAiError" &&
    "status" in error && typeof error.status === "number" && "code" in error && typeof error.code === "string";
}
export interface AiSettings { version: number; model: string; apiKey?: string; verifiedAt?: string }
const updateSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  model: z.string().trim().min(3).max(200).regex(/^[a-zA-Z0-9~._:/-]+$/),
  apiKey: z.string().trim().min(20).max(4096).regex(/^sk-or-\S+$/).optional(),
  clearKey: z.boolean().optional(),
}).strict();

export function publicAiSettings(settings: AiSettings): AiSettingsPublic {
  return { version: settings.version, model: settings.model, configured: !!settings.apiKey, verifiedAt: settings.verifiedAt };
}

export function createAiSettingsStore(filename: string, runtime = { queue: Promise.resolve() as Promise<unknown> }) {
  function serial<T>(fn: () => Promise<T>) {
    const pending = runtime.queue.then(fn, fn);
    runtime.queue = pending.catch(() => undefined);
    return pending;
  }
  async function read(): Promise<AiSettings> {
    try { return JSON.parse(await readFile(filename, "utf8")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 0, model: defaultAiModel };
      throw new AiError("Nie można odczytać ustawień AI.", 500);
    }
  }
  async function write(settings: AiSettings) {
    await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(settings, null, 2), { mode: 0o600 });
      await rename(temporary, filename);
    } catch {
      await unlink(temporary).catch(() => undefined);
      throw new AiError("Nie udało się zapisać ustawień AI na dysku.", 500);
    }
  }
  return {
    get: () => serial(read),
    getPublic: () => serial(async () => publicAiSettings(await read())),
    update: (input: unknown) => serial(async () => {
      const parsed = updateSchema.safeParse(input);
      if (!parsed.success) throw new AiError("Sprawdź identyfikator modelu i klucz OpenRouter (sk-or-…).", 400, "INVALID_SETTINGS");
      const change = parsed.data;
      if (change.apiKey && change.clearKey) throw new AiError("Nie można jednocześnie zapisać i usunąć klucza.");
      const previous = await read();
      if (previous.version !== change.expectedVersion) throw new AiError("Ustawienia zmieniły się w innej karcie. Wczytaj aktualne ustawienia.", 409, "SETTINGS_CONFLICT");
      const next: AiSettings = {
        version: previous.version + 1,
        model: change.model,
        apiKey: change.clearKey ? undefined : change.apiKey ?? previous.apiKey,
      };
      await write(next);
      return publicAiSettings(next);
    }),
    markVerified: (version: number) => serial(async () => {
      const current = await read();
      if (version !== current.version) throw new AiError("Ustawienia zmieniły się podczas sprawdzania. Sprawdź je ponownie.", 409, "SETTINGS_CONFLICT");
      current.verifiedAt = new Date().toISOString();
      await write(current);
      return publicAiSettings(current);
    }),
  };
}
