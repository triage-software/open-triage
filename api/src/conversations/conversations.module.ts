import { Module } from '@nestjs/common';
import { ConversationsController } from './conversations.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ConversationsController],
})
export class ConversationsModule {}
