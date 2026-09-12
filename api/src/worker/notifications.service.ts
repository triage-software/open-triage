import nodemailer from 'nodemailer';
import { Logger } from '@nestjs/common';
import { systemMailHtml } from './mail-composer';
import type { InviteMailPayload, VerifyMailPayload } from './producer';

const LOCALES = ['en', 'pl'] as const;
type Locale = (typeof LOCALES)[number];

const STRINGS: Record<Locale, Record<string, string>> = {
  en: {
    inviteTitle: 'Join {tenant} on Open Triage',
    inviteBody1: 'You have been invited to the {tenant} support workspace.',
    inviteBody2: 'Open the link below to set your password and sign in. The link works once.',
    linkLabel: 'Set up my account',
    verifyTitle: 'Confirm your e-mail address',
    verifyBody1: 'Welcome to Open Triage! Please confirm your e-mail address.',
    verifyBody2: 'If you did not create this account, you can ignore this message.',
    linkLabel2: 'Confirm e-mail',
  },
  pl: {
    inviteTitle: 'Dołącz do zespołu {tenant} w Open Triage',
    inviteBody1: 'Zostałeś zaproszony do obszaru roboczego wsparcia {tenant}.',
    inviteBody2: 'Otwórz poniższy link, aby ustawić hasło i się zalogować. Link działa jednokrotnie.',
    linkLabel: 'Skonfiguruj konto',
    verifyTitle: 'Potwierdź swój adres e-mail',
    verifyBody1: 'Witamy w Open Triage! Potwierdź proszę swój adres e-mail.',
    verifyBody2: 'Jeśli to nie Ty zakładałeś konto, zignoruj tę wiadomość.',
    linkLabel2: 'Potwierdź e-mail',
  },
};

function t(locale: string, key: string, vars?: Record<string, string>): string {
  const dict = STRINGS[(LOCALES as readonly string[]).includes(locale) ? (locale as Locale) : 'en'];
  let text = dict[key] ?? STRINGS.en[key] ?? key;
  for (const [name, value] of Object.entries(vars ?? {})) {
    text = text.replaceAll(`{${name}}`, value);
  }
  return text;
}

/**
 * System e-mail delivery (invite / verification) over SMTP.
 *
 * Configuration precedence: SMTP_SYSTEM_* env (self-host operators), else the
 * SMTP_* env fallbacks, else no delivery (producer logs the token and callers
 * keep the MVP fallbacks — the invite response keeps setupToken when SMTP is
 * not configured).
 */
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  private smtpConfig():
    | { host: string; port: number; secure: boolean; user: string; pass: string; from: string }
    | null {
    const host = process.env.SMTP_SYSTEM_HOST ?? process.env.SMTP_HOST;
    if (!host) return null;
    const user = process.env.SMTP_SYSTEM_USER ?? process.env.SMTP_USER ?? '';
    const pass = process.env.SMTP_SYSTEM_PASSWORD ?? process.env.SMTP_PASSWORD ?? '';
    const from = process.env.SMTP_SYSTEM_FROM ?? process.env.SMTP_FROM;
    if (!pass || !from) return null;
    return {
      host,
      port: Number(process.env.SMTP_SYSTEM_PORT ?? process.env.SMTP_PORT ?? 587),
      secure: (process.env.SMTP_SYSTEM_SECURE ?? process.env.SMTP_SECURE ?? 'false') === 'true',
      user,
      pass,
      from,
    };
  }

  get deliveryEnabled(): boolean {
    return this.smtpConfig() !== null;
  }

  async sendInviteMail(payload: InviteMailPayload, appUrl: string): Promise<void> {
    const config = this.smtpConfig();
    if (!config) throw new Error('system SMTP not configured');
    const url = `${appUrl.replace(/\/$/, '')}/accept-invite?token=${encodeURIComponent(payload.token)}`;
    await this.send(
      config,
      payload.email,
      t(payload.locale, 'inviteTitle', { tenant: payload.tenantName }),
      systemMailHtml(
        t(payload.locale, 'inviteTitle', { tenant: payload.tenantName }),
        [
          t(payload.locale, 'inviteBody1', { tenant: payload.tenantName }),
          payload.inviterName ? payload.inviterName : undefined,
          t(payload.locale, 'inviteBody2'),
        ].filter((line): line is string => Boolean(line)),
        url,
        t(payload.locale, 'linkLabel'),
      ),
    );
    this.logger.log(`invite mail sent to ${payload.email} (tenant ${payload.tenantId})`);
  }

  async sendVerifyMail(payload: VerifyMailPayload, appUrl: string): Promise<void> {
    const config = this.smtpConfig();
    if (!config) throw new Error('system SMTP not configured');
    const url = `${appUrl.replace(/\/$/, '')}/verify?token=${encodeURIComponent(payload.token)}`;
    await this.send(
      config,
      payload.email,
      t(payload.locale, 'verifyTitle'),
      systemMailHtml(
        t(payload.locale, 'verifyTitle'),
        [t(payload.locale, 'verifyBody1'), t(payload.locale, 'verifyBody2')],
        url,
        t(payload.locale, 'linkLabel2'),
      ),
    );
    this.logger.log(`verification mail sent to ${payload.email}`);
  }

  private async send(
    config: { host: string; port: number; secure: boolean; user: string; pass: string; from: string },
    to: string,
    subject: string,
    html: string,
  ): Promise<void> {
    const transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user ? { user: config.user, pass: config.pass } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
      logger: false,
      debug: false,
    });
    try {
      await transport.sendMail({ from: config.from, to, subject, html });
    } finally {
      transport.close();
    }
  }
}