import { Module } from '@nestjs/common';
import { ConversationsController } from './conversations.controller';
import { AuthModule } from '../auth/auth.module';
import { ProducerModule } from '../worker/producer.module';
import { WorkerModule } from '../worker/worker.module';

@Module({
  imports: [AuthModule, ProducerModule, WorkerModule],
  controllers: [ConversationsController],
})
export class ConversationsModule {}