import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// This isolated Node process exercises server modules without Next's import marker.
// All state and settings live in a temporary directory, and every fetch is mocked.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
  return nextResolve(specifier, context);
} });

test("generowanie: trwały wynik, jedna równoległa operacja, brak nadpisania nowszej rozmowy i eskalacja", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "open-triage-ai-service-"));
  const originalCwd = process.cwd();
  const originalFetch = globalThis.fetch;
  try {
    process.chdir(directory);
    const { seedState } = await import("../src/lib/seed.ts");
    const state = seedState();
    state.conversations.push({ id: "thread", number: 1, mailboxId: "test", subject: "Licencja", customer: { name: "Klient", email: "client@example.test", company: "Firma" },
      category: "Inne", priority: "Normalny", status: "Nowe", assigneeId: null, publicRevision: 1,
      createdAt: "2026-09-03", updatedAt: "2026-09-03", closureVersion: 0, suggestionDismissed: false,
      emails: [{ id: "inbound", direction: "inbound", from: "client@example.test", to: "test@sellersk.it", createdAt: "2026-09-03", body: "Jak działa licencja?" }],
      comments: [{ id: "internal", body: "INTERNAL_SECRET", userId: state.users[0].id }], activities: [] });
    state.knowledge.push({ id: "doc", mailboxId: "test", category: "Licencja", versions: [{ version: 1, title: "Licencja", body: "Instrukcja testowa", status: "approved", userId: state.users[0].id, createdAt: "2026-09-03" }] });
    const filename = path.join(directory, "data/prototype/state.json");
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, JSON.stringify(state));
    const { aiSettings } = await import("../src/lib/ai-settings.ts");
    const { generateAiSuggestion } = await import("../src/lib/ai-service.ts");
    const { getState } = await import("../src/lib/store.ts");
    const input = { conversationId: "thread", generation: state.generation, userId: state.users[0].id };
    await assert.rejects(generateAiSuggestion(input), { code: "AI_NOT_CONFIGURED" });
    await aiSettings.update({ expectedVersion: 0, model: "z-ai/glm-5.3", apiKey: "sk-or-v1-fake-isolated-service-test" });
    let calls = 0, beforeResponse = async () => {}, noSource = false;
    globalThis.fetch = async (url, options) => {
      if (url === "https://openrouter.ai/api/v1/models") return Response.json({ data: [{ id: "z-ai/glm-5.3", name: "GLM 5.3", supported_parameters: ["structured_outputs"], architecture: { output_modalities: ["text"] } }] });
      assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
      assert.ok(!options.body.includes("INTERNAL_SECRET"));
      calls++; await beforeResponse();
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ text: noSource ? "" : "Propozycja odpowiedzi", sourceIds: noSource ? [] : ["doc"], needsHuman: noSource, reason: "Uzasadnienie", category: "Licencja", priority: "Normalny" }) } }], usage: { cost: 0.002, prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } });
    };
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let providerStarted;
    const started = new Promise((resolve) => { providerStarted = resolve; });
    beforeResponse = async () => { providerStarted(); await gate; };
    const first = generateAiSuggestion(input);
    await started;
    const second = generateAiSuggestion(input);
    release();
    const results = await Promise.all([first, second]);
    assert.deepEqual(results[0], results[1]);
    assert.equal(calls, 1);
    const publicState = await getState();
    assert.equal(publicState.conversations[0].aiSuggestion.text, "Propozycja odpowiedzi");
    assert.equal(publicState.conversations[0].emails.length, 1);
    assert.equal(publicState.drafts.length, 0);
    assert.deepEqual(publicState.aiUsageSummary, { requests: 1, cost: 0.002, promptTokens: 100, completionTokens: 20, totalTokens: 120 });
    assert.ok(!JSON.stringify(publicState).includes("sk-or-v1-"));
    assert.ok(!(await readFile(filename, "utf8")).includes("sk-or-v1-"));
    await generateAiSuggestion(input);
    assert.equal(calls, 1);
    assert.equal((await getState()).aiUsageSummary.requests, 1);
    const savedTime = results[0].generatedAt;
    beforeResponse = async () => {
      const current = JSON.parse(await readFile(filename, "utf8"));
      current.conversations[0].publicRevision++;
      current.conversations[0].emails.push({ ...current.conversations[0].emails[0], id: "new", body: "Nowa publiczna wiadomość" });
      await writeFile(filename, JSON.stringify(current));
    };
    await assert.rejects(generateAiSuggestion({ ...input, force: true }), { code: "STALE_AI_CONTEXT" });
    assert.equal((await getState()).conversations[0].aiSuggestion.generatedAt, savedTime);
    assert.equal((await getState()).aiUsageSummary.requests, 2);
    beforeResponse = async () => {
      const settings = await aiSettings.getPublic();
      await aiSettings.update({ expectedVersion: settings.version, model: settings.model });
    };
    await assert.rejects(generateAiSuggestion({ ...input, force: true }), { code: "STALE_AI_CONTEXT" });
    beforeResponse = async () => {
      const current = JSON.parse(await readFile(filename, "utf8"));
      current.knowledge[0].versions[0].body = "Nowa instrukcja";
      await writeFile(filename, JSON.stringify(current));
    };
    await assert.rejects(generateAiSuggestion({ ...input, force: true }), { code: "STALE_AI_CONTEXT" });
    const withoutKnowledge = JSON.parse(await readFile(filename, "utf8"));
    withoutKnowledge.knowledge[0].versions.at(-1).status = "rejected";
    await writeFile(filename, JSON.stringify(withoutKnowledge));
    beforeResponse = async () => {}; noSource = true;
    const escalation = await generateAiSuggestion({ ...input, force: true });
    assert.equal(escalation.needsHuman, true); assert.equal(escalation.text, "");
    await generateAiSuggestion({ ...input, force: true });
    assert.equal((await getState()).notifications.filter((item) => item.type === "escalation").length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(originalCwd);
    await rm(directory, { recursive: true, force: true });
  }
});
