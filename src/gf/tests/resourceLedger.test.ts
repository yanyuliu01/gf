/**
 * M21-008: Resource Ledger Tests.
 *
 * Tests deterministic ledger with:
 * - Balanced transfers (WM-P02)
 * - Non-negative stocks (WM-P01)
 * - Interval capacity reservations (WM-P03)
 * - Source closure tracking
 * - Revision CAS
 * - Idempotency
 *
 * Property tests verify invariants from docs/world/16.
 */

import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { connect, type DatabaseSync } from "../state/db.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ResourceLedger,
  ResourceLedgerError,
  type LedgerConfig,
  type TransferEntry,
} from "../world/resourceLedger.js";
import type { ResourceTypeV1, ResourceAccountV1, SourceRef } from "../generated/worldRuntimeTypes.js";
import { newId } from "../domain/ids.js";

function createTestDb(): DatabaseSync {
  const db = connect(":memory:");
  const migrations = [
    "001_initial.sql",
    "002_agent_pipeline.sql",
    "003_cognitive_runtime.sql",
    "004_memory_search.sql",
    "005_life_pilot.sql",
    "006_resource_ledger.sql",
  ];

  for (const migration of migrations) {
    const sql = readFileSync(join(process.cwd(), "migrations", migration), "utf-8");
    db.exec(sql);
  }

  return db;
}

function makeSourceRef(id?: string): SourceRef {
  return {
    source_type: "event",
    source_id: id ?? newId("evt"),
  };
}

