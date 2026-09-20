import test from "node:test";
import assert from "node:assert/strict";
import { mergeIncomingMail } from "../src/lib/mail-import.ts";
import { parseIncomingMail } from "../src/lib/mail-parser.ts";

function state() {
  return { conversations: [], drafts: [], knowledge: [], notifications: [], archives: [] };
}
function message(id, references = []) {
  return {
    subject: "Pytanie o konto",
    email: {
      id, messageId: `<${id}@example.test>`, references,
      direction: "inbound", authorName: "Klient", from: "klient@example.test",
      to: "support@opentriage.com", body: `Wiadomość ${id}`,
      createdAt: "2026-09-03T12:00:00.000Z",
    },
  };
}

test("ponowienie importu oraz zmiana UIDVALIDITY nie duplikują wiadomości", () => {
  const s = state();
  const first = message("first");
  assert.equal(mergeIncomingMail(s, "test", [first]), 1);
  const jobId = s.conversations[0].aiTriage.id;
  assert.equal(s.conversations[0].aiTriage.status, "pending");
  assert.equal(mergeIncomingMail(s, "test", [first]), 0);
  const sameMessageNewUid = structuredClone(first);
  sameMessageNewUid.email.id = "new-validity-uid";
  assert.equal(mergeIncomingMail(s, "test", [sameMessageNewUid]), 0);
  assert.equal(s.conversations.length, 1);
  assert.equal(s.conversations[0].publicRevision, 1);
  assert.equal(s.conversations[0].aiTriage.id, jobId);
});

test("odpowiedź dołącza do wątku i otwiera go, zachowując pracę zespołu", () => {
  const s = state();
  mergeIncomingMail(s, "test", [message("first")]);
  const conversation = s.conversations[0];
  const jobId = conversation.aiTriage.id;
  conversation.status = "Zakończone";
  conversation.assigneeId = "anna";
  conversation.comments.push({ id: "note", body: "Tylko dla zespołu" });
  s.drafts.push({ conversationId: conversation.id, text: "Nie nadpisuj", basePublicRevision: 1 });
  mergeIncomingMail(s, "test", [message("reply", ["<first@example.test>"])]);
  assert.equal(s.conversations.length, 1);
  assert.equal(conversation.emails.length, 2);
  assert.equal(conversation.publicRevision, 2);
  assert.equal(conversation.aiTriage.status, "pending");
  assert.notEqual(conversation.aiTriage.id, jobId);
  assert.equal(conversation.status, "W toku");
  assert.equal(conversation.assigneeId, "anna");
  assert.equal(conversation.comments[0].body, "Tylko dla zespołu");
  assert.equal(s.drafts[0].text, "Nie nadpisuj");
  assert.equal(s.drafts[0].basePublicRevision, 1);
  assert.ok(!JSON.stringify(conversation.emails).includes("Tylko dla zespołu"));
});

test("ten sam temat nie łączy niezależnych spraw ani różnych skrzynek", () => {
  const s = state();
  mergeIncomingMail(s, "general", [message("first")]);
  mergeIncomingMail(s, "test", [message("reply", ["<first@example.test>"])]);
  mergeIncomingMail(s, "test", [message("unrelated")]);
  assert.equal(s.conversations.length, 3);
  assert.deepEqual(s.conversations.map((c) => c.mailboxId), ["general", "test", "test"]);
});

test("wiadomość bez Message-ID jest deduplikowana po identyfikatorze IMAP", () => {
  const s = state();
  const mail = message("imap-test-123-4");
  delete mail.email.messageId;
  mergeIncomingMail(s, "test", [mail]);
  mergeIncomingMail(s, "test", [mail]);
  assert.equal(s.conversations.length, 1);
});

test("MIME dekoduje polski temat, treść HTML, referencje i załączniki", async () => {
  const source = Buffer.from([
    'From: "Klient" <klient@example.test>',
    'To: support@opentriage.com',
    `Subject: =?UTF-8?B?${Buffer.from("Zażółć gęślą jaźń").toString("base64")}?=`,
    'Message-ID: <new@example.test>',
    'In-Reply-To: <old@example.test>',
    'References: <root@example.test> <old@example.test>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="test-boundary"', '',
    '--test-boundary', 'Content-Type: text/html; charset=utf-8', '',
    '<p>Dzień dobry</p><p>Moja stopka</p>',
    '--test-boundary', 'Content-Type: text/plain; name="plik.txt"',
    'Content-Disposition: attachment; filename="plik.txt"', '', 'Treść załącznika',
    '--test-boundary--', '',
  ].join('\r\n'));
  const parsed = await parseIncomingMail(source, "123", 7, new Date("2026-09-03T12:00:00Z"));
  assert.equal(parsed.subject, "Zażółć gęślą jaźń");
  assert.match(parsed.email.body, /Dzień dobry/);
  assert.match(parsed.email.body, /Moja stopka/);
  assert.ok(!parsed.email.body.includes('<p>'));
  assert.equal(parsed.email.imap.uid, 7);
  assert.equal(parsed.email.imap.uidValidity, "123");
  assert.equal(parsed.email.demo, undefined);
  assert.deepEqual(parsed.email.references, ["<root@example.test>", "<old@example.test>"]);
  assert.equal(parsed.email.attachments[0].name, "plik.txt");
});
