import type { Port } from '@connect/shared';

export interface LlmRequest {
  readonly messages: readonly {
    readonly content: string;
    readonly role: 'assistant' | 'system' | 'user';
  }[];
  readonly model: string;
}

export interface LlmResponse {
  readonly content: string;
  readonly providerRequestId: string;
}

export type LlmProviderPort = Port<LlmRequest, LlmResponse>;
