import type { FoundationStatus } from '@connect/shared';

export interface ClockPort {
  now(): Date;
}

export interface IdentifierPort {
  next(): string;
}

export interface CoreContract {
  readonly clock: ClockPort;
  readonly identifiers: IdentifierPort;
  readonly status: FoundationStatus;
}
