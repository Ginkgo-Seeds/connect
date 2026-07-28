import type { Port } from '@connect/shared';

export interface SecretReference {
  readonly key: string;
}

export interface SecretLease {
  readonly expiresAt: Date | null;
  readonly value: string;
}

export type SecretResolverPort = Port<SecretReference, SecretLease>;

export interface GovernedExecutionRequest {
  readonly input: Readonly<Record<string, unknown>>;
  readonly workflowReference: string;
}

export interface GovernedExecutionResult {
  readonly evidenceReference: string;
  readonly output: Readonly<Record<string, unknown>>;
}

export type GovernedExecutionPort = Port<
  GovernedExecutionRequest,
  GovernedExecutionResult
>;
