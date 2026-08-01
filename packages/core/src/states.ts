export const TASK_STATES = [
  'INGESTED',
  'CLASSIFIED',
  'PLANNED',
  'BLOCKED',
  'GATED',
  'EXECUTED',
  'VERIFIED',
  'COMMITTED',
  'FAILED',
] as const;

export type TaskState = (typeof TASK_STATES)[number];

export const RISK_LEVELS = ['R0', 'R1', 'R2', 'R3'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const MATURITIES = ['SIMULATION', 'SHADOW', 'PRODUCTION'] as const;
export type Maturity = (typeof MATURITIES)[number];

export const TASK_BLOCK_REASONS = [
  'AWAITING_APPROVAL',
  'CAPABILITY_GAP',
] as const;
export type TaskBlockReason = (typeof TASK_BLOCK_REASONS)[number];

const TRANSITIONS: Readonly<Record<TaskState, readonly TaskState[]>> = {
  INGESTED: ['CLASSIFIED', 'FAILED'],
  CLASSIFIED: ['PLANNED', 'BLOCKED', 'FAILED'],
  PLANNED: ['GATED', 'BLOCKED', 'FAILED'],
  BLOCKED: ['GATED', 'FAILED'],
  GATED: ['EXECUTED', 'FAILED'],
  EXECUTED: ['VERIFIED', 'FAILED'],
  VERIFIED: ['COMMITTED', 'FAILED'],
  COMMITTED: [],
  FAILED: [],
};

export function canTransition(from: TaskState, to: TaskState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function canTaskTransition(
  from: TaskState,
  blockReason: TaskBlockReason | null,
  to: TaskState,
): boolean {
  if (from === 'BLOCKED') {
    return (
      blockReason === 'AWAITING_APPROVAL' && (to === 'GATED' || to === 'FAILED')
    );
  }
  return blockReason === null && canTransition(from, to);
}

export function assertTransition(from: TaskState, to: TaskState): void {
  if (!canTransition(from, to)) {
    throw new Error(`INVALID_TRANSITION:${from}->${to}`);
  }
}

export function isTerminalState(state: TaskState): boolean {
  return state === 'COMMITTED' || state === 'FAILED';
}
