import { Injectable, Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { systemMailHtml } from './mail-composer';
import type { InviteMailPayload, VerifyMailPayload, PasswordResetMailPayload } from './producer';

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
    resetTitle: 'Reset your password',
    resetBody1: 'A password reset was requested for your account in {account} on Open Triage.',
    resetBody2: 'Open the link below to set a new password. The link expires in 30 minutes and works once.',
    resetBody3: 'If you did not request this, you can ignore this message. Your password stays unchanged.',
    resetLinkLabel: 'Set a new password',
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
    resetTitle: 'Zresetuj hasło',
    resetBody1: 'Otrzymaliśmy prośbę o reset hasła do Twojego konta w {account} w Open Triage.',
    resetBody2: 'Otwórz poniższy link, aby ustawić nowe hasło. Link wygasa po 30 minutach i działa jednokrotnie.',
    resetBody3: 'Jeśli to nie Ty prosisz o reset, zignoruj tę wiadomość. Twoje hasło pozostanie bez zmian.',
    resetLinkLabel: 'Ustaw nowe hasło',
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
 * System e-mail delivery (invite / verification / password reset) over SMTP.
 *
 * Configuration precedence: SMTP_SYSTEM_* env (self-host operators), else the
 * SMTP_* env fallbacks, else no delivery. Invite/verification callers keep
 * their MVP fallbacks when SMTP is not configured. Password reset requires
 * delivery and never exposes its token through an API response or logs.
 */
@Injectable()
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
    // SMTP_SYSTEM_PASSWORD may legitimately be empty (local sinks like mailpit
    // accept unauthenticated relays) — only FROM is mandatory.
    if (!from) return null;
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

  async sendPasswordResetMail(payload: PasswordResetMailPayload, appUrl: string): Promise<void> {
    const config = this.smtpConfig();
    if (!config) throw new Error('system SMTP not configured');
    const url = `${appUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(payload.token)}`;
    const title = t(payload.locale, 'resetTitle');
    const body = [
      t(payload.locale, 'resetBody1', { account: payload.accountName }),
      t(payload.locale, 'resetBody2'),
      t(payload.locale, 'resetBody3'),
    ];
    await this.send(
      config,
      payload.email,
      title,
      systemMailHtml(title, body, url, t(payload.locale, 'resetLinkLabel')),
      [title, ...body, url].join('\n\n'),
    );
  }

  private async send(
    config: { host: string; port: number; secure: boolean; user: string; pass: string; from: string },
    to: string,
    subject: string,
    html: string,
    text?: string,
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
      await transport.sendMail({ from: config.from, to, subject, html, ...(text === undefined ? {} : { text }) });
    } finally {
      transport.close();
    }
  }
}