import { simpleParser } from 'mailparser';
import { convert } from 'html-to-text';

export interface ParsedIncomingMail {
  subject: string;
  from: string;
  fromName: string | null;
  to: string;
  body: string;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  date: Date;
  attachments: { name: string; size: number }[];
}

/**
 * Ported from the proven prototype parser (src/lib/mail-parser.ts):
 * plain text preferred, HTML converted only when no text part exists, and
 * untrusted mail HTML is never stored. Some multipart HTML messages with
 * attachments have no generated text part — html-to-text covers those.
 */
export async function parseIncomingMail(
  source: Buffer,
  internalDate?: Date,
): Promise<ParsedIncomingMail> {
  const mail = await simpleParser(source, {
    skipHtmlToText: false,
    skipTextToHtml: true,
    skipImageLinks: true,
    skipTextLinks: true,
  });
  const sender = mail.from?.value?.[0];
  const references = [
    ...(Array.isArray(mail.references)
      ? mail.references
      : mail.references
        ? (mail.references.match(/<[^>]+>/g) ?? [])
        : []),
    ...(mail.inReplyTo ? [mail.inReplyTo] : []),
  ];
  const date =
    mail.date && Number.isFinite(mail.date.getTime())
      ? mail.date
      : internalDate ?? new Date();
  // Render only plain text; never inject untrusted email HTML.
  const body = mail.text?.trim() || (mail.html ? convert(mail.html).trim() : '');
  const recipient = Array.isArray(mail.to) ? mail.to[0]?.value?.[0] : mail.to?.value?.[0];
  return {
    subject: mail.subject?.trim() || '(bez tematu)',
    from: sender?.address ?? '',
    fromName: sender?.name ?? null,
    to: recipient?.address ?? '',
    body: body || '(wiadomość bez treści tekstowej — pobierz oryginalną)',
    messageId: mail.messageId ?? null,
    inReplyTo: mail.inReplyTo ?? null,
    references: [...new Set(references)],
    date,
    attachments: (mail.attachments ?? []).map((a) => ({
      name: a.filename ?? 'załącznik',
      size: a.size ?? 0,
    })),
  };
}