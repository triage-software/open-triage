import { simpleParser } from "mailparser";
import { convert } from "html-to-text";
import type { IncomingMail } from "./mail-import";

export async function parseIncomingMail(
  source: Buffer,
  uidValidity: string,
  uid: number,
  internalDate?: Date,
): Promise<IncomingMail> {
  const mail = await simpleParser(source, {
    skipHtmlToText: false,
    skipTextToHtml: true,
    skipImageLinks: true,
    skipTextLinks: true,
  });
  const sender = mail.from?.value[0];
  const references = [
    ...(Array.isArray(mail.references) ? mail.references : (mail.references?.match(/<[^>]+>/g) ?? [])),
    ...(mail.inReplyTo ? [mail.inReplyTo] : []),
  ];
  const date = mail.date && Number.isFinite(mail.date.getTime())
    ? mail.date
    : internalDate ?? new Date();
  // Some multipart HTML messages with attachments have no generated text part.
  // Render only plain text in React; never inject untrusted email HTML.
  const body = mail.text?.trim() || (mail.html ? convert(mail.html).trim() : "");
  return {
    subject: mail.subject?.trim() || "(bez tematu)",
    email: {
      id: `imap-test-${uidValidity}-${uid}`,
      direction: "inbound",
      authorName: sender?.name || sender?.address || "Nieznany nadawca",
      from: sender?.address ?? "",
      to: "support@opentriage.com",
      body: body || "(wiadomość bez treści tekstowej — pobierz oryginał)",
      createdAt: date.toISOString(),
      messageId: mail.messageId,
      references: [...new Set(references)],
      imap: { uidValidity, uid, folder: "INBOX" },
      attachments: mail.attachments.map((attachment) => ({
        name: attachment.filename || "załącznik",
        size: attachment.size,
      })),
    },
  };
}
