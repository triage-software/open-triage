import { decryptSecret } from '../auth/crypto.util';

/**
 * Resolves IMAP/SMTP connection settings for a Mailbox row. Ported from the
 * proven prototype (src/lib/mail-config.ts + mail-sync.ts settings()), but
 * driven by DB rows instead of TRIAGE_IMAP_* env vars: credentials live
 * encrypted in Mailbox.passwordEnc (AES-256-GCM, SESSION_SECRET-derived key —
 * same primitive as crypto.util).
 */

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  sentFolder?: string | null;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

export type MailboxConfig =
  | { mode: 'imap'; imap: ImapConfig; smtp: SmtpConfig | null }
  | { mode: 'unconfigured'; error?: string };

type MailboxLike = {
  host: string | null;
  port: number | null;
  secure: boolean;
  user: string | null;
  passwordEnc: string | null;
  sentFolder: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean | null;
};

export function mailboxConfig(mailbox: MailboxLike, sessionSecret: string): MailboxConfig {
  if (!mailbox.host || !mailbox.user || !mailbox.passwordEnc) {
    return { mode: 'unconfigured', error: 'Skrzynka nie ma jeszcze podłączonych danych serwera.' };
  }
  const pass = decryptSecret(mailbox.passwordEnc, sessionSecret);
  if (!pass) {
    // Wrong SESSION_SECRET or corrupted ciphertext — never echo details.
    return { mode: 'unconfigured', error: 'Nie udało się odszyfrować danych logowania skrzynki.' };
  }
  const imap: ImapConfig = {
    host: mailbox.host,
    port: mailbox.port ?? 993,
    secure: mailbox.secure,
    user: mailbox.user,
    pass,
    sentFolder: mailbox.sentFolder,
  };
  // SMTP override columns (smtpHost/smtpPort/smtpSecure) drive the send path.
  // Without an explicit override there is NO SMTP fallback to the IMAP host:
  // IMAP and SMTP almost never share a port, and speaking SMTP at an IMAP
  // listener dies on the greeting ("* OK IMAP4rev1 ..."). The send job then
  // fails with 'SMTP not configured for this mailbox' instead of misdialing.
  const smtp: SmtpConfig | null = mailbox.smtpHost
    ? {
        host: mailbox.smtpHost,
        port: mailbox.smtpPort ?? 465,
        secure: mailbox.smtpSecure ?? true,
        user: mailbox.user,
        pass,
      }
    : null;
  return { mode: 'imap', imap, smtp };
}

/** Connection settings for ImapFlow (timeouts ported from the prototype). */
export function imapFlowOptions(config: ImapConfig) {
  return {
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    logger: false as const,
    disableAutoIdle: true,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 25_000,
  };
}

/**
 * Error classification ported from the prototype's syncError(): generic,
 * credential- and content-free messages only. Protocol error objects can
 * include credentials or mail content — never expose them.
 */
export function syncErrorText(error: unknown): string {
  const failure = error as { authenticationFailed?: boolean; code?: string };
  if (failure.authenticationFailed) return 'Serwer odrzucił login lub hasło do skrzynki.';
  if (failure.code === 'ENOTFOUND') return 'Nie można odnaleźć serwera IMAP.';
  if (['ETIMEDOUT', 'ETIMEOUT'].includes(failure.code ?? ''))
    return 'Serwer IMAP nie odpowiedział na czas. Ponawiamy.';
  return 'Nie udało się pobrać poczty. Ponawiamy przy następnym odpytaniu.';
}