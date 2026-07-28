import type { Port } from '@connect/shared';

export interface ExportArtifactRequest {
  readonly content: Uint8Array;
  readonly contentType: string;
  readonly fileName: string;
}

export interface ExportArtifactResult {
  readonly artifactReference: string;
  readonly checksum: string;
}

export type ExportArtifactPort = Port<
  ExportArtifactRequest,
  ExportArtifactResult
>;
