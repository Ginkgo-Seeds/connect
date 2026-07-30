import { randomUUID } from 'node:crypto';

import type {
  CommandMetadata,
  TrustedOrganizationContext,
} from '@connect/core';

import type { DatabaseClient } from './client.js';
import { KernelPersistenceError } from './errors.js';
import { inSerializableTransaction } from './transaction.js';

export interface CreditAccountSnapshot {
  readonly organizationId: string;
  readonly available: bigint;
  readonly reserved: bigint;
  readonly version: number;
}

export class CreditRepository {
  public constructor(private readonly client: DatabaseClient) {}

  public async ensureOrganization(
    context: TrustedOrganizationContext,
  ): Promise<void> {
    await this.client.organization.upsert({
      where: { id: context.organizationId },
      create: { id: context.organizationId },
      update: {},
    });
  }

  public async grant(
    context: TrustedOrganizationContext,
    amount: bigint,
    command: CommandMetadata,
  ): Promise<CreditAccountSnapshot> {
    if (amount <= 0n) {
      throw new KernelPersistenceError('CREDIT_GRANT_MUST_BE_POSITIVE');
    }
    return inSerializableTransaction(this.client, async (transaction) => {
      const receipt = await transaction.commandReceipt.findUnique({
        where: {
          organizationId_operation_idempotencyKey: {
            organizationId: context.organizationId,
            operation: 'credits.grant',
            idempotencyKey: command.idempotencyKey,
          },
        },
      });
      if (receipt !== null) {
        if (receipt.requestHash !== command.requestHash) {
          throw new KernelPersistenceError('IDEMPOTENCY_KEY_REUSED');
        }
        return accountFromReceipt(receipt.result, context.organizationId);
      }

      const account = await transaction.creditAccount.upsert({
        where: { organizationId: context.organizationId },
        create: {
          organizationId: context.organizationId,
          available: amount,
          reserved: 0n,
          version: 1,
        },
        update: {
          available: { increment: amount },
          version: { increment: 1 },
        },
      });
      await transaction.creditLedger.create({
        data: {
          id: randomUUID(),
          organizationId: context.organizationId,
          entryType: 'OPENING_GRANT',
          amount,
          availableDelta: amount,
          reservedDelta: 0n,
          commandId: command.idempotencyKey,
        },
      });
      await transaction.commandReceipt.create({
        data: {
          id: randomUUID(),
          organizationId: context.organizationId,
          operation: 'credits.grant',
          idempotencyKey: command.idempotencyKey,
          requestHash: command.requestHash,
          result: {
            account: {
              organizationId: account.organizationId,
              available: account.available.toString(),
              reserved: account.reserved.toString(),
              version: account.version,
            },
            amount: amount.toString(),
          },
        },
      });
      return toSnapshot(account);
    });
  }

  public async get(
    context: TrustedOrganizationContext,
  ): Promise<CreditAccountSnapshot | null> {
    const account = await this.client.creditAccount.findUnique({
      where: { organizationId: context.organizationId },
    });
    return account === null ? null : toSnapshot(account);
  }
}

function toSnapshot(account: {
  organizationId: string;
  available: bigint;
  reserved: bigint;
  version: number;
}): CreditAccountSnapshot {
  return {
    organizationId: account.organizationId,
    available: account.available,
    reserved: account.reserved,
    version: account.version,
  };
}

function accountFromReceipt(
  result: unknown,
  organizationId: string,
): CreditAccountSnapshot {
  if (
    result === null ||
    typeof result !== 'object' ||
    !('account' in result) ||
    result.account === null ||
    typeof result.account !== 'object'
  ) {
    throw new KernelPersistenceError('INVALID_COMMAND_RECEIPT');
  }
  const account = result.account as Record<string, unknown>;
  if (
    account.organizationId !== organizationId ||
    typeof account.available !== 'string' ||
    typeof account.reserved !== 'string' ||
    typeof account.version !== 'number'
  ) {
    throw new KernelPersistenceError('INVALID_COMMAND_RECEIPT');
  }
  return {
    organizationId,
    available: BigInt(account.available),
    reserved: BigInt(account.reserved),
    version: account.version,
  };
}
