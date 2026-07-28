import { describe, expect, it } from 'vitest';

import { createWorkerCompositionRoot } from '../src/index.js';

describe('worker composition root', () => {
  it('does not configure a queue in Foundation 001', () => {
    expect(createWorkerCompositionRoot()).toEqual({
      queueConfigured: false,
      status: 'foundation-pending',
    });
  });
});
