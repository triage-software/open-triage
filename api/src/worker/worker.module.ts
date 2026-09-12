import { Module } from '@nestjs/common';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { ProducerModule } from './producer.module';
import { MailSyncService } from './mail-sync.service';
import { MailSendService } from './mail-send.service';
import { NotificationService } from './notifications.service';
import { AiTriageService } from './ai-triage.service';

/**
 * Worker module — BullMQ consumers for the mail/AI slice (SPEC-0001 worker
 * topology). Used by the standalone worker entrypoint (dist/worker/worker.js);
 * API-side feature modules import ProducerModule only (no consumer deps).
 */
@Module({
  imports: [ProducerModule, KnowledgeModule],
  providers: [MailSyncService, MailSendService, NotificationService, AiTriageService],
  exports: [ProducerModule, MailSyncService, MailSendService, NotificationService, AiTriageService],
})
export class WorkerModule {}