import test from "node:test";
import assert from "node:assert/strict";
import { simpleParser } from "mailparser";
import { reserveReply, claimReply, acceptReply, recordSentCopy } from "../src/lib/mail-outbox.ts";
import { composeReply, deliverReply } from "../src/lib/mail-delivery.ts";
import { saveSentMessage } from "../src/lib/mail-sent.ts";

function fixture() {
  const state = {
    generation: "generation", appliedRequests: [],
    users: [{ id: "michal", name: "Michał Kluska", active: true }],
    mailboxes: [{ id: "test", email: "support@opentriage.com", mode: "imap" }],
    conversations: [{
      id: "thread", mailboxId: "test", subject: "Pytanie o licencję", publicRevision: 1,
      status: "W toku", comments: [{ body: "TAJNY KOMENTARZ WEWNĘTRZNY" }], activities: [],
      customer: { email: "customer@example.test" },
      emails: [{ id: "inbound", messageId: "<inbound@example.test>", references: ["<root@example.test>"], body: "PYTANIE KLIENTA" }],
    }],
    drafts: [{ key: "thread:michal:reply", text: "Dzień dobry, odpowiedź zespołu.", version: 1, basePublicRevision: 1 }],
  };
  const request = {
    requestId: "request-1", generation: state.generation, userId: "michal",
    action: { conversationId: "thread", text: state.drafts[0].text, expectedPublicRevision: 1, draftVersion: 1 },
  };
  return { state, request };
}

test("wspólny From i Reply-To, nagłówki wątku, komentarze poza MIME", async () => {
  const { state, request } = fixture();
  const job = reserveReply(state, request);
  const raw = await composeReply(job);
  const parsed = await simpleParser(raw);
  assert.equal(parsed.from.value[0].address, "support@opentriage.com");
  assert.equal(parsed.replyTo.value[0].address, "support@opentriage.com");
  assert.equal(parsed.to.value[0].address, "customer@example.test");
  assert.equal(parsed.subject, "Re: Pytanie o licencję");
  assert.equal(parsed.inReplyTo, "<inbound@example.test>");
  assert.equal(parsed.messageId, "<request-1@opentriage.com>");
  assert.deepEqual(parsed.references, ["<root@example.test>", "<inbound@example.test>"]);
  assert.ok(parsed.text.startsWith(request.action.text));
  assert.match(parsed.text, /Michał Kluska/);
  assert.match(parsed.text, /michal\.kluska@opentriage\.com/);
  assert.ok(!raw.toString().includes("TAJNY KOMENTARZ"));
  assert.ok(!raw.toString().includes("PYTANIE KLIENTA"));
  assert.equal(job.email.authorName, "Michał Kluska");
});

test("rezerwacja sprawdza rewizję i szkic oraz blokuje równoległą wysyłkę", () => {
  const { state, request } = fixture();
  assert.throws(() => reserveReply(state, { ...request, action: { ...request.action, expectedPublicRevision: 0 } }), { code: "NEW_REPLY" });
  assert.throws(() => reserveReply(state, { ...request, action: { ...request.action, draftVersion: 0 } }), { code: "DRAFT_CONFLICT" });
  const first = reserveReply(state, request);
  assert.equal(reserveReply(state, request), first);
  assert.throws(() => reserveReply(state, { ...request, requestId: "request-2" }), { code: "SEND_PENDING" });
  assert.throws(() => reserveReply(state, { ...request, action: { ...request.action, text: "Inna treść" } }), { code: "REQUEST_CONFLICT" });
});

test("zmiana szkicu po rezerwacji zatrzymuje SMTP", () => {
  const { state, request } = fixture();
  const job = reserveReply(state, request);
  state.drafts[0].version++;
  assert.equal(claimReply(state, job.requestId, "raw"), false);
  assert.equal(job.status, "failed");
  assert.equal(state.conversations[0].emails.length, 1);
});

test("potwierdzenie SMTP zachowuje nowszy szkic i wiadomość odebraną w trakcie", () => {
  const { state, request } = fixture();
  const job = reserveReply(state, request);
  claimReply(state, job.requestId, "raw");
  state.drafts[0].text = "Nowszy szkic";
  state.drafts[0].version++;
  state.conversations[0].publicRevision++;
  acceptReply(state, job.requestId);
  acceptReply(state, job.requestId);
  assert.equal(state.drafts[0].text, "Nowszy szkic");
  assert.equal(state.conversations[0].status, "W toku");
  assert.equal(state.conversations[0].emails.length, 2);
  assert.equal(state.conversations[0].publicRevision, 3);
  assert.equal(state.appliedRequests.length, 1);
});

