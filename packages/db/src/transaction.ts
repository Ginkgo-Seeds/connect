import { Prisma } from './generated/prisma/client.js';

import type { DatabaseClient } from './client.js';

const MAX_SERIALIZABLE_ATTEMPTS = 3;

export async function inSerializableTransaction<T>(
  client: DatabaseClient,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      return await client.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (
        !isRetryableTransactionError(error) ||
        attempt === MAX_SERIALIZABLE_ATTEMPTS
      ) {
        throw error;
      }
    }
  }

  throw new Error('SERIALIZABLE_RETRY_EXHAUSTED');
}

function isRetryableTransactionError(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2034' || error.code === 'P2002')
  ) {
    return true;
  }
  return (
    error instanceof Error &&
    (error.message.includes('TransactionWriteConflict') ||
      error.message.includes('could not serialize access') ||
      error.message.includes('deadlock detected'))
  );
}