describe("Resource Ledger", () => {
  let db: DatabaseSync;
  let ledger: ResourceLedger;
  const config: LedgerConfig = {
    enforceNonNegative: true,
    enforceBalancedTransfers: true,
    ledgerVersion: "1.0",
  };

  beforeEach(() => {
    db = createTestDb();
    ledger = new ResourceLedger(db, config);
  });

  afterEach(() => {
    db.close();
  });

  describe("Resource Type Management", () => {
    test("register and retrieve resource type", () => {
      const resourceType: ResourceTypeV1 = {
        schema_version: "1.0",
        resource_type_id: "water",
        law: "stock",
        unit: "liter",
        min_balance: 0,
        version: "v1",
      };

      ledger.registerResourceType(resourceType);
      const retrieved = ledger.getResourceType("water");

      assert.ok(retrieved);
      assert.equal(retrieved.resource_type_id, "water");
      assert.equal(retrieved.law, "stock");
      assert.equal(retrieved.unit, "liter");
    });

    test("return null for non-existent resource type", () => {
      const result = ledger.getResourceType("nonexistent");
      assert.equal(result, null);
    });
  });

  describe("Account Management", () => {
    beforeEach(() => {
      ledger.registerResourceType({
        schema_version: "1.0",
        resource_type_id: "credits",
        law: "currency",
        unit: "credit",
        version: "v1",
      });
    });

    test("create and retrieve account", () => {
      const accountId = ledger.createAccount({
        schema_version: "1.0",
        account_id: "acc_1",
        resource_type_id: "credits",
        owner_id: "owner_1",
        balance: 100,
        reserved: 0,
      });

      const account = ledger.getAccount(accountId);
      assert.ok(account);
      assert.equal(account.balance, 100);
      assert.equal(account.reserved, 0);
      assert.equal(account.revision, 0);
    });

    test("return null for non-existent account", () => {
      const result = ledger.getAccount("nonexistent");
      assert.equal(result, null);
    });
  });

  describe("Balanced Transfers (WM-P02)", () => {
    beforeEach(() => {
      ledger.registerResourceType({
        schema_version: "1.0",
        resource_type_id: "credits",
        law: "currency",
        unit: "credit",
        version: "v1",
      });
      ledger.createAccount({
        schema_version: "1.0",
        account_id: "acc_alice",
        resource_type_id: "credits",
        owner_id: "alice",
        balance: 100,
        reserved: 0,
      });
      ledger.createAccount({
        schema_version: "1.0",
        account_id: "acc_bob",
        resource_type_id: "credits",
        owner_id: "bob",
        balance: 50,
        reserved: 0,
      });
    });

    test("accept balanced transfer", () => {
      const result = ledger.transfer({
        entries: [
          { accountId: "acc_alice", resourceTypeId: "credits", delta: -30, reason: "payment" },
          { accountId: "acc_bob", resourceTypeId: "credits", delta: 30, reason: "received" },
        ],
        sourceRefs: [makeSourceRef()],
        baseStateRevision: 0,
      });

      assert.equal(result.committed, true);
      assert.ok(result.transferGroupId);
      assert.equal(result.ledgerEntryIds?.length, 2);

      const alice = ledger.getAccount("acc_alice");
      const bob = ledger.getAccount("acc_bob");
      assert.equal(alice?.balance, 70);
      assert.equal(bob?.balance, 80);
    });

    test("reject unbalanced transfer", () => {
      const result = ledger.transfer({
        entries: [
          { accountId: "acc_alice", resourceTypeId: "credits", delta: -30, reason: "payment" },
          { accountId: "acc_bob", resourceTypeId: "credits", delta: 20, reason: "received" },
        ],
        sourceRefs: [makeSourceRef()],
        baseStateRevision: 0,
      });

      assert.equal(result.committed, false);
      assert.ok(result.error?.includes("Unbalanced"));

      const alice = ledger.getAccount("acc_alice");
      assert.equal(alice?.balance, 100);
    });

    test("allow unbalanced when config disabled", () => {
      const unbalancedLedger = new ResourceLedger(db, {
        ...config,
        enforceBalancedTransfers: false,
      });

      const result = unbalancedLedger.transfer({
        entries: [
          { accountId: "acc_alice", resourceTypeId: "credits", delta: 1000, reason: "external_in" },
        ],
        sourceRefs: [makeSourceRef()],
        baseStateRevision: 0,
      });

      assert.equal(result.committed, true);
      const alice = ledger.getAccount("acc_alice");
      assert.equal(alice?.balance, 1100);
    });
  });

  describe("Non-negative Stocks (WM-P01)", () => {
    beforeEach(() => {
      ledger.registerResourceType({
        schema_version: "1.0",
        resource_type_id: "water",
        law: "stock",
        unit: "liter",
        min_balance: 0,
        version: "v1",
      });
      ledger.createAccount({
        schema_version: "1.0",
        account_id: "tank_1",
        resource_type_id: "water",
        owner_id: "ecology",
        balance: 100,
        reserved: 0,
      });
      ledger.createAccount({
        schema_version: "1.0",
        account_id: "tank_2",
        resource_type_id: "water",
        owner_id: "ecology",
        balance: 50,
        reserved: 0,
      });
    });

    test("reject transfer that would go negative", () => {
      const result = ledger.transfer({
        entries: [
          { accountId: "tank_1", resourceTypeId: "water", delta: -150, reason: "drain" },
          { accountId: "tank_2", resourceTypeId: "water", delta: 150, reason: "fill" },
        ],
        sourceRefs: [makeSourceRef()],
        baseStateRevision: 0,
      });

      assert.equal(result.committed, false);
      assert.ok(result.error?.includes("Insufficient"));

      const tank1 = ledger.getAccount("tank_1");
      assert.equal(tank1?.balance, 100);
    });

    test("allow transfer within balance", () => {
      const result = ledger.transfer({
        entries: [
          { accountId: "tank_1", resourceTypeId: "water", delta: -50, reason: "drain" },
          { accountId: "tank_2", resourceTypeId: "water", delta: 50, reason: "fill" },
        ],
        sourceRefs: [makeSourceRef()],
        baseStateRevision: 0,
      });

      assert.equal(result.committed, true);
      const tank1 = ledger.getAccount("tank_1");
      const tank2 = ledger.getAccount("tank_2");
      assert.equal(tank1?.balance, 50);
      assert.equal(tank2?.balance, 100);
    });
  });

  describe("Capacity Reservations (WM-P03)", () => {
    beforeEach(() => {
      ledger.registerResourceType({
        schema_version: "1.0",
        resource_type_id: "bench_time",
        law: "capacity",
        unit: "bench-minute",
        version: "v1",
      });
      ledger.createAccount({
        schema_version: "1.0",
        account_id: "bench_1",
        resource_type_id: "bench_time",
        owner_id: "lab",
        balance: 480,
        reserved: 0,
      });
    });

    test("create reservation within capacity", () => {
      const result = ledger.reserve({
        accountId: "bench_1",
        resourceTypeId: "bench_time",
        amount: 120,
        reservedAt: "2026-09-17T09:00:00Z",
        expiresAt: "2026-09-17T11:00:00Z",
        purpose: "experiment_1",
        sourceRefs: [makeSourceRef()],
        baseStateRevision: 0,
      });

      assert.equal(result.committed, true);
      assert.ok(result.reservationId);

      const account = ledger.getAccount("bench_1");
      assert.equal(account?.reserved, 120);
    });

    test("reject overlapping reservations exceeding capacity", () => {
      ledger.reserve({
        accountId: "bench_1",
        resourceTypeId: "bench_time",
        amount: 300,
        reservedAt: "2026-09-17T09:00:00Z",
        expiresAt: "2026-09-17T14:00:00Z",
        purpose: "experiment_1",
        sourceRefs: [makeSourceRef()],
        baseStateRevision: 0,
      });

      const result = ledger.reserve({
        accountId: "bench_1",
        resourceTypeId: "bench_time",
        amount: 200,
        reservedAt: "2026-09-17T10:00:00Z",
        expiresAt: "2026-09-17T12:00:00Z",
        purpose: "experiment_2",
        sourceRefs: [makeSourceRef()],
        baseStateRevision: 0,
      });

      assert.equal(result.committed, false);
      assert.ok(result.error?.includes("exceeded"));
    });

    test("allow non-overlapping reservations", () => {
      ledger.reserve({
        accountId: "bench_1",
        resourceTypeId: "bench_time",
        amount: 240,
        reservedAt: "2026-09-17T09:00:00Z",
        expiresAt: "2026-09-17T13:00:00Z",
        purpose: "morning_experiment",
        sourceRefs: [makeSourceRef()],
        baseStateRevision: 0,
      });

      const result = ledger.reserve({
        accountId: "bench_1",
        resourceTypeId: "bench_time",
        amount: 240,
        reservedAt: "2026-09-17T14:00:00Z",
        expiresAt: "2026-09-17T18:00:00Z",
        purpose: "afternoon_experiment",
        sourceRefs: [makeSourceRef()],
        baseStateRevision: 0,
      });

      assert.equal(result.committed, true);
    });

    test("release reservation restores capacity", () => {
      const { reservationId } = ledger.reserve({
        accountId: "bench_1",
        resourceTypeId: "bench_time",
        amount: 120,
        reservedAt: "2026-09-17T09:00:00Z",
        expiresAt: "2026-09-17T11:00:00Z",
        purpose: "experiment_1",
        sourceRefs: [makeSourceRef()],
        baseStateRevision: 0,
      });

      assert.ok(reservationId);
      let account = ledger.getAccount("bench_1");
      assert.equal(account?.reserved, 120);

      const released = ledger.releaseReservation(reservationId);
      assert.equal(released, true);

      account = ledger.getAccount("bench_1");
      assert.equal(account?.reserved, 0);
    });

    test("reject reservation on non-capacity resource type", () => {
      ledger.registerResourceType({
        schema_version: "1.0",
        resource_type_id: "water",
        law: "stock",
        unit: "liter",
        version: "v1",
      });
      ledger.createAccount({
        schema_version: "1.0",
        account_id: "tank_1",
        resource_type_id: "water",
        owner_id: "lab",
        balance: 100,
        reserved: 0,
      });

      const result = ledger.reserve({
        accountId: "tank_1",
        resourceTypeId: "water",
        amount: 50,
        reservedAt: "2026-09-17T09:00:00Z",
        expiresAt: "2026-09-17T11:00:00Z",
        purpose: "hold",
        sourceRefs: [makeSourceRef()],
        baseStateRevision: 0,
      });

      assert.equal(result.committed, false);
      assert.ok(result.error?.includes("not a capacity type"));
    });
  });

  describe("Idempotency", () => {
    beforeEach(() => {
      ledger.registerResourceType({
        schema_version: "1.0",
        resource_type_id: "credits",
        law: "currency",
        unit: "credit",
        version: "v1",
      });
      ledger.createAccount({
        schema_version: "1.0",
        account_id: "acc_alice",
        resource_type_id: "credits",
        owner_id: "alice",
        balance: 100,
        reserved: 0,
      });
      ledger.createAccount({
        schema_version: "1.0",
        account_id: "acc_bob",
        resource_type_id: "credits",
        owner_id: "bob",
        balance: 50,
        reserved: 0,
      });
    });

    test("duplicate transfer returns replay result", () => {
      const idempotencyKey = "tx_001";

      const result1 = ledger.transfer({
        entries: [
          { accountId: "acc_alice", resourceTypeId: "credits", delta: -30, reason: "payment" },
          { accountId: "acc_bob", resourceTypeId: "credits", delta: 30, reason: "received" },
        ],
        sourceRefs: [makeSourceRef()],
        baseStateRevision: 0,
        idempotencyKey,
      });

      assert.equal(result1.committed, true);
      assert.equal(result1.replay, undefined);

      const result2 = ledger.transfer({
        entries: [
          { accountId: "acc_alice", resourceTypeId: "credits", delta: -30, reason: "payment" },
          { accountId: "acc_bob", resourceTypeId: "credits", delta: 30, reason: "received" },
        ],
        sourceRefs: [makeSourceRef()],
        baseStateRevision: 0,
        idempotencyKey,
      });

      assert.equal(result2.committed, true);
      assert.equal(result2.replay, true);

      const alice = ledger.getAccount("acc_alice");
      assert.equal(alice?.balance, 70);
    });

    test("duplicate reservation returns replay result", () => {
      ledger.registerResourceType({
        schema_version: "1.0",
        resource_type_id: "bench_time",
        law: "capacity",
        unit: "bench-minute",
        version: "v1",
      });
      ledger.createAccount({
        schema_version: "1.0",
        account_id: "bench_1",
        resource_type_id: "bench_time",
        owner_id: "lab",
        balance: 480,
        reserved: 0,
      });

      const idempotencyKey = "rsv_001";

      const result1 = ledger.reserve({
        accountId: "bench_1",
        resourceTypeId: "bench_time",
        amount: 120,
        reservedAt: "2026-09-17T09:00:00Z",
        expiresAt: "2026-09-17T11:00:00Z",
        purpose: "experiment_1",
        sourceRefs: [makeSourceRef()],
        baseStateRevision: 0,
        idempotencyKey,
      });

      assert.equal(result1.committed, true);
      assert.equal(result1.replay, undefined);

      const result2 = ledger.reserve({
        accountId: "bench_1",
        resourceTypeId: "bench_time",
        amount: 120,
        reservedAt: "2026-09-17T09:00:00Z",
        expiresAt: "2026-09-17T11:00:00Z",
        purpose: "experiment_1",
        sourceRefs: [makeSourceRef()],
        baseStateRevision: 0,
        idempotencyKey,
      });

      assert.equal(result2.committed, true);
      assert.equal(result2.replay, true);

      const account = ledger.getAccount("bench_1");
      assert.equal(account?.reserved, 120);
    });
  });

  describe("Source Closure Tracking", () => {
    beforeEach(() => {
      ledger.registerResourceType({
        schema_version: "1.0",
        resource_type_id: "credits",
        law: "currency",
        unit: "credit",
        version: "v1",
      });
      ledger.createAccount({
        schema_version: "1.0",
        account_id: "acc_alice",
        resource_type_id: "credits",
        owner_id: "alice",
        balance: 100,
        reserved: 0,
      });
      ledger.createAccount({
        schema_version: "1.0",
        account_id: "acc_bob",
        resource_type_id: "credits",
        owner_id: "bob",
        balance: 50,
        reserved: 0,
      });
    });

    test("ledger entries record source refs", () => {
      const sourceRefs: SourceRef[] = [
        { source_type: "event", source_id: "evt_123" },
        { source_type: "claim", source_id: "clm_456" },
      ];

      ledger.transfer({
        entries: [
          { accountId: "acc_alice", resourceTypeId: "credits", delta: -30, reason: "payment" },
          { accountId: "acc_bob", resourceTypeId: "credits", delta: 30, reason: "received" },
        ],
        sourceRefs,
        baseStateRevision: 0,
      });

      const sources = db
        .prepare(
          `SELECT source_type, source_id FROM resource_ledger_sources
           WHERE ledger_entry_id IN (SELECT ledger_entry_id FROM resource_ledger)`,
        )
        .all() as { source_type: string; source_id: string }[];

      assert.equal(sources.length, 4);
      const eventSources = sources.filter((s) => s.source_type === "event");
      const claimSources = sources.filter((s) => s.source_type === "claim");
      assert.equal(eventSources.length, 2);
      assert.equal(claimSources.length, 2);
    });
  });

  describe("Ledger History", () => {
    beforeEach(() => {
      ledger.registerResourceType({
        schema_version: "1.0",
        resource_type_id: "credits",
        law: "currency",
        unit: "credit",
        version: "v1",
      });
      ledger.createAccount({
        schema_version: "1.0",
        account_id: "acc_alice",
        resource_type_id: "credits",
        owner_id: "alice",
        balance: 100,
        reserved: 0,
      });
      ledger.createAccount({
        schema_version: "1.0",
        account_id: "acc_bob",
        resource_type_id: "credits",
        owner_id: "bob",
        balance: 50,
        reserved: 0,
      });
    });

    test("getAccountLedger returns history", () => {
      ledger.transfer({
        entries: [
          { accountId: "acc_alice", resourceTypeId: "credits", delta: -30, reason: "payment_1" },
          { accountId: "acc_bob", resourceTypeId: "credits", delta: 30, reason: "received_1" },
        ],
        sourceRefs: [makeSourceRef()],
        baseStateRevision: 0,
      });

      ledger.transfer({
        entries: [
          { accountId: "acc_alice", resourceTypeId: "credits", delta: -20, reason: "payment_2" },
          { accountId: "acc_bob", resourceTypeId: "credits", delta: 20, reason: "received_2" },
        ],
        sourceRefs: [makeSourceRef()],
        baseStateRevision: 0,
      });

      const history = ledger.getAccountLedger("acc_alice");
      assert.equal(history.length, 2);
      assert.equal(history[0].delta, -20);
      assert.equal(history[1].delta, -30);
    });
  });
});

