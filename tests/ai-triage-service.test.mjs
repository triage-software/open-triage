import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";

// All IMAP, AI requests, and persisted state are isolated from the real mailbox.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
  if (specifier === "imapflow") return { url: "data:text/javascript,export const ImapFlow = globalThis.triageTestImap", shortCircuit: true };
  return nextResolve(specifier, context);
} });

const mail = (id, references = []) => ({ subject: "Licencja", email: {
  id, messageId: `<${id}@example.test>`, references, direction: "inbound", authorName: "Klient",
  from: "client@example.test", to: "support@example.com", body: `Licencja ${id}`, createdAt: new Date().toISOString(),
} });

test("automatyczna klasyfikacja po odbiorze — izolowany IMAP, AI i trwały zapis", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "open-triage-classification-"));
  const originalCwd = process.cwd(), originalFetch = globalThis.fetch;
  const env = Object.fromEntries(["TRIAGE_IMAP_HOST", "TRIAGE_IMAP_USER", "TRIAGE_IMAP_PASSWORD"].map((key) => [key, process.env[key]]));
  let calls = 0, beforeResponse = async () => {}, failure = false;
  let answer = { category: "Licencja", priority: "Wysoki", reason: "Problem z licencją." };
  globalThis.triageTestImap = class {
    mailbox = { uidValidity: 1n, exists: 1 };
    on() {}
    async connect() {}
    async getMailboxLock() { return { release() {} }; }
    async search() { return [1]; }
    async fetchOne() { return { source: Buffer.from([
      "From: Klient <client@example.test>", "To: support@example.com", "Subject: Licencja",
      "Message-ID: <first@example.test>", "Content-Type: text/plain; charset=utf-8", "", "Problem z licencja.",
    ].join("\r\n")) }; }
    close() {}
  };
  try {
    process.chdir(directory);
    process.env.TRIAGE_IMAP_HOST = "imap.example.test";
    process.env.TRIAGE_IMAP_USER = "support@example.com";
    process.env.TRIAGE_IMAP_PASSWORD = "fake-test-password";
    globalThis.fetch = async (url, options) => {
      if (url === "https://openrouter.ai/api/v1/models") return Response.json({ data: [{
        id: "z-ai/glm-5.3", name: "Test", supported_parameters: ["structured_outputs"], architecture: { output_modalities: ["text"] },
      }] });
      assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
      assert.equal(JSON.parse(options.body).response_format.json_schema.name, "support_classification");
      for (const secret of ["INTERNAL_SECRET", "PRIVATE_DRAFT"]) assert.ok(!options.body.includes(secret));
      calls++;
      const result = { ...answer };
      await beforeResponse();
      if (failure) return Response.json({ error: "PRIVATE_PROVIDER_ERROR" }, { status: 429 });
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(result) } }],
        usage: { cost: 0.001, prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
    };
    const { aiSettings } = await import("../src/lib/ai-settings.ts");
    const { getState, saveMailSync, applyAction, queueAiTriage } = await import("../src/lib/store.ts");
    const { processAiTriage } = await import("../src/lib/ai-triage-service.ts");
    const { syncTestMailbox } = await import("../src/lib/mail-sync.ts");
    const filename = path.join(directory, "data/prototype/state.json");
    const changeState = async (change) => {
      const value = JSON.parse(await readFile(filename, "utf8")); change(value);
      await writeFile(filename, JSON.stringify(value));
    };
    let conversationId, generation, userId;
    const current = async () => (await getState()).conversations.find((item) => item.id === conversationId);
    const queue = () => queueAiTriage(conversationId, generation, userId);

    await t.test("brak klucza nie blokuje importu, a cykl synchronizacji uruchamia klasyfikację bez otwierania UI", async () => {
      await syncTestMailbox(); await processAiTriage();
      const state = await getState();
      conversationId = state.conversations[0].id; generation = state.generation; userId = state.users[0].id;
      assert.equal(state.mailSync.test.status, "connected");
      assert.equal((await current()).aiTriage.status, "pending");
      assert.equal(calls, 0);
      await changeState((value) => {
        value.conversations[0].comments.push({ id: "note", userId, body: "INTERNAL_SECRET" });
        value.drafts.push({ key: "draft", conversationId, userId, mode: "reply", text: "PRIVATE_DRAFT", version: 1 });
        // Historical mail without an import marker is deliberately not backfilled.
        value.conversations.push({ ...structuredClone(value.conversations[0]), id: "historical", aiTriage: undefined });
      });
      await aiSettings.update({ expectedVersion: 0, model: "z-ai/glm-5.3", apiKey: "sk-or-v1-fake-classification-test" });
      await syncTestMailbox(); await processAiTriage();
      const updated = await current();
      assert.equal(calls, 1);
      assert.equal(updated.category, "Licencja"); assert.equal(updated.priority, "Wysoki");
      assert.equal(updated.aiTriage.status, "applied");
      assert.equal(updated.aiSuggestion, undefined); assert.equal(updated.emails.length, 1);
      assert.equal(updated.publicRevision, 1); assert.equal(updated.activities[0].userId, "ai");
      assert.equal((await getState()).drafts[0].text, "PRIVATE_DRAFT");
      assert.equal((await getState()).aiUsageSummary.requests, 1);
      assert.equal(JSON.parse(await readFile(filename, "utf8")).conversations[0].aiTriage.status, "applied");
      await syncTestMailbox(); await processAiTriage();
      assert.equal(calls, 1);
    });

    await t.test("równoległe uruchomienia wykonują tylko jedno wywołanie AI", async () => {
      await queue();
      const count = calls;
      const first = processAiTriage(), second = processAiTriage();
      assert.equal(first, second);
      await Promise.all([first, second]);
      assert.equal(calls, count + 1);
    });

    await t.test("ręczna zmiana chroni przed spóźnionym wynikiem, również po zmianie i cofnięciu wartości", async () => {
      await queue();
      beforeResponse = async () => {
        for (const priority of ["Niski", "Wysoki"]) await applyAction({ requestId: randomUUID(), userId, generation,
          action: { type: "updateConversation", conversationId, patch: { category: "Support", priority } } });
      };
      answer = { category: "Awaria", priority: "Krytyczny", reason: "Nieaktualna odpowiedź" };
      await processAiTriage(); beforeResponse = async () => {};
      assert.equal((await current()).category, "Support");
      assert.equal((await current()).priority, "Wysoki");
      assert.equal((await current()).aiTriage.status, "manual");
      assert.equal((await getState()).notifications.length, 0);
    });

    await t.test("nowszy mail odrzuca stary wynik i jest klasyfikowany w tym samym przebiegu", async () => {
      await queue();
      const count = calls;
      beforeResponse = async () => {
        beforeResponse = async () => {};
        answer = { category: "Support", priority: "Normalny", reason: "Nowe informacje" };
        await saveMailSync({}, [mail("reply", ["<first@example.test>"])]);
      };
      await processAiTriage();
      assert.equal(calls, count + 2);
      assert.equal((await current()).aiTriage.result.reason, "Nowe informacje");
      assert.equal((await current()).category, "Support");
      assert.equal((await current()).emails.length, 2);
      assert.equal((await getState()).notifications.length, 0);
    });

    await t.test("zmiana konfiguracji w trakcie generowania unieważnia wynik", async () => {
      await queue();
      const count = calls;
      beforeResponse = async () => {
        beforeResponse = async () => {};
        const settings = await aiSettings.getPublic();
        await aiSettings.update({ expectedVersion: settings.version, model: settings.model });
      };
      await processAiTriage();
      assert.equal(calls, count + 2);
      assert.equal((await current()).aiTriage.result.settingsVersion, (await aiSettings.getPublic()).version);
    });

    await t.test("awaria AI pozostawia zapisany mail i trwałe ponowienie z opóźnieniem", async () => {
      await queue(); failure = true;
      await processAiTriage();
      const count = calls, failed = (await current()).aiTriage;
      assert.equal(failed.status, "error"); assert.equal(failed.attempts, 1);
      assert.ok(Date.parse(failed.nextAttemptAt) > Date.now());
      assert.equal((await current()).category, "Support");
      assert.equal((await current()).emails.length, 2);
      assert.ok(!(await readFile(filename, "utf8")).includes("PRIVATE_PROVIDER_ERROR"));
      await processAiTriage(); assert.equal(calls, count);
      failure = false;
      await changeState((value) => { value.conversations[0].aiTriage.nextAttemptAt = new Date(0).toISOString(); });
      await processAiTriage();
      assert.equal(calls, count + 1); assert.equal((await current()).aiTriage.status, "applied");
    });

    await t.test("krytyczna klasyfikacja powiadamia raz, nie zmienia szkicu ani nie wysyła poczty", async () => {
      answer = { category: "Awaria", priority: "Krytyczny", reason: "Awaria usługi" };
      await queue(); await processAiTriage();
      await queue(); await processAiTriage();
      const state = await getState();
      assert.equal(state.notifications.filter((item) => item.type === "urgent").length, 1);
      assert.equal(state.drafts[0].text, "PRIVATE_DRAFT");
      assert.equal((await current()).emails.filter((email) => email.direction === "outbound").length, 0);
      assert.equal(state.outgoing.length, 0);
      assert.equal((await current()).aiSuggestion, undefined);
    });
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.triageTestImap;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    process.chdir(originalCwd);
    await rm(directory, { recursive: true, force: true });
  }
});
