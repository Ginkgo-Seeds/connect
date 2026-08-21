import type { Port } from '@connect/shared';

export interface ConnectorDescriptor {
  readonly id: string;
  readonly operations: readonly string[];
  readonly readOnly: true;
}

export interface ReadOnlyConnectorQuery {
  readonly connectorId: string;
  readonly operation: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface ReadOnlyConnectorResult {
  readonly evidenceReference: string;
  readonly records: readonly Readonly<Record<string, unknown>>[];
}

export type ReadOnlyConnectorPort = Port<
  ReadOnlyConnectorQuery,
  ReadOnlyConnectorResult
>;

export * from './firecrawl-lead-discovery.js';
