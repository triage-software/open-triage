import { Module } from '@nestjs/common';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeIndexService } from './knowledge-index.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeIndexService],
  exports: [KnowledgeIndexService],
})
export class KnowledgeModule {}
