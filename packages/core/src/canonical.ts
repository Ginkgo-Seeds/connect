import { createHash } from 'node:crypto';

import type { JsonValue } from './domain.js';

function normalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => normalize(item));
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, normalize(item)]),
    );
  }

  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('NON_FINITE_JSON_NUMBER');
  }

  return value;
}

export function canonicalJson(value: JsonValue): string {
  return JSON.stringify(normalize(value));
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hashCanonicalJson(value: JsonValue): string {
  return sha256(canonicalJson(value));
}
