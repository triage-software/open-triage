import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Injectable } from '@nestjs/common';
import { Response } from 'express';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';

/**
 * Dry-run connection verification for mailbox credentials (API-CONTRACT-OUTLINE,
 * Mailboxes section). Connect + authenticate only — no mailbox is opened, no
 * message is read or sent. Timeouts are deliberately short: this runs inline in
 * an admin HTTP request, not in a worker.
 */
const CONNECT_TIMEOUT_MS = 10_000;
const GREETING_TIMEOUT_MS = 10_000;

/** Error carrying a stable API error code; the controller rethrows it as 400. */
export class MailboxVerifyError extends Error {
  constructor(
    readonly code: 'INVALID_CREDENTIALS' | 'HOST_UNREACHABLE',
    message: string,
  ) {
    super(message);
  }
}

export function classifyVerifyError(err: unknown, what: string): MailboxVerifyError {
  const e = err as { authenticationFailed?: boolean; code?: string } | null;
  // imapflow stamps AuthenticationFailure (authenticationFailed=true) on rejected
  // login; nodemailer uses the EAUTH errcode for the same condition.
  if (e?.authenticationFailed || e?.code === 'EAUTH') {
    return new MailboxVerifyError('INVALID_CREDENTIALS', `${what}: authentication failed`);
  }
  return new MailboxVerifyError(
    'HOST_UNREACHABLE',
    `${what}: ${e?.code ?? 'connection failed'}`,
  );
}

export interface VerifyTarget {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}

@Injectable()
export class MailboxVerifyService {
  /** ImapFlow dry-run: TCP/TLS connect + AUTH, then immediate logout. */
  async verifyImap(target: VerifyTarget): Promise<{ ok: true }> {
    const what = `IMAP ${target.host}:${target.port}`;
    const client = new ImapFlow({
      host: target.host,
      port: target.port,
      secure: target.secure,
      auth: { user: target.user, pass: target.password },
      verifyOnly: true,
      disableAutoIdle: true,
      connectionTimeout: CONNECT_TIMEOUT_MS,
      greetingTimeout: GREETING_TIMEOUT_MS,
      socketTimeout: GREETING_TIMEOUT_MS,
      tls: { rejectUnauthorized: process.env.NODE_ENV === 'production' },
      logger: false,
    });
    try {
      await client.connect();
      return { ok: true };
    } catch (err) {
      throw classifyVerifyError(err, what);
    } finally {
      // verifyOnly connections tear down after auth; close() is still safe if
      // connect failed before the socket existed.
      try {
        client.close();
      } catch {
        /* already closed */
      }
    }
  }

  /** SMTP handshake + AUTH check via nodemailer verify(). Sends nothing. */
  async verifySmtp(target: VerifyTarget): Promise<{ ok: true }> {
    const what = `SMTP ${target.host}:${target.port}`;
    const transport = nodemailer.createTransport({
      host: target.host,
      port: target.port,
      secure: target.secure,
      auth: { user: target.user, pass: target.password },
      connectionTimeout: CONNECT_TIMEOUT_MS,
      greetingTimeout: GREETING_TIMEOUT_MS,
      socketTimeout: CONNECT_TIMEOUT_MS,
      tls: { rejectUnauthorized: process.env.NODE_ENV === 'production' },
    });
    try {
      await transport.verify();
      return { ok: true };
    } catch (err) {
      throw classifyVerifyError(err, what);
    } finally {
      transport.close();
    }
  }
}

/**
 * MailboxVerifyError → HTTP 400 {code, message}: verify failures are
 * client-data problems (bad host/credentials), matching the {code,message}
 * error contract; everything else propagates untouched.
 */
@Catch(MailboxVerifyError)
export class MailboxVerifyExceptionFilter implements ExceptionFilter {
  catch(exception: MailboxVerifyError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    res.status(HttpStatus.BAD_REQUEST).json({ code: exception.code, message: exception.message });
  }
}
