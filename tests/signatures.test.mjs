import test from "node:test";
import assert from "node:assert/strict";
import { simpleParser } from "mailparser";
import { employeeSignatures, signatureText } from "../src/lib/signatures.ts";
import { messageHtml } from "../src/lib/mail-template.ts";
import { reserveReply } from "../src/lib/mail-outbox.ts";
import { composeReply } from "../src/lib/mail-delivery.ts";

const expected = {
  irena: ["Irena Bronkowska-Mika", "Kierownik Działu Administracji i Finansów", "+48 729 921 970", "irena.bronkowska@pryzmat.media"],
  mateusz: ["Mateusz Gołębiowski", "CEO | Prezes Zarządu", "+48 503 835 707", "mateusz.golebiowski@pryzmat.media"],
  tomasz: ["Tomasz Dłuski", "Zespół wsparcia SellersKit", "test@sellersk.it"],
};

test("trzej pracownicy mają własne podpisy o wspólnym układzie", () => {
  for (const [id, values] of Object.entries(expected)) {
    const signature = employeeSignatures[id];
    for (const value of values) assert.ok(signatureText(signature).includes(value));
    assert.ok(signatureText(signature).includes("Pryzmat Media Spółka z ograniczoną odpowiedzialnością"));
  }
});

test("HTML podpisu koduje treść wiadomości i nie pobiera zewnętrznych obrazów", async () => {
  const html = await messageHtml('<script>alert("x")</script>\nDruga linia\n</mj-text><mj-include path=".env.local" />', employeeSignatures.irena);
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("Irena Bronkowska-Mika"));
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("<mj-include"));
  assert.ok(!html.includes("fonts.googleapis.com"));
});

test("MJML tworzy pełny responsywny dokument z wariantem Outlook dla każdego podpisu", async () => {
  for (const signature of Object.values(employeeSignatures)) {
    const html = await messageHtml("Pierwsza linia\r\nDruga linia", signature);
    assert.match(html, /<!doctype html>/i);
    assert.match(html, /@media/);
    assert.match(html, /\[if mso/);
    assert.match(html, /role="presentation"/);
    assert.ok(html.includes(signature.name));
    assert.ok(html.includes(`mailto:${signature.email}`));
    assert.match(html, /Pierwsza linia<br\s*\/?>(\s*)Druga linia/);
    assert.doesNotMatch(html, /<mj-(?:text|column|section)/);
  }
});

test("rezerwacja utrwala podpis autora, a MIME zawiera wersję tekstową i HTML", async () => {
  const signature = structuredClone(employeeSignatures.irena);
  const state = {
    generation: "g", appliedRequests: [], users: [{ id: "irena", name: signature.name, role: signature.title, signature }],
    mailboxes: [{ id: "test", email: "test@sellersk.it", mode: "imap" }],
    conversations: [{ id: "c", mailboxId: "test", subject: "Temat", publicRevision: 1, status: "Nowe", customer: { email: "client@example.test" }, emails: [], activities: [] }],
    drafts: [{ key: "c:irena:reply", text: "Treść", version: 1, basePublicRevision: 1 }], outbox: [],
  };
  const job = reserveReply(state, { requestId: "request", generation: "g", userId: "irena", action: { conversationId: "c", text: "Treść", expectedPublicRevision: 1, draftVersion: 1 } });
  state.users[0].signature.name = "Zmienione później";
  assert.equal(job.email.signature.name, "Irena Bronkowska-Mika");
  const mail = await simpleParser(await composeReply(job));
  assert.match(mail.text, /Treść[\s\S]*Irena Bronkowska-Mika[\s\S]*729 921 970/);
  assert.match(mail.html, /Kierownik Działu Administracji i Finansów/);
  assert.match(mail.html, /<!doctype html>/i);
  assert.match(mail.html, /\[if mso/);
  assert.ok(!mail.html.includes("Zmienione później"));
});
