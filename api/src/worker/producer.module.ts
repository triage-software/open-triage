import { Module } from '@nestjs/common';
import { Producer } from './producer';

/** Injection token for the Producer singleton (API + worker entrypoints). */
export const PRODUCER = Symbol('PRODUCER');

/**
 * Standalone producer module — the ONLY module API-side feature modules need
 * to import for job enqueueing. Deliberately import-free so feature modules
 * (Auth/Users/Conversations) can depend on it without cycles
 * (WorkerModule → KnowledgeModule → AuthModule → WorkerModule was a cycle).
 */
@Module({
  providers: [Producer, { provide: PRODUCER, useExisting: Producer }],
  exports: [Producer, PRODUCER],
})
export class ProducerModule {}