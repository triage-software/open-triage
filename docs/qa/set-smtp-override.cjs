/* Test-only helper: set the SMTP override on a mailbox. Used by docs/qa/e2e.sh
 * because PATCH /mailboxes/:id does not accept smtp* fields yet
 * (mailboxes card t_fbfb2225 owns that schema).
 * Usage: node set-smtp-override.cjs <mailboxId> <smtpHost> <smtpPort> <smtpSecure> */
let PrismaClient;
try {
  ({ PrismaClient } = require('@prisma/client'));
} catch {
  ({ PrismaClient } = require('/app/node_modules/@prisma/client'));
}
const prisma = new PrismaClient();
const [, , mailboxId, smtpHost, smtpPortRaw, smtpSecureRaw] = process.argv;
if (!mailboxId || !smtpHost) {
  console.error('usage: node set-smtp-override.cjs <mailboxId> <smtpHost> <smtpPort> <smtpSecure>');
  process.exit(1);
}
const port = Number(smtpPortRaw || 465);
const secure = smtpSecureRaw === 'true';
prisma.mailbox
  .update({ where: { id: mailboxId }, data: { smtpHost, smtpPort: port, smtpSecure: secure } })
  .then((row) => {
    console.log(JSON.stringify({ ok: true, id: row.id, smtpHost: row.smtpHost, smtpPort: row.smtpPort }));
    return prisma.$disconnect();
  })
  .catch((e) => {
    console.error(JSON.stringify({ ok: false, error: e.message }));
    process.exit(1);
  });