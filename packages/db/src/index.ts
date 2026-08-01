export * from './client.js';
export * from './credits.js';
export * from './errors.js';
export * from './kernel-store.js';
export * from './outbox.js';
export * from './transaction.js';

export interface DatabaseHealth {
  readonly latencyMilliseconds: number;
  readonly status: 'healthy' | 'unavailable';
}
