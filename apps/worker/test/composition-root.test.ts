import type {
  EffectivePolicyProvider,
  ExecutorEligibilityProvider,
  PricingProvider,
  SkillCatalogProvider,
} from '@connect/core';
import type { DatabaseClient } from '@connect/db';
import { describe, expect, it } from 'vitest';

import { createWorkerCompositionRoot } from '../src/index.js';

describe('worker composition root', () => {
  it('wires the PostgreSQL Kernel without configuring a queue', () => {
    const root = createWorkerCompositionRoot({
      database: {} as DatabaseClient,
      catalogProvider: {} as SkillCatalogProvider,
      policyProvider: {} as EffectivePolicyProvider,
      pricingProvider: {} as PricingProvider,
      eligibilityProvider: {} as ExecutorEligibilityProvider,
      executors: {},
      clock: { now: () => new Date('2026-07-28T00:00:00.000Z') },
      identifiers: { next: () => 'id' },
      workerId: 'worker-test',
      leaseMilliseconds: 60_000,
    });
    expect(root.queueConfigured).toBe(false);
    expect(root.status).toBe('foundation-pending');
    expect(root.kernelStore).toBeDefined();
    expect(root.runner).toBeDefined();
  });
});
