/** Injection token for the Producer singleton (API + worker entrypoints). */
export const PRODUCER = Symbol('PRODUCER');
export type { Producer } from './producer';