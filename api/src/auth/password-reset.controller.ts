import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { PasswordResetService } from './password-reset.service';

@Controller('v1/auth')
export class PasswordResetController {
  constructor(private readonly resets: PasswordResetService) {}

  @Post('forgot-password')
  @HttpCode(200)
  requestReset(@Body() body: unknown) {
    return this.resets.requestReset(body);
  }

  @Post('reset-password')
  @HttpCode(200)
  resetPassword(@Body() body: unknown) {
    return this.resets.resetPassword(body);
  }
}