test("awaria IMAP po SMTP ponawia samą kopię i używa identycznego MIME", async () => {
  const { state, request } = fixture();
  const job = reserveReply(state, request);
  let sends = 0, copies = 0, sentRaw;
  const io = {
    claim: async raw => claimReply(state, job.requestId, raw),
    send: async raw => { sends++; sentRaw = raw; },
    accept: async () => acceptReply(state, job.requestId),
    fail: async () => assert.fail("SMTP must not fail"),
    copy: async raw => { copies++; assert.deepEqual(raw, sentRaw); if (copies === 1) throw new Error("IMAP unavailable"); return "SENT"; },
    saveCopy: async folder => recordSentCopy(state, job.requestId, folder),
  };
  await deliverReply(structuredClone(job), io);
  assert.equal(job.status, "sent");
  assert.equal(job.email.sentCopy.status, "pending");
  assert.equal(state.drafts[0].text, "");
  await deliverReply(structuredClone(job), io);
  await deliverReply(structuredClone(job), io);
  assert.equal(sends, 1);
  assert.equal(copies, 2);
  assert.equal(job.email.sentCopy.folder, "SENT");
  assert.equal(state.conversations[0].emails.length, 2);
});

test("niepewny wynik SMTP blokuje kolejną wysyłkę tej samej wiadomości", async () => {
  const { state, request } = fixture();
  const job = reserveReply(state, request);
  let sends = 0;
  const io = {
    claim: async raw => claimReply(state, job.requestId, raw),
    send: async () => { sends++; throw Object.assign(new Error("Disconnected"), { code: "ESOCKET", command: "DATA" }); },
    accept: async () => assert.fail("not acknowledged"),
    fail: async (unknown, message) => { job.status = unknown ? "unknown" : "failed"; job.error = message; },
    copy: async () => assert.fail("must not copy before SMTP success"),
    saveCopy: async () => assert.fail("must not copy before SMTP success"),
  };
  await assert.rejects(() => deliverReply(structuredClone(job), io), { code: "DELIVERY_UNKNOWN" });
  await assert.rejects(() => deliverReply(structuredClone(job), io), { code: "DELIVERY_UNKNOWN" });
  assert.equal(sends, 1);
  assert.equal(state.conversations[0].emails.length, 1);
  assert.equal(state.drafts[0].text, request.action.text);
});

test("utrata zapisu po przyjęciu SMTP nigdy nie ponawia SMTP", async () => {
  const { state, request } = fixture();
  const job = reserveReply(state, request);
  let sends = 0;
  const io = {
    claim: async raw => claimReply(state, job.requestId, raw),
    send: async () => { sends++; },
    accept: async () => { throw new Error("Disk full"); },
    fail: async () => assert.fail("SMTP accepted"),
    copy: async () => "SENT", saveCopy: async () => {},
  };
  await assert.rejects(() => deliverReply(structuredClone(job), io), { code: "DELIVERY_UNKNOWN" });
  await assert.rejects(() => deliverReply(structuredClone(job), io), { code: "DELIVERY_UNKNOWN" });
  assert.equal(sends, 1);
});

test("IMAP zapisuje raz w oznaczonym folderze Wysłane i sprawdza Message-ID", async () => {
  const { state, request } = fixture();
  const job = reserveReply(state, request);
  const raw = await composeReply(job);
  let copies = 0, releases = 0;
  const client = {
    list: async () => [{ path: "INBOX" }, { path: "SENT", specialUse: "\\Sent" }],
    getMailboxLock: async folder => { assert.equal(folder, "SENT"); return { release: () => { releases++; } }; },
    get mailbox() { return { exists: copies }; },
    // Reproduce home.pl returning no HEADER search match for an existing mail.
    search: async query => { assert.equal(query.header["message-id"], job.email.messageId); return []; },
    fetch: async function* () { if (copies) yield { envelope: { messageId: job.email.messageId } }; },
    append: async (folder, source, flags) => {
      assert.equal(folder, "SENT"); assert.deepEqual(source, raw); assert.deepEqual(flags, ["\\Seen"]);
      copies++; return { uid: 123 };
    },
  };
  assert.equal(await saveSentMessage(client, job, raw), "SENT");
  assert.equal(await saveSentMessage(client, job, raw), "SENT");
  assert.equal(copies, 1);
  assert.equal(releases, 2);
  client.search = async () => false;
  await assert.rejects(() => saveSentMessage(client, job, raw));
  assert.equal(copies, 1);
  assert.equal(releases, 3);
});
