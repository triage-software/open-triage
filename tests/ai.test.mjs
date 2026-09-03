import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createAiSettingsStore } from "../src/lib/ai-settings-store.ts";
import { buildAiContext, validateAiOutput } from "../src/lib/ai-context.ts";
import { listAiModels, verifyAiKey, getAiKeyUsage, completeAiReply } from "../src/lib/openrouter-client.ts";

const fakeKey = "sk-or-v1-test-placeholder-not-a-real-key";
const model = { id: "z-ai/glm-5.3", name: "GLM 5.3", reasoning: true };
const mailbox = { id: "test", name: "Test", email: "test@example.test" };
const doc = (id, mailboxId = "test", status = "approved") => ({ id, mailboxId, versions: [{ version: 1, status, title: `Licencja ${id}`, body: `Instrukcja licencji ${id}` }] });
const conversation = { subject: "Licencja", emails: [{ direction: "inbound", from: "client@example.test", to: mailbox.email, body: "Pytanie o licencję", createdAt: "2026-09-03" }], comments: [{ body: "INTERNAL_SECRET" }], drafts: ["PRIVATE_DRAFT"] };
const context = buildAiContext(conversation, mailbox, [doc("approved"), doc("foreign", "other"), doc("rejected", "test", "rejected"), doc("pending", "test", "pending")]);
const answer = { text: "Dzień dobry, oto instrukcja.", sourceIds: ["approved"], needsHuman: false, reason: "Wiedza zawiera instrukcję.", category: "Licencja", priority: "Normalny" };
const completed = (content = JSON.stringify(answer), finish_reason = "stop") => Response.json({
  choices: [{ finish_reason, message: { content } }],
  usage: { cost: 0.00125, prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
});

test("ustawienia: zapis prywatny, restart, CAS, zmiana modelu, usunięcie klucza", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "open-triage-ai-"));
  try {
    const filename = path.join(directory, "settings/openrouter.json");
    const store = createAiSettingsStore(filename);
    assert.deepEqual(await store.getPublic(), { version: 0, model: model.id, configured: false, verifiedAt: undefined });
    await assert.rejects(store.update({ expectedVersion: 0, model: model.id, apiKey: "bad" }), { code: "INVALID_SETTINGS" });
    const saved = await store.update({ expectedVersion: 0, model: model.id, apiKey: fakeKey });
    assert.equal(saved.configured, true);
    assert.ok(!JSON.stringify(saved).includes(fakeKey));
    assert.equal((await stat(filename)).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await readFile(filename, "utf8")).apiKey, fakeKey);
    const restarted = createAiSettingsStore(filename);
    assert.equal((await restarted.get()).apiKey, fakeKey);
    const outcomes = await Promise.allSettled([store.update({ expectedVersion: 1, model: "z-ai/glm-5.1" }), store.update({ expectedVersion: 1, model: "z-ai/glm-5.2" })]);
    assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(outcomes.find((item) => item.status === "rejected").reason.code, "SETTINGS_CONFLICT");
    assert.equal((await store.get()).apiKey, fakeKey);
    await assert.rejects(store.markVerified(1), { code: "SETTINGS_CONFLICT" });
    assert.ok((await store.markVerified(2)).verifiedAt);
    const removed = await store.update({ expectedVersion: 2, model: model.id, clearKey: true });
    assert.equal(removed.configured, false);
    assert.equal(removed.verifiedAt, undefined);
    assert.ok(!(await readFile(filename, "utf8")).includes(fakeKey));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("kontekst obejmuje wyłącznie publiczną rozmowę i zatwierdzoną aktualną wiedzę skrzynki", () => {
  assert.deepEqual(context.data.documents.map((item) => item.id), ["approved"]);
  const encoded = JSON.stringify(context);
  for (const secret of ["INTERNAL_SECRET", "PRIVATE_DRAFT", "foreign", "rejected", "pending"]) assert.ok(!encoded.includes(secret));
  const revoked = doc("revoked"); revoked.versions.push({ ...revoked.versions[0], version: 2, status: "rejected" });
  assert.deepEqual(buildAiContext(conversation, mailbox, [revoked]).data.documents, []);
  assert.equal(buildAiContext({ ...conversation, comments: [{ body: "zmiana komentarza" }] }, mailbox, [doc("approved")]).hash, context.hash);
  assert.notEqual(buildAiContext({ ...conversation, subject: "Nowy temat" }, mailbox, [doc("approved")]).hash, context.hash);
  assert.deepEqual(buildAiContext(conversation, mailbox, [{ ...doc("unrelated"), versions: [{ version: 1, status: "approved", title: "Zwroty", body: "Procedura zwrotów magazynowych" }] }]).data.documents, []);
});

