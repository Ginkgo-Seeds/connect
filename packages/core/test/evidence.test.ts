import { describe, expect, it } from 'vitest';

import {
  validateExecutionEvidence,
  type EvidenceDraft,
  type EvidenceRequirement,
} from '../src/index.js';

const requirement: EvidenceRequirement = {
  types: ['EXTERNAL_CONFIRMATION'],
  minimumStrength: 'STRONG',
  producerMustMatchExecutor: true,
  contentHashPrefix: 'sha256:',
};

function evidence(overrides: Partial<EvidenceDraft> = {}): EvidenceDraft {
  return {
    purpose: 'EXECUTION',
    type: 'EXTERNAL_CONFIRMATION',
    strength: 'STRONG',
    producer: 'executor:demo',
    contentHash: 'sha256:abc',
    ...overrides,
  };
}

describe('execution evidence', () => {
  it('accepts evidence matching the frozen requirement', () => {
    expect(
      validateExecutionEvidence([evidence()], requirement, 'executor:demo'),
    ).toEqual({ ok: true, code: null });
  });

  it.each([
    ['wrong purpose', { purpose: 'APPROVAL' as const }],
    ['wrong type', { type: 'LOG' as const }],
    ['weak', { strength: 'WEAK' as const }],
    ['wrong producer', { producer: 'executor:other' }],
    ['wrong hash', { contentHash: 'other:abc' }],
  ])('fails closed for %s', (_name, override) => {
    expect(
      validateExecutionEvidence(
        [evidence(override)],
        requirement,
        'executor:demo',
      ).ok,
    ).toBe(false);
  });

  it('does not let an approval attestation prove an external effect', () => {
    expect(
      validateExecutionEvidence(
        [
          evidence({
            purpose: 'APPROVAL',
            type: 'ATTESTATION',
            producer: 'user:owner',
          }),
        ],
        requirement,
        'executor:demo',
      ).code,
    ).toBe('NO_EXECUTION_EVIDENCE');
  });
});
