#!/usr/bin/env node
/* Seeds a customer mail into the greenmail SMTP sink for e2e mail scenarios.
 * Usage: node docs/qa/seed-mail.mjs <smtp-host> <smtp-port> [subject] [body] [messageId]
 * The mail goes From: klient@klient.test To: verify@localhost so the worker's
 * IMAP poll imports it into a conversation. */
const nodemailer = require('nodemailer');

const [, , hostArg, portArg, subjectArg, bodyArg, messageIdArg] = process.argv;
const host = hostArg || 'localhost';
const port = Number(portArg || 3025);
const subject = subjectArg || 'Mail flow check';
const body = process.env.SEED_BODY || 'Prosze o pomoc z logowaniem do konta.';
const messageId = process.env.SEED_MESSAGE_ID || `<seed-${Date.now()}@klient.test>`;

const transport = nodemailer.createTransport({
  host,
  port,
  secure: false,
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 30000,
  logger: false,
  debug: false,
});

transport
  .sendMail({
    from: 'Klient Test <klient@klient.test>',
    to: 'verify@localhost',
    subject,
    text: body,
    messageId,
  })
  .then((info) => {
    console.log(JSON.stringify({ ok: true, messageId: info.messageId, accepted: info.accepted }));
    transport.close();
    process.exit(0);
  })
  .catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err.message }));
    transport.close();
    process.exit(1);
  });