test("zmiana punktacji tych samych źródeł nie zmienia prefiksu wiedzy", () => {
  const documents = [doc("a"), doc("b")];
  documents[0].versions[0].body = "Licencja faktury";
  documents[1].versions[0].body = "Licencja awarie";
  const first = buildAiContext({ ...conversation, subject: "Licencja faktury" }, mailbox, documents);
  const second = buildAiContext({ ...conversation, subject: "Licencja awarie" }, mailbox, documents.slice().reverse());
  assert.deepEqual(first.data.documents, second.data.documents);
  assert.notEqual(first.hash, second.hash);
  // Stable serialization must not change which eight documents win relevance.
  const many = Array.from({ length: 9 }, (_, i) => doc(String(i)));
  many[8].versions[0].body = "Licencja faktury awarie";
  const selected = buildAiContext({ ...conversation, subject: "Licencja faktury awarie" }, mailbox, many).data.documents;
  assert.equal(selected.length, 8);
  assert.ok(selected.some((item) => item.id === "8"));
});

test("źródła są rozwiązywane na serwerze, brak wiedzy eskaluje, obcy identyfikator jest odrzucany", () => {
  assert.deepEqual(validateAiOutput(answer, context).sources, [{ id: "approved", title: "Licencja approved", version: 1 }]);
  assert.throws(() => validateAiOutput({ ...answer, sourceIds: ["foreign"] }, context), { code: "INVALID_AI_SOURCE" });
  assert.throws(() => validateAiOutput({ ...answer, sourceIds: [] }, context), { code: "INVALID_AI_SOURCE" });
  assert.throws(() => validateAiOutput({ ...answer, text: "", needsHuman: true }, context), { code: "INVALID_AI_RESPONSE" });
  const noDocuments = buildAiContext(conversation, mailbox, []);
  const noSource = validateAiOutput({ ...answer, sourceIds: [] }, noDocuments);
  assert.equal(noSource.text, ""); assert.equal(noSource.needsHuman, true);
  assert.equal(noSource.category, "Licencja");
  assert.throws(() => validateAiOutput({ ...answer, priority: "Wymyślony" }, context), { code: "INVALID_AI_RESPONSE" });
});

test("OpenRouter otrzymuje Bearer, model, JSON schema i bezpieczny kontekst", async () => {
  let calls = 0;
  const result = await completeAiReply(context, fakeKey, model, async (url, options) => {
    calls++;
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(options.headers.Authorization, `Bearer ${fakeKey}`);
    assert.equal(options.redirect, "error");
    const input = JSON.parse(options.body);
    assert.equal(input.model, model.id);
    assert.equal(input.session_id, "open-triage:mailbox:test");
    assert.equal(input.response_format.json_schema.strict, true);
    assert.equal(input.response_format.json_schema.schema.properties.sourceIds.minItems, 1);
    assert.equal(input.response_format.json_schema.schema.properties.needsHuman.const, false);
    assert.equal(input.provider.require_parameters, true);
    assert.match(input.messages[1].content, /ZATWIERDZONA WIEDZA TEJ SKRZYNKI/);
    assert.ok(input.messages[1].content.includes(JSON.stringify(context.data.documents)));
    assert.deepEqual(JSON.parse(input.messages[2].content), {
      mailbox: context.data.mailbox, subject: context.data.subject, emails: context.data.emails,
    });
    assert.match(input.messages[0].content, /zatwierdzone, wiążące instrukcje administratora/);
    assert.match(input.messages[0].content, /Nie wolno ci łagodzić/);
    assert.ok(!options.body.includes(fakeKey));
    assert.ok(!options.body.includes("INTERNAL_SECRET"));
    return completed();
  });
  assert.equal(calls, 1); assert.equal(result.text, answer.text);
  assert.deepEqual(result.usage, { cost: 0.00125, promptTokens: 120, completionTokens: 30, totalTokens: 150 });
});

