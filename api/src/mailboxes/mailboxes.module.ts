import { Module } from '@nestjs/common';
import { MailboxesController } from './mailboxes.controller';
import { MailboxVerifyService } from './mailbox-verify.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [MailboxesController],
  providers: [MailboxVerifyService],
})
export class MailboxesModule {}
