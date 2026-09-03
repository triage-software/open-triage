import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { simpleParser } from "mailparser";
import { compileSignatureMjml, defaultSignatureMjml, messageHtml } from "../src/lib/mail-template.ts";
import { employeeSignatures, signatureText, signatureFor } from "../src/lib/signatures.ts";
import { composeReply } from "../src/lib/mail-delivery.ts";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
  return nextResolve(specifier, context);
} });

test("edytowalny MJML: walidacja, trwałość, konflikty i podpis utrwalony w MIME", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "triage-signatures-"));
  const cwd = process.cwd();
  try {
    process.chdir(directory);
    const { getState, saveUserSignature } = await import("../src/lib/store.ts");
    const state = await getState();
    const source = defaultSignatureMjml(employeeSignatures.anna).replace("729 921 970", "111 222 333").replace("Kierownik Działu Administracji i Finansów", "Nowe stanowisko");
    const input = { userId: "anna", actorId: "michal", generation: state.generation, expectedVersion: 0, mjml: source };
    const preview = await compileSignatureMjml(source);
    assert.match(preview.text, /Nowe stanowisko/);
    assert.match(preview.text, /111 222 333/);
    assert.equal((await getState()).users.find((u) => u.id === "anna").signature.custom, undefined);
    const first = await saveUserSignature(input);
    assert.equal(first.version, 1);
    assert.equal(first.updatedBy, "michal");
    const restored = (await getState()).users.find((u) => u.id === "anna");
    assert.equal(restored.signature.custom.mjml, source); // load migration must preserve edits
    const disk = JSON.parse(await readFile(path.join(directory, "data/prototype/state.json"), "utf8"));
    assert.equal(disk.users.find((u) => u.id === "anna").signature.custom.version, 1);
    await assert.rejects(saveUserSignature(input), (error) => error.status === 409);
    await assert.rejects(saveUserSignature({ ...input, expectedVersion: 1, mjml: "<mjml><mj-body><invalid /></mj-body></mjml>" }), /MJML/);
    assert.equal((await getState()).users.find((u) => u.id === "anna").signature.custom.version, 1);
    for (const invalid of ['<mj-include path=".env.local" />', '<script>alert(1)</script>', '<a href="javascript:alert(1)">x</a>']) {
      await assert.rejects(compileSignatureMjml(source.replace("Pozdrawiam,", invalid)), /nie może/);
    }
    const frozen = signatureFor(restored, "support@example.com");
    const outcomes = await Promise.allSettled([
      saveUserSignature({ ...input, expectedVersion: 1, mjml: source.replace("Nowe stanowisko", "Kolejne stanowisko") }),
      saveUserSignature({ ...input, expectedVersion: 1, mjml: source.replace("Nowe stanowisko", "Równoległa zmiana") }),
    ]);
    assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
    assert.match(signatureText(frozen), /Nowe stanowisko/);
    const html = await messageHtml('Kwota $& <script>test</script>\nDruga linia', frozen);
    assert.match(html, /Kwota \$&amp;/);
    assert.doesNotMatch(html, /<script>/);
    const mime = await simpleParser(await composeReply({
      subject: "Test podpisu", email: { from: "support@example.com", to: "nobody@example.test", body: "Treść odpowiedzi",
        createdAt: new Date().toISOString(), signature: frozen },
    }));
    assert.match(mime.html, /Treść odpowiedzi[\s\S]*Nowe stanowisko/);
    assert.match(mime.text, /Treść odpowiedzi[\s\S]*Nowe stanowisko/);
    assert.doesNotMatch(mime.html, /Kolejne stanowisko|Równoległa zmiana/);
  } finally { process.chdir(cwd); await rm(directory, { recursive: true, force: true }); }
});
