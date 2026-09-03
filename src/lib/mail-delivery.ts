import nodemailer from "nodemailer";
import type { OutgoingMail } from "./types";
import { MailError } from "./mail-outbox";
import { signatureText } from "./signatures";
import { messageHtml } from "./mail-template";

export async function composeReply(job: OutgoingMail): Promise<Buffer> {
  const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "windows" });
  const result = await composer.sendMail({
    from: { name: "SellersKit", address: job.email.from },
    replyTo: job.email.from,
    to: job.email.to,
    subject: job.subject,
    messageId: job.email.messageId,
    inReplyTo: job.inReplyTo,
    references: job.email.references,
    date: new Date(job.email.createdAt),
    text: job.email.signature
      ? `${job.email.body}\n\n${signatureText(job.email.signature)}`
      : job.email.body,
    html: job.email.signature ? await messageHtml(job.email.body, job.email.signature) : undefined,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return result.message as Buffer;
}

interface DeliveryIO {
  claim: (raw: string) => Promise<boolean>;
  send: (raw: Buffer) => Promise<void>;
  accept: () => Promise<void>;
  fail: (unknown: boolean, message: string) => Promise<void>;
  copy: (raw: Buffer) => Promise<string>;
  saveCopy: (folder?: string) => Promise<void>;
}

export async function deliverReply(job: OutgoingMail, io: DeliveryIO) {
  if (job.status === "sending" || job.status === "unknown")
    throw new MailError(job.error || "Wynik wysyłki wymaga sprawdzenia. Nie wysyłamy maila ponownie.", 409, "DELIVERY_UNKNOWN");
  if (job.status === "failed")
    throw new MailError(job.error || "Poprzednia próba wysyłki nie powiodła się. Sprawdź szkic i spróbuj ponownie.", 502, "SMTP_FAILED");
  if (job.status === "sent" && job.email.sentCopy?.status === "saved") return;
  const raw = job.raw ? Buffer.from(job.raw, "base64") : await composeReply(job);
  if (job.status === "prepared") {
    if (!await io.claim(raw.toString("base64")))
      throw new MailError("Rozmowa lub szkic zmieniły się. Przejrzyj nowe dane przed wysłaniem.", 409, "NEW_REPLY");
    try {
      await io.send(raw);
    } catch (error) {
      const failure = error as { code?: string; command?: string; responseCode?: number };
      const rejected = (failure.responseCode ?? 0) >= 400 ||
        ["EAUTH", "EENVELOPE", "EDNS"].includes(failure.code ?? "") ||
        /^(CONN|EHLO|HELO|AUTH|MAIL FROM|RCPT TO)/.test(failure.command ?? "");
      const message = rejected
        ? "Serwer SMTP odrzucił wysyłkę. Szkic został zachowany; sprawdź połączenie i spróbuj ponownie."
        : "Połączenie przerwano bez potwierdzenia wysyłki. Sprawdź, czy klient dostał wiadomość; automatyczna ponowna wysyłka jest zablokowana.";
      await io.fail(!rejected, message);
      throw new MailError(message, rejected ? 502 : 409, rejected ? "SMTP_FAILED" : "DELIVERY_UNKNOWN");
    }
    // Once SMTP accepted the message, no failure below may trigger another send.
    try {
      await io.accept();
    } catch {
      throw new MailError("SMTP przyjął maila, ale zapis wyniku na dysku nie powiódł się. Nie wysyłaj ponownie tej wiadomości.", 409, "DELIVERY_UNKNOWN");
    }
  }
  let folder: string | undefined;
  try {
    folder = await io.copy(raw);
  } catch {
    // Only the IMAP copy is retried. The public reply has already been committed.
  }
  await io.saveCopy(folder);
}