test("błędy dostawcy nie ujawniają danych, uszkodzone i ucięte odpowiedzi nie są przyjmowane", async () => {
  let billed;
  await assert.rejects(completeAiReply(context, fakeKey, model, async () => completed("nie JSON"), async (usage) => { billed = usage; }), { code: "INVALID_AI_RESPONSE" });
  assert.equal(billed.cost, 0.00125);
  for (const [status, code] of [[401, "INVALID_KEY"], [402, "NO_CREDITS"], [429, "RATE_LIMIT"], [500, "PROVIDER_ERROR"]]) {
    await assert.rejects(completeAiReply(context, fakeKey, model, async () => Response.json({ error: fakeKey }, { status })), (error) => error.code === code && !error.message.includes(fakeKey));
  }
  for (const response of [completed("nie JSON"), completed(JSON.stringify(answer), "length"), completed(JSON.stringify({ ...answer, sourceIds: ["foreign"] }))]) {
    await assert.rejects(completeAiReply(context, fakeKey, model, async () => response), /Model/);
  }
  await assert.rejects(completeAiReply(context, fakeKey, model, async () => { throw new Error(fakeKey); }), (error) => error.code === "AI_TIMEOUT" && !error.message.includes(fakeKey));
});

test("sprawdzenie klucza nie generuje odpowiedzi; lista zawiera tylko modele ze strukturą JSON", async () => {
  await verifyAiKey(fakeKey, async (url, options) => {
    assert.equal(url, "https://openrouter.ai/api/v1/key");
    assert.equal(options.headers.Authorization, `Bearer ${fakeKey}`);
    return Response.json({ data: { is_provisioning_key: false } });
  });
  await assert.rejects(verifyAiKey(fakeKey, async () => Response.json({ data: { is_provisioning_key: true } })), { code: "INVALID_KEY" });
  const catalog = await listAiModels(async (url, options) => {
    assert.equal(url, "https://openrouter.ai/api/v1/models"); assert.equal(options.headers, undefined);
    return Response.json({ data: [
      { ...model, supported_parameters: ["structured_outputs", "reasoning"], architecture: { output_modalities: ["text"] } },
      { id: "old", name: "Old", supported_parameters: [], architecture: { output_modalities: ["text"] } },
    ] });
  });
  assert.deepEqual(catalog, [model]);
});

test("koszty klucza są normalizowane bez ujawniania danych uwierzytelniających", async () => {
  const usage = await getAiKeyUsage(fakeKey, async (url, options) => {
    assert.equal(url, "https://openrouter.ai/api/v1/key");
    assert.equal(options.headers.Authorization, `Bearer ${fakeKey}`);
    return Response.json({ data: {
      usage: 1.25, usage_daily: 0.05, usage_weekly: 0.4, usage_monthly: 0.9,
      limit: 10, limit_remaining: 8.75, is_free_tier: false,
    } });
  });
  assert.deepEqual(usage, { usage: 1.25, usageDaily: 0.05, usageWeekly: 0.4, usageMonthly: 0.9, limit: 10, remaining: 8.75, freeTier: false });
  assert.ok(!JSON.stringify(usage).includes(fakeKey));
  await assert.rejects(getAiKeyUsage(fakeKey, async () => Response.json({ data: {} })), { code: "INVALID_AI_RESPONSE" });
});