describe("Property Tests (docs/16 WM-P*)", () => {
  let db: DatabaseSync;
  let ledger: ResourceLedger;

  beforeEach(() => {
    db = createTestDb();
    ledger = new ResourceLedger(db, {
      enforceNonNegative: true,
      enforceBalancedTransfers: true,
      ledgerVersion: "1.0",
    });

    ledger.registerResourceType({
      schema_version: "1.0",
      resource_type_id: "water",
      law: "stock",
      unit: "liter",
      min_balance: 0,
      version: "v1",
    });
    ledger.registerResourceType({
      schema_version: "1.0",
      resource_type_id: "credits",
      law: "currency",
      unit: "credit",
      version: "v1",
    });
    ledger.registerResourceType({
      schema_version: "1.0",
      resource_type_id: "bench_time",
      law: "capacity",
      unit: "minute",
      version: "v1",
    });
  });

  afterEach(() => {
    db.close();
  });

  test("WM-P01: all stock accounts never go below min_balance", () => {
    ledger.createAccount({
      schema_version: "1.0",
      account_id: "tank_1",
      resource_type_id: "water",
      owner_id: "ecology",
      balance: 100,
      reserved: 0,
    });
    ledger.createAccount({
      schema_version: "1.0",
      account_id: "tank_2",
      resource_type_id: "water",
      owner_id: "ecology",
      balance: 50,
      reserved: 0,
    });

    for (let i = 0; i < 20; i++) {
      const delta = (Math.random() - 0.3) * 30;
      ledger.transfer({
        entries: [
          { accountId: "tank_1", resourceTypeId: "water", delta: -delta, reason: `op_${i}` },
          { accountId: "tank_2", resourceTypeId: "water", delta, reason: `op_${i}` },
        ],
        sourceRefs: [makeSourceRef()],
        baseStateRevision: 0,
      });
    }

    const tank1 = ledger.getAccount("tank_1");
    const tank2 = ledger.getAccount("tank_2");
    assert.ok((tank1?.balance ?? 0) >= 0, "tank_1 balance must be non-negative");
    assert.ok((tank2?.balance ?? 0) >= 0, "tank_2 balance must be non-negative");
  });

  test("WM-P02: no external flow transfers conserve total", () => {
    ledger.createAccount({
      schema_version: "1.0",
      account_id: "acc_a",
      resource_type_id: "credits",
      owner_id: "alice",
      balance: 1000,
      reserved: 0,
    });
    ledger.createAccount({
      schema_version: "1.0",
      account_id: "acc_b",
      resource_type_id: "credits",
      owner_id: "bob",
      balance: 500,
      reserved: 0,
    });
    ledger.createAccount({
      schema_version: "1.0",
      account_id: "acc_c",
      resource_type_id: "credits",
      owner_id: "carol",
      balance: 300,
      reserved: 0,
    });

    const initialTotal = 1800;

    for (let i = 0; i < 10; i++) {
      const amount = Math.floor(Math.random() * 100);
      const accounts = ["acc_a", "acc_b", "acc_c"];
      const from = accounts[Math.floor(Math.random() * 3)];
      const to = accounts.filter((a) => a !== from)[Math.floor(Math.random() * 2)];

      ledger.transfer({
        entries: [
          { accountId: from, resourceTypeId: "credits", delta: -amount, reason: "transfer" },
          { accountId: to, resourceTypeId: "credits", delta: amount, reason: "received" },
        ],
        sourceRefs: [makeSourceRef()],
        baseStateRevision: 0,
      });
    }

    const accA = ledger.getAccount("acc_a");
    const accB = ledger.getAccount("acc_b");
    const accC = ledger.getAccount("acc_c");
    const finalTotal = (accA?.balance ?? 0) + (accB?.balance ?? 0) + (accC?.balance ?? 0);

    assert.equal(finalTotal, initialTotal, "Total must be conserved");
  });

  test("WM-P03: capacity reservations never exceed total capacity", () => {
    ledger.createAccount({
      schema_version: "1.0",
      account_id: "bench_1",
      resource_type_id: "bench_time",
      owner_id: "lab",
      balance: 480,
      reserved: 0,
    });

    const reservations: { from: string; until: string; amount: number }[] = [];

    for (let i = 0; i < 10; i++) {
      const startHour = 8 + Math.floor(Math.random() * 8);
      const durationHours = 1 + Math.floor(Math.random() * 3);
      const amount = 30 + Math.floor(Math.random() * 100);

      const result = ledger.reserve({
        accountId: "bench_1",
        resourceTypeId: "bench_time",
        amount,
        reservedAt: `2026-09-17T${startHour.toString().padStart(2, "0")}:00:00Z`,
        expiresAt: `2026-09-17T${(startHour + durationHours).toString().padStart(2, "0")}:00:00Z`,
        purpose: `reservation_${i}`,
        sourceRefs: [makeSourceRef()],
        baseStateRevision: 0,
      });

      if (result.committed) {
        reservations.push({
          from: `2026-09-17T${startHour.toString().padStart(2, "0")}:00:00Z`,
          until: `2026-09-17T${(startHour + durationHours).toString().padStart(2, "0")}:00:00Z`,
          amount,
        });
      }
    }

    for (let hour = 8; hour < 18; hour++) {
      const time = `2026-09-17T${hour.toString().padStart(2, "0")}:30:00Z`;
      const overlapping = ledger.getOverlappingReservations(
        "bench_1",
        time,
        `2026-09-17T${hour.toString().padStart(2, "0")}:31:00Z`,
      );

      const totalAtTime = overlapping.reduce((sum, r) => sum + r.amount, 0);
      assert.ok(totalAtTime <= 480, `Capacity at ${time} is ${totalAtTime} > 480`);
    }
  });

  test("WM-P07: same input produces same output (determinism)", () => {
    ledger.createAccount({
      schema_version: "1.0",
      account_id: "tank_1",
      resource_type_id: "water",
      owner_id: "ecology",
      balance: 100,
      reserved: 0,
    });
    ledger.createAccount({
      schema_version: "1.0",
      account_id: "tank_2",
      resource_type_id: "water",
      owner_id: "ecology",
      balance: 50,
      reserved: 0,
    });

    const entries: TransferEntry[] = [
      { accountId: "tank_1", resourceTypeId: "water", delta: -30, reason: "test" },
      { accountId: "tank_2", resourceTypeId: "water", delta: 30, reason: "test" },
    ];
    const sourceRefs = [makeSourceRef("evt_fixed")];

    const result1 = ledger.transfer({
      entries,
      sourceRefs,
      baseStateRevision: 0,
      idempotencyKey: "test_idem",
    });

    const result2 = ledger.transfer({
      entries,
      sourceRefs,
      baseStateRevision: 0,
      idempotencyKey: "test_idem",
    });

    assert.deepEqual(result1.ledgerEntryIds, result2.ledgerEntryIds);
    assert.equal(result2.replay, true);
  });
});
