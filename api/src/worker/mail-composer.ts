import nodemailer from 'nodemailer';

export interface OutgoingMailFields {
  from: string;
  fromName: string | null;
  to: string;
  subject: string;
  body: string;
  messageId: string;
  inReplyTo: string | null;
  references: string[];
  date: Date;
}

/**
 * Builds the full RFC822 message (headers + text part) without touching the
 * network — the caller sends `raw` through SMTP with an explicit envelope so
 * the SMTP conversation and the stored headers always agree.
 *
 * Text-only MIME in this increment (the prototype's MJML signature system is
 * account-specific vendor styling, not portable product logic).
 */
export async function composeReplyRaw(mail: OutgoingMailFields): Promise<Buffer> {
  const composer = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: 'windows',
  });
  const info = await composer.sendMail({
    from: mail.fromName ? { name: mail.fromName, address: mail.from } : mail.from,
    replyTo: mail.from,
    to: mail.to,
    subject: mail.subject,
    messageId: mail.messageId,
    inReplyTo: mail.inReplyTo ?? undefined,
    references: mail.references.length ? mail.references : undefined,
    date: mail.date,
    text: mail.body,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  composer.close();
  const raw = (info as unknown as { message: Buffer }).message;
  if (!raw) throw new Error('MIME composer returned no raw message');
  return raw;
}

/** Minimal HTML wrapper for system e-mails (invite / verification). */
export function systemMailHtml(title: string, bodyLines: string[], linkUrl?: string, linkLabel?: string): string {
  const esc = (value: string) =>
    value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const paragraphs = bodyLines.map((line) => `<p style="margin:0 0 12px">${esc(line)}</p>`).join('');
  const link = linkUrl
    ? `<p style="margin:24px 0"><a href="${esc(linkUrl)}" style="display:inline-block;padding:10px 18px;background:#18385c;color:#ffffff;border-radius:6px;text-decoration:none">${esc(linkLabel ?? linkUrl)}</a></p>\n<p style="color:#666">link: ${esc(linkUrl)}</p>`
    : '';
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#253b56;line-height:1.55">
<div style="max-width:560px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 16px">${esc(title)}</h2>
${paragraphs}
${link}
</div></body></html>`;
}