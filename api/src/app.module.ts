import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ConversationsModule } from './conversations/conversations.module';
import { UsersModule } from './users/users.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { MailboxesModule } from './mailboxes/mailboxes.module';
import { PlatformAdminModule } from './admin/platform-admin.module';
import { WorkerModule } from './worker/worker.module';

@Module({
  imports: [
    AuthModule,
    ConversationsModule,
    UsersModule,
    KnowledgeModule,
    MailboxesModule,
    PlatformAdminModule,
    WorkerModule,
  ],
})
export class AppModule {}