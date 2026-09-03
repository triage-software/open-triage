import "server-only";

export function smtpConfig() {
  const host = process.env.TRIAGE_SMTP_HOST;
  const user = process.env.TRIAGE_SMTP_USER;
  const pass = process.env.TRIAGE_SMTP_PASSWORD || process.env.TRIAGE_IMAP_PASSWORD;
  if (!host || user !== "support@example.com" || !pass) return null;
  return {
    host, port: Number(process.env.TRIAGE_SMTP_PORT || 465), secure: true,
    auth: { user, pass }, connectionTimeout: 15_000, greetingTimeout: 15_000,
    socketTimeout: 30_000, logger: false as const, debug: false,
  };
}
