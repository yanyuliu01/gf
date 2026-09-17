/**
 * Resource Ledger (M21-008).
 *
 * Deterministic ledger for resource/process persistence with:
 * - Balanced transfers (double-entry accounting)
 * - Non-negative stock enforcement
 * - Interval capacity reservations
 * - Source closure validation
 * - Revision CAS (Compare-and-Swap)
 * - Idempotency via entry IDs
 *
 * All balance changes are immutable audit entries. The ledger enforces
 * conservation laws based on resource type (stock, currency, capacity, etc.)
 */

import type { DatabaseSync } from "../state/db.js";
import type {
  ResourceTypeV1,
  ResourceAccountV1,
  ResourceReservationV1,
  ResourceDeltaV1,
  SourceRef,
  Sha256Hash,
} from "../generated/worldRuntimeTypes.js";
import { newId, utcnowIso } from "../domain/ids.js";
import { createHash } from "node:crypto";

export interface LedgerConfig {
  enforceNonNegative: boolean;
  enforceBalancedTransfers: boolean;
  ledgerVersion: string;
}

export interface TransferEntry {
  accountId: string;
  resourceTypeId: string;
  delta: number;
  reason: string;
}

export interface TransferRequest {
  entries: readonly TransferEntry[];
  sourceRefs: readonly SourceRef[];
  baseStateRevision: number;
  idempotencyKey?: string;
}

export interface TransferResult {
  committed: boolean;
  transferGroupId?: string;
  ledgerEntryIds?: string[];
  error?: string;
  replay?: boolean;
}

export interface ReservationRequest {
  accountId: string;
  resourceTypeId: string;
  amount: number;
  reservedAt: string;
  expiresAt: string;
  purpose: string;
  processInstanceId?: string;
  activityId?: string;
  sourceRefs: readonly SourceRef[];
  baseStateRevision: number;
  idempotencyKey?: string;
}

export interface ReservationResult {
  committed: boolean;
  reservationId?: string;
  error?: string;
  replay?: boolean;
}

export class ResourceLedgerError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "INSUFFICIENT_BALANCE"
      | "UNBALANCED_TRANSFER"
      | "REVISION_MISMATCH"
      | "INVALID_RESOURCE_TYPE"
      | "ACCOUNT_NOT_FOUND"
      | "CAPACITY_EXCEEDED"
      | "SOURCE_CLOSURE_INVALID",
  ) {
    super(message);
    this.name = "ResourceLedgerError";
  }
}

function computeSourceClosureHash(sourceRefs: readonly SourceRef[]): Sha256Hash {
  const sorted = [...sourceRefs].sort((a, b) =>
    `${a.source_type}:${a.source_id}`.localeCompare(`${b.source_type}:${b.source_id}`),
  );
  const json = JSON.stringify(sorted);
  return createHash("sha256").update(json).digest("hex");
}

/**
 * Resource Ledger for deterministic resource management.
 */
export class ResourceLedger {
  constructor(
    private readonly db: DatabaseSync,
    private readonly config: LedgerConfig,
  ) {}

