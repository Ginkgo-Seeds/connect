import type { JsonValue } from '@connect/core';

import type { DatabaseClient } from './client.js';
import { Prisma } from './generated/prisma/client.js';

export interface ClaimedOutboxMessage {
  readonly id: string;
  readonly organizationId: string;
  readonly eventId: string;
  readonly topic: string;
  readonly payload: JsonValue;
  readonly schemaVersion: number;
  readonly attempts: number;
  readonly claimedAt: Date;
  readonly claimedBy: string;
}

interface ClaimedOutboxRow {
  readonly id: string;
  readonly organization_id: string;
  readonly event_id: string;
  readonly topic: string;
  readonly payload: JsonValue;
  readonly schema_version: number;
  readonly attempts: number;
  readonly claimed_at: Date;
  readonly claimed_by: string;
}

export class OutboxRepository {
  public constructor(private readonly client: DatabaseClient) {}

  public claimBatch(
    workerId: string,
    limit: number,
  ): Promise<readonly ClaimedOutboxMessage[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new Error('INVALID_OUTBOX_CLAIM_LIMIT');
    }
    return this.client
      .$queryRaw<ClaimedOutboxRow[]>(
        Prisma.sql`
        WITH selected AS (
          SELECT "id"
          FROM "outbox_messages"
          WHERE "published_at" IS NULL
            AND "claimed_at" IS NULL
            AND "available_at" <= CURRENT_TIMESTAMP
          ORDER BY "available_at", "created_at", "id"
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        )
        UPDATE "outbox_messages" AS message
        SET "claimed_at" = CURRENT_TIMESTAMP,
            "claimed_by" = ${workerId},
            "attempts" = "attempts" + 1
        FROM selected
        WHERE message."id" = selected."id"
        RETURNING message.*
      `,
      )
      .then((rows) =>
        rows.map((row) => ({
          id: row.id,
          organizationId: row.organization_id,
          eventId: row.event_id,
          topic: row.topic,
          payload: row.payload,
          schemaVersion: row.schema_version,
          attempts: row.attempts,
          claimedAt: row.claimed_at,
          claimedBy: row.claimed_by,
        })),
      );
  }

  public async markPublished(id: string, workerId: string): Promise<boolean> {
    const updated = await this.client.outboxMessage.updateMany({
      where: { id, claimedBy: workerId, publishedAt: null },
      data: { publishedAt: new Date() },
    });
    return updated.count === 1;
  }

  public async markFailed(
    id: string,
    workerId: string,
    errorCode: string,
    availableAt: Date,
  ): Promise<boolean> {
    const updated = await this.client.outboxMessage.updateMany({
      where: { id, claimedBy: workerId, publishedAt: null },
      data: {
        claimedAt: null,
        claimedBy: null,
        lastErrorCode: errorCode,
        availableAt,
      },
    });
    return updated.count === 1;
  }
}
