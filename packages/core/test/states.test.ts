import { describe, expect, it } from 'vitest';

import {
  TASK_STATES,
  canTaskTransition,
  canTransition,
  isTerminalState,
} from '../src/index.js';

describe('task state machine', () => {
  const allowed = new Set([
    'INGESTED->CLASSIFIED',
    'INGESTED->FAILED',
    'CLASSIFIED->PLANNED',
    'CLASSIFIED->BLOCKED',
    'CLASSIFIED->FAILED',
    'PLANNED->GATED',
    'PLANNED->BLOCKED',
    'PLANNED->FAILED',
    'BLOCKED->GATED',
    'BLOCKED->FAILED',
    'GATED->EXECUTED',
    'GATED->FAILED',
    'EXECUTED->VERIFIED',
    'EXECUTED->FAILED',
    'VERIFIED->COMMITTED',
    'VERIFIED->FAILED',
  ]);

  it('matches the complete canonical transition matrix', () => {
    for (const from of TASK_STATES) {
      for (const to of TASK_STATES) {
        expect(canTransition(from, to)).toBe(allowed.has(`${from}->${to}`));
      }
    }
  });

  it('keeps committed and failed terminal', () => {
    expect(isTerminalState('COMMITTED')).toBe(true);
    expect(isTerminalState('FAILED')).toBe(true);
    expect(
      TASK_STATES.every((state) => !canTransition('COMMITTED', state)),
    ).toBe(true);
    expect(TASK_STATES.every((state) => !canTransition('FAILED', state))).toBe(
      true,
    );
  });

  it('requires a successor Task after a capability gap', () => {
    expect(canTaskTransition('BLOCKED', 'AWAITING_APPROVAL', 'GATED')).toBe(
      true,
    );
    expect(canTaskTransition('BLOCKED', 'CAPABILITY_GAP', 'GATED')).toBe(false);
    expect(canTaskTransition('BLOCKED', 'CAPABILITY_GAP', 'FAILED')).toBe(
      false,
    );
  });
});