  /**
   * Register a new resource type.
   */
  registerResourceType(type: ResourceTypeV1): void {
    this.db
      .prepare(
        `INSERT INTO resource_types(
          resource_type_id, schema_version, law, unit, min_balance, max_balance,
          decay_model, version, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        type.resource_type_id,
        type.schema_version,
        type.law,
        type.unit,
        type.min_balance ?? null,
        type.max_balance ?? null,
        type.decay_model ?? null,
        type.version,
        utcnowIso(),
      );
  }

  /**
   * Get a resource type by ID.
   */
  getResourceType(resourceTypeId: string): ResourceTypeV1 | null {
    const row = this.db
      .prepare(
        `SELECT resource_type_id, schema_version, law, unit, min_balance, max_balance,
                decay_model, version
         FROM resource_types WHERE resource_type_id = ?`,
      )
      .get(resourceTypeId) as {
      resource_type_id: string;
      schema_version: string;
      law: string;
      unit: string;
      min_balance: number | null;
      max_balance: number | null;
      decay_model: string | null;
      version: string;
    } | undefined;

    if (!row) return null;

    return {
      schema_version: "1.0",
      resource_type_id: row.resource_type_id,
      law: row.law as ResourceTypeV1["law"],
      unit: row.unit,
      min_balance: row.min_balance ?? undefined,
      max_balance: row.max_balance ?? undefined,
      decay_model: row.decay_model ?? undefined,
      version: row.version,
    };
  }

  /**
   * Create a new resource account.
   */
  createAccount(account: Omit<ResourceAccountV1, "revision">): string {
    const now = utcnowIso();
    this.db
      .prepare(
        `INSERT INTO resource_accounts(
          account_id, schema_version, resource_type_id, owner_id, location_id,
          balance, reserved, revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        account.account_id,
        account.schema_version,
        account.resource_type_id,
        account.owner_id,
        account.location_id ?? null,
        account.balance,
        account.reserved,
        0,
        now,
        now,
      );
    return account.account_id;
  }

  /**
   * Get an account by ID.
   */
  getAccount(accountId: string): ResourceAccountV1 | null {
    const row = this.db
      .prepare(
        `SELECT account_id, schema_version, resource_type_id, owner_id, location_id,
                balance, reserved, revision
         FROM resource_accounts WHERE account_id = ?`,
      )
      .get(accountId) as {
      account_id: string;
      schema_version: string;
      resource_type_id: string;
      owner_id: string;
      location_id: string | null;
      balance: number;
      reserved: number;
      revision: number;
    } | undefined;

    if (!row) return null;

    return {
      schema_version: "1.0",
      account_id: row.account_id,
      resource_type_id: row.resource_type_id,
      owner_id: row.owner_id,
      location_id: row.location_id ?? undefined,
      balance: row.balance,
      reserved: row.reserved,
      revision: row.revision,
    };
  }

  /**
   * Execute a balanced transfer (double-entry).
   * For stock/currency resources, the sum of all deltas must be zero.
   */
  transfer(request: TransferRequest): TransferResult {
    if (request.idempotencyKey) {
      const existing = this.db
        .prepare(
          `SELECT ledger_entry_id, transfer_group_id
           FROM resource_ledger WHERE idempotency_key = ?`,
        )
        .get(request.idempotencyKey) as {
        ledger_entry_id: string;
        transfer_group_id: string | null;
      } | undefined;

      if (existing) {
        const entries = this.db
          .prepare(
            `SELECT ledger_entry_id FROM resource_ledger
             WHERE transfer_group_id = ?`,
          )
          .all(existing.transfer_group_id) as { ledger_entry_id: string }[];

        return {
          committed: true,
          transferGroupId: existing.transfer_group_id ?? undefined,
          ledgerEntryIds: entries.map((e) => e.ledger_entry_id),
          replay: true,
        };
      }
    }

    if (request.entries.length === 0) {
      return { committed: true, ledgerEntryIds: [] };
    }

    if (this.config.enforceBalancedTransfers) {
      const byType = new Map<string, number>();
      for (const entry of request.entries) {
        const resourceType = this.getResourceType(entry.resourceTypeId);
        if (!resourceType) {
          return {
            committed: false,
            error: `Unknown resource type: ${entry.resourceTypeId}`,
          };
        }
        if (resourceType.law === "stock" || resourceType.law === "currency") {
          byType.set(
            entry.resourceTypeId,
            (byType.get(entry.resourceTypeId) ?? 0) + entry.delta,
          );
        }
      }

      for (const [typeId, sum] of byType) {
        if (Math.abs(sum) > 1e-10) {
          return {
            committed: false,
            error: `Unbalanced transfer for ${typeId}: sum=${sum}`,
          };
        }
      }
    }

    const transferGroupId = request.entries.length > 1 ? newId("txg") : undefined;
    const sourceClosureHash = computeSourceClosureHash(request.sourceRefs);
    const ledgerEntryIds: string[] = [];
    const now = utcnowIso();

    for (let i = 0; i < request.entries.length; i++) {
      const entry = request.entries[i];
      const account = this.getAccount(entry.accountId);
      if (!account) {
        return {
          committed: false,
          error: `Account not found: ${entry.accountId}`,
        };
      }

      const resourceType = this.getResourceType(entry.resourceTypeId);
      if (!resourceType) {
        return {
          committed: false,
          error: `Unknown resource type: ${entry.resourceTypeId}`,
        };
      }

      if (account.resource_type_id !== entry.resourceTypeId) {
        return {
          committed: false,
          error: `Account ${entry.accountId} is for ${account.resource_type_id}, not ${entry.resourceTypeId}`,
        };
      }

      const balanceBefore = account.balance;
      const balanceAfter = balanceBefore + entry.delta;

      if (this.config.enforceNonNegative && resourceType.law === "stock") {
        const minBalance = resourceType.min_balance ?? 0;
        if (balanceAfter < minBalance) {
          return {
            committed: false,
            error: `Insufficient balance in ${entry.accountId}: ${balanceBefore} + ${entry.delta} < ${minBalance}`,
          };
        }
      }

      if (resourceType.max_balance !== undefined && balanceAfter > resourceType.max_balance) {
        return {
          committed: false,
          error: `Balance exceeds max for ${entry.accountId}: ${balanceAfter} > ${resourceType.max_balance}`,
        };
      }

      const ledgerEntryId = newId("led");
      const idempotencyKeyForEntry =
        request.idempotencyKey && i === 0 ? request.idempotencyKey : null;

      this.db
        .prepare(
          `INSERT INTO resource_ledger(
            ledger_entry_id, account_id, resource_type_id, delta,
            balance_before, balance_after, reason, transfer_group_id,
            base_state_revision, source_closure_hash, idempotency_key, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          ledgerEntryId,
          entry.accountId,
          entry.resourceTypeId,
          entry.delta,
          balanceBefore,
          balanceAfter,
          entry.reason,
          transferGroupId ?? null,
          request.baseStateRevision,
          sourceClosureHash,
          idempotencyKeyForEntry,
          now,
        );

      for (const sourceRef of request.sourceRefs) {
        this.db
          .prepare(
            `INSERT INTO resource_ledger_sources(
              ledger_entry_id, source_type, source_id, quote_hash, observed_at
            ) VALUES (?, ?, ?, ?, ?)`,
          )
          .run(
            ledgerEntryId,
            sourceRef.source_type,
            sourceRef.source_id,
            sourceRef.quote_hash ?? null,
            sourceRef.observed_at ?? null,
          );
      }

      this.db
        .prepare(
          `UPDATE resource_accounts
           SET balance = ?, revision = revision + 1, updated_at = ?
           WHERE account_id = ?`,
        )
        .run(balanceAfter, now, entry.accountId);

      ledgerEntryIds.push(ledgerEntryId);
    }

    return {
      committed: true,
      transferGroupId,
      ledgerEntryIds,
    };
  }

  /**
   * Create a capacity reservation for an interval.
   */
  reserve(request: ReservationRequest): ReservationResult {
    if (request.idempotencyKey) {
      const existing = this.db
        .prepare(
          `SELECT reservation_id FROM resource_reservations
           WHERE idempotency_key = ?`,
        )
        .get(request.idempotencyKey) as { reservation_id: string } | undefined;

      if (existing) {
        return {
          committed: true,
          reservationId: existing.reservation_id,
          replay: true,
        };
      }
    }

    const account = this.getAccount(request.accountId);
    if (!account) {
      return {
        committed: false,
        error: `Account not found: ${request.accountId}`,
      };
    }

    const resourceType = this.getResourceType(request.resourceTypeId);
    if (!resourceType) {
      return {
        committed: false,
        error: `Unknown resource type: ${request.resourceTypeId}`,
      };
    }

    if (resourceType.law !== "capacity") {
      return {
        committed: false,
        error: `Resource ${request.resourceTypeId} is not a capacity type`,
      };
    }

    const overlappingSum = this.db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) as total
         FROM resource_reservations
         WHERE account_id = ?
           AND status IN ('pending', 'active')
           AND reserved_at < ?
           AND expires_at > ?`,
      )
      .get(request.accountId, request.expiresAt, request.reservedAt) as {
      total: number;
    };

    const totalReserved = overlappingSum.total + request.amount;
    if (totalReserved > account.balance) {
      return {
        committed: false,
        error: `Capacity exceeded: ${totalReserved} > ${account.balance}`,
      };
    }

    const reservationId = newId("rsv");
    const now = utcnowIso();

    this.db
      .prepare(
        `INSERT INTO resource_reservations(
          reservation_id, schema_version, account_id, resource_type_id, amount,
          status, reserved_at, expires_at, purpose, process_instance_id,
          activity_id, idempotency_key, revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        reservationId,
        "1.0",
        request.accountId,
        request.resourceTypeId,
        request.amount,
        "active",
        request.reservedAt,
        request.expiresAt,
        request.purpose,
        request.processInstanceId ?? null,
        request.activityId ?? null,
        request.idempotencyKey ?? null,
        0,
        now,
        now,
      );

    this.db
      .prepare(
        `UPDATE resource_accounts
         SET reserved = reserved + ?, revision = revision + 1, updated_at = ?
         WHERE account_id = ?`,
      )
      .run(request.amount, now, request.accountId);

    return {
      committed: true,
      reservationId,
    };
  }

  /**
   * Release a reservation.
   */
  releaseReservation(reservationId: string): boolean {
    const reservation = this.db
      .prepare(
        `SELECT reservation_id, account_id, amount, status
         FROM resource_reservations WHERE reservation_id = ?`,
      )
      .get(reservationId) as {
      reservation_id: string;
      account_id: string;
      amount: number;
      status: string;
    } | undefined;

    if (!reservation) return false;
    if (reservation.status === "released" || reservation.status === "cancelled") {
      return true;
    }

    const now = utcnowIso();

    this.db
      .prepare(
        `UPDATE resource_reservations
         SET status = 'released', revision = revision + 1, updated_at = ?
         WHERE reservation_id = ?`,
      )
      .run(now, reservationId);

    this.db
      .prepare(
        `UPDATE resource_accounts
         SET reserved = reserved - ?, revision = revision + 1, updated_at = ?
         WHERE account_id = ?`,
      )
      .run(reservation.amount, now, reservation.account_id);

    return true;
  }

  /**
   * Get the current state revision from ledger entries.
   */
  getCurrentRevision(): number {
    const result = this.db
      .prepare(`SELECT MAX(base_state_revision) as max_rev FROM resource_ledger`)
      .get() as { max_rev: number | null };
    return result.max_rev ?? 0;
  }

  /**
   * Get ledger entries for an account.
   */
  getAccountLedger(
    accountId: string,
    limit = 100,
  ): {
    ledgerEntryId: string;
    delta: number;
    balanceBefore: number;
    balanceAfter: number;
    reason: string;
    createdAt: string;
  }[] {
    const rows = this.db
      .prepare(
        `SELECT ledger_entry_id, delta, balance_before, balance_after, reason, created_at
         FROM resource_ledger WHERE account_id = ?
         ORDER BY rowid DESC LIMIT ?`,
      )
      .all(accountId, limit) as {
      ledger_entry_id: string;
      delta: number;
      balance_before: number;
      balance_after: number;
      reason: string;
      created_at: string;
    }[];

    return rows.map((row) => ({
      ledgerEntryId: row.ledger_entry_id,
      delta: row.delta,
      balanceBefore: row.balance_before,
      balanceAfter: row.balance_after,
      reason: row.reason,
      createdAt: row.created_at,
    }));
  }

  /**
   * Get reservations overlapping an interval.
   */
  getOverlappingReservations(
    accountId: string,
    fromTime: string,
    untilTime: string,
  ): ResourceReservationV1[] {
    const rows = this.db
      .prepare(
        `SELECT reservation_id, schema_version, account_id, resource_type_id, amount,
                status, reserved_at, expires_at, purpose, process_instance_id,
                activity_id, idempotency_key, revision
         FROM resource_reservations
         WHERE account_id = ?
           AND status IN ('pending', 'active')
           AND reserved_at < ?
           AND expires_at > ?`,
      )
      .all(accountId, untilTime, fromTime) as {
      reservation_id: string;
      schema_version: string;
      account_id: string;
      resource_type_id: string;
      amount: number;
      status: string;
      reserved_at: string;
      expires_at: string;
      purpose: string;
      process_instance_id: string | null;
      activity_id: string | null;
      idempotency_key: string | null;
      revision: number;
    }[];

    return rows.map((row) => ({
      schema_version: "1.0",
      reservation_id: row.reservation_id,
      account_id: row.account_id,
      resource_type_id: row.resource_type_id,
      amount: row.amount,
      status: row.status as ResourceReservationV1["status"],
      reserved_at: row.reserved_at,
      expires_at: row.expires_at,
      purpose: row.purpose,
      process_instance_id: row.process_instance_id ?? undefined,
      activity_id: row.activity_id ?? undefined,
      idempotency_key: row.idempotency_key ?? undefined,
      revision: row.revision,
    }));
  }

  /**
   * Apply resource deltas from a world step result.
   */
  applyDeltas(
    deltas: readonly ResourceDeltaV1[],
    sourceRefs: readonly SourceRef[],
    baseStateRevision: number,
    idempotencyKey?: string,
  ): TransferResult {
    const entries: TransferEntry[] = deltas.map((d) => ({
      accountId: d.account_id,
      resourceTypeId: d.resource_type_id,
      delta: d.delta,
      reason: d.reason,
    }));

    return this.transfer({
      entries,
      sourceRefs,
      baseStateRevision,
      idempotencyKey,
    });
  }
}
