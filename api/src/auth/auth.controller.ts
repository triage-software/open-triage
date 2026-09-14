import {
  Controller, Post, Get, Body, Res, Req, HttpCode,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { SessionGuard } from './guards';
import { parseSessionCookie } from './crypto.util';
import { SESSION_COOKIE } from './auth.types';

@Controller('v1/auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  private sessionId(req: Request): string | undefined {
    return parseSessionCookie(req.cookies?.[SESSION_COOKIE], process.env.SESSION_SECRET ?? '') ?? undefined;
  }

  @Post('signup')
  @HttpCode(201)
  async signup(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    return this.auth.signup(body, res);
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    return this.auth.login(body, res);
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.logout(this.sessionId(req));
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return result;
  }

  @Post('verify')
  @HttpCode(200)
  async verify(@Body() body: { token?: string }) {
    return this.auth.verify(String(body?.token ?? ''));
  }

  /** QA-3: invited teammates set their password with the one-time setup token. */
  @Post('accept-invite')
  @HttpCode(200)
  async acceptInvite(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    return this.auth.acceptInvite(body, res);
  }

  /** POST /auth/resend-verification — issues a fresh verify token for the current user. */
  @Post('resend-verification')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async resendVerification(@Req() req: Request) {
    return this.auth.resendVerification(req.user!.userId);
  }

  @Get('me')
  @UseGuards(SessionGuard)
  async me(@Req() req: Request) {
    if (req.platformAdmin) {
      return { platformAdmin: { email: req.platformAdmin.email, locale: req.platformAdmin.locale } };
    }
    return this.auth.me(req.user!);
  }
}
