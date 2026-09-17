/**
 * M21-001: Commitment/Schedule Driver Tests.
 *
 * Tests for:
 * - Converting accepted obligations into production demand
 * - Emitting conflict, overdue, fulfilled, broken, and released events
 * - Stable idempotency for all event emissions
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  CommitmentDriver,
  type CommitmentLedgerEntry,
  type EvaluationContext,
  type FulfillmentEvidence,
  type ReleaseEvidence,
  type BrokenEvidence,
} from "../world/commitmentDriver.js";
import { newId } from "../domain/ids.js";

function makeDriverConfig() {
  return {
    driverVersion: "test.v1",
    idempotencyWindow: 3600000,
  };
}

function makeContext(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    currentTime: "2026-09-17T12:00:00Z",
    baseStateRevision: 1,
    processCompletions: new Map(),
    capacityAvailability: new Map(),
    ...overrides,
  };
}

function makeLedgerEntry(overrides: Partial<CommitmentLedgerEntry> = {}): CommitmentLedgerEntry {
  return {
    entryId: newId("entry"),
    commitmentId: newId("cmt"),
    subjectId: "muelsyse",
    objectId: "researcher_1",
    content: "Review the S-4 observation report",
    condition: null,
    dueAt: null,
    createdAt: "2026-09-17T08:00:00Z",
    sourceRefs: [{ source_type: "event", source_id: newId("evt") }],
    ...overrides,
  };
}

describe("CommitmentDriver", () => {
  test("initializes with empty state", () => {
    const driver = new CommitmentDriver(makeDriverConfig());
    const state = driver.getState();

    assert.equal(state.ledgerEntries.size, 0);
    assert.equal(state.fulfillments.size, 0);
    assert.equal(state.releases.size, 0);
    assert.equal(state.broken.size, 0);
    assert.equal(state.revision, 0);
  });

  test("records commitment entries", () => {
    const driver = new CommitmentDriver(makeDriverConfig());
    const entry = makeLedgerEntry();

    driver.recordCommitment(entry);

    const state = driver.getState();
    assert.equal(state.ledgerEntries.size, 1);
    assert.ok(state.ledgerEntries.has(entry.commitmentId));
  });

  test("idempotent commitment recording", () => {
    const driver = new CommitmentDriver(makeDriverConfig());
    const entry = makeLedgerEntry();

    driver.recordCommitment(entry);
    const revisionAfterFirst = driver.getState().revision;

    driver.recordCommitment(entry);
    const revisionAfterSecond = driver.getState().revision;

    assert.equal(revisionAfterFirst, revisionAfterSecond);
  });
});

describe("Overdue Detection", () => {
  test("detects overdue commitments", () => {
    const driver = new CommitmentDriver(makeDriverConfig());
    const entry = makeLedgerEntry({
      dueAt: "2026-09-17T10:00:00Z",
    });

    driver.recordCommitment(entry);

    const context = makeContext({ currentTime: "2026-09-17T12:00:00Z" });
    const result = driver.evaluate(context);

    const overdueEvents = result.events.filter((e) => e.eventKind === "overdue");
    assert.equal(overdueEvents.length, 1);
    assert.deepEqual(overdueEvents[0].commitmentIds, [entry.commitmentId]);
  });

  test("does not flag future commitments as overdue", () => {
    const driver = new CommitmentDriver(makeDriverConfig());
    const entry = makeLedgerEntry({
      dueAt: "2026-09-18T10:00:00Z",
    });

    driver.recordCommitment(entry);

    const context = makeContext({ currentTime: "2026-09-17T12:00:00Z" });
    const result = driver.evaluate(context);

    const overdueEvents = result.events.filter((e) => e.eventKind === "overdue");
    assert.equal(overdueEvents.length, 0);
  });

  test("overdue detection is idempotent", () => {
    const driver = new CommitmentDriver(makeDriverConfig());
    const entry = makeLedgerEntry({
      dueAt: "2026-09-17T10:00:00Z",
    });

    driver.recordCommitment(entry);

    const context = makeContext({ currentTime: "2026-09-17T12:00:00Z" });

    const result1 = driver.evaluate(context);
    const result2 = driver.evaluate(context);

    assert.equal(result1.events.length, 1);
    assert.equal(result2.events.length, 0);
  });
});

describe("Fulfillment Detection", () => {
  test("detects fulfilled commitments", () => {
    const driver = new CommitmentDriver(makeDriverConfig());
    const entry = makeLedgerEntry({
      condition: "deliver:observation_data:1",
    });

    driver.recordCommitment(entry);

    const completions = new Map([
      [
        "proc_1",
        {
          outputTypeId: "observation_data",
          amount: 1,
          completedAt: "2026-09-17T11:00:00Z",
        },
      ],
    ]);

    const context = makeContext({ processCompletions: completions });
    const result = driver.evaluate(context);

    const fulfilledEvents = result.events.filter((e) => e.eventKind === "fulfilled");
    assert.equal(fulfilledEvents.length, 1);
    assert.deepEqual(fulfilledEvents[0].commitmentIds, [entry.commitmentId]);
  });

  test("does not fulfill when condition not met", () => {
    const driver = new CommitmentDriver(makeDriverConfig());
    const entry = makeLedgerEntry({
      condition: "deliver:observation_data:5",
    });

    driver.recordCommitment(entry);

    const completions = new Map([
      [
        "proc_1",
        {
          outputTypeId: "observation_data",
          amount: 2,
          completedAt: "2026-09-17T11:00:00Z",
        },
      ],
    ]);

    const context = makeContext({ processCompletions: completions });
    const result = driver.evaluate(context);

    const fulfilledEvents = result.events.filter((e) => e.eventKind === "fulfilled");
    assert.equal(fulfilledEvents.length, 0);
  });

  test("fulfillment detection is idempotent", () => {
    const driver = new CommitmentDriver(makeDriverConfig());
    const entry = makeLedgerEntry({
      condition: "deliver:observation_data:1",
    });

    driver.recordCommitment(entry);

    const completions = new Map([
      [
        "proc_1",
        {
          outputTypeId: "observation_data",
          amount: 1,
          completedAt: "2026-09-17T11:00:00Z",
        },
      ],
    ]);

    const context = makeContext({ processCompletions: completions });

    const result1 = driver.evaluate(context);
    const result2 = driver.evaluate(context);

    assert.equal(result1.events.length, 1);
    assert.equal(result2.events.length, 0);
  });
});

describe("Release and Broken", () => {
  test("records release evidence", () => {
    const driver = new CommitmentDriver(makeDriverConfig());
    const entry = makeLedgerEntry();

    driver.recordCommitment(entry);

    const release: ReleaseEvidence = {
      commitmentId: entry.commitmentId,
      releasedBy: "researcher_1",
      eventRefs: [{ source_type: "event", source_id: newId("evt") }],
      releasedAt: "2026-09-17T11:00:00Z",
    };

    driver.recordRelease(release);

    const state = driver.getState();
    assert.ok(state.releases.has(entry.commitmentId));
  });

  test("released commitments are not evaluated", () => {
    const driver = new CommitmentDriver(makeDriverConfig());
    const entry = makeLedgerEntry({
      dueAt: "2026-09-17T10:00:00Z",
    });

    driver.recordCommitment(entry);

    const release: ReleaseEvidence = {
      commitmentId: entry.commitmentId,
      releasedBy: "researcher_1",
      eventRefs: [{ source_type: "event", source_id: newId("evt") }],
      releasedAt: "2026-09-17T09:00:00Z",
    };

    driver.recordRelease(release);

    const context = makeContext({ currentTime: "2026-09-17T12:00:00Z" });
    const result = driver.evaluate(context);

    assert.equal(result.events.length, 0);
  });

  test("records broken evidence", () => {
    const driver = new CommitmentDriver(makeDriverConfig());
    const entry = makeLedgerEntry();

    driver.recordCommitment(entry);

    const broken: BrokenEvidence = {
      commitmentId: entry.commitmentId,
      reason: "Resource unavailable",
      eventRefs: [{ source_type: "event", source_id: newId("evt") }],
      brokenAt: "2026-09-17T11:00:00Z",
    };

    driver.recordBroken(broken);

    const state = driver.getState();
    assert.ok(state.broken.has(entry.commitmentId));
  });
});

describe("Production Demand Generation", () => {
  test("generates demand from unfulfilled conditions", () => {
    const driver = new CommitmentDriver(makeDriverConfig());
    const entry = makeLedgerEntry({
      condition: "deliver:observation_data:3",
      dueAt: "2026-09-18T12:00:00Z",
    });

    driver.recordCommitment(entry);

    const completions = new Map([
      [
        "proc_1",
        {
          outputTypeId: "observation_data",
          amount: 1,
          completedAt: "2026-09-17T11:00:00Z",
        },
      ],
    ]);

    const context = makeContext({ processCompletions: completions });
    const result = driver.evaluate(context);

    assert.equal(result.demands.length, 1);
    assert.equal(result.demands[0].requiredOutputTypeId, "observation_data");
    assert.equal(result.demands[0].requiredAmount, 2);
  });

  test("no demand when condition is satisfied", () => {
    const driver = new CommitmentDriver(makeDriverConfig());
    const entry = makeLedgerEntry({
      condition: "deliver:observation_data:1",
    });

    driver.recordCommitment(entry);

    const completions = new Map([
      [
        "proc_1",
        {
          outputTypeId: "observation_data",
          amount: 1,
          completedAt: "2026-09-17T11:00:00Z",
        },
      ],
    ]);

    const context = makeContext({ processCompletions: completions });
    const result = driver.evaluate(context);

    assert.equal(result.demands.length, 0);
  });

  test("priority increases as due date approaches", () => {
    const driver = new CommitmentDriver(makeDriverConfig());

    const farEntry = makeLedgerEntry({
      commitmentId: "cmt_far",
      condition: "deliver:data_a:1",
      dueAt: "2026-09-24T12:00:00Z",
    });

    const nearEntry = makeLedgerEntry({
      commitmentId: "cmt_near",
      condition: "deliver:data_b:1",
      dueAt: "2026-09-17T14:00:00Z",
    });

    driver.recordCommitment(farEntry);
    driver.recordCommitment(nearEntry);

    const context = makeContext({ currentTime: "2026-09-17T12:00:00Z" });
    const result = driver.evaluate(context);

    const farDemand = result.demands.find((d) => d.commitmentId === "cmt_far");
    const nearDemand = result.demands.find((d) => d.commitmentId === "cmt_near");

    assert.ok(farDemand && nearDemand);
    assert.ok(nearDemand.priority > farDemand.priority);
  });
});

describe("Conflict Detection", () => {
  test("detects capacity conflicts", () => {
    const driver = new CommitmentDriver(makeDriverConfig());

    const entry1 = makeLedgerEntry({
      commitmentId: "cmt_1",
      condition: "deliver:device_time:100",
      dueAt: "2026-09-18T12:00:00Z",
    });

    const entry2 = makeLedgerEntry({
      commitmentId: "cmt_2",
      condition: "deliver:device_time:100",
      dueAt: "2026-09-18T12:00:00Z",
    });

    driver.recordCommitment(entry1);
    driver.recordCommitment(entry2);

    const availability = new Map([["device_time", { available: 150, reserved: 0 }]]);

    const context = makeContext({ capacityAvailability: availability });
    const result = driver.evaluate(context);

    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0].totalDemand, 200);
    assert.equal(result.conflicts[0].availableCapacity, 150);

    const conflictEvents = result.events.filter((e) => e.eventKind === "conflict");
    assert.equal(conflictEvents.length, 1);
  });

  test("no conflict when capacity is sufficient", () => {
    const driver = new CommitmentDriver(makeDriverConfig());

    const entry1 = makeLedgerEntry({
      commitmentId: "cmt_1",
      condition: "deliver:device_time:50",
      dueAt: "2026-09-18T12:00:00Z",
    });

    const entry2 = makeLedgerEntry({
      commitmentId: "cmt_2",
      condition: "deliver:device_time:50",
      dueAt: "2026-09-18T12:00:00Z",
    });

    driver.recordCommitment(entry1);
    driver.recordCommitment(entry2);

    const availability = new Map([["device_time", { available: 150, reserved: 0 }]]);

    const context = makeContext({ capacityAvailability: availability });
    const result = driver.evaluate(context);

    assert.equal(result.conflicts.length, 0);
  });
});

describe("Commitment Projection", () => {
  test("projects active commitment", () => {
    const driver = new CommitmentDriver(makeDriverConfig());
    const entry = makeLedgerEntry();

    driver.recordCommitment(entry);

    const context = makeContext();
    const projection = driver.projectCommitment(entry, context);

    assert.equal(projection.schema_version, "1.0");
    assert.equal(projection.commitment_id, entry.commitmentId);
    assert.equal(projection.status, "active");
    assert.equal(projection.derived_from_ledger, true);
    assert.equal(projection.projection_scope, "adjudication_audit_only");
  });

  test("projects fulfilled commitment", () => {
    const driver = new CommitmentDriver(makeDriverConfig());
    const entry = makeLedgerEntry();

    driver.recordCommitment(entry);

    const fulfillment: FulfillmentEvidence = {
      commitmentId: entry.commitmentId,
      eventRefs: [{ source_type: "event", source_id: newId("evt") }],
      fulfilledAt: "2026-09-17T11:00:00Z",
    };

    driver.recordFulfillment(fulfillment);

    const context = makeContext();
    const projection = driver.projectCommitment(entry, context);

    assert.equal(projection.status, "fulfilled");
    assert.equal(projection.fulfillment_event_refs.length, 1);
  });

  test("projects broken commitment when overdue", () => {
    const driver = new CommitmentDriver(makeDriverConfig());
    const entry = makeLedgerEntry({
      dueAt: "2026-09-17T10:00:00Z",
    });

    driver.recordCommitment(entry);

    const context = makeContext({ currentTime: "2026-09-17T12:00:00Z" });
    const projection = driver.projectCommitment(entry, context);

    assert.equal(projection.status, "broken");
    assert.ok(projection.broken_event_refs.length > 0);
  });

  test("projects released commitment", () => {
    const driver = new CommitmentDriver(makeDriverConfig());
    const entry = makeLedgerEntry();

    driver.recordCommitment(entry);

    const release: ReleaseEvidence = {
      commitmentId: entry.commitmentId,
      releasedBy: "researcher_1",
      eventRefs: [{ source_type: "event", source_id: newId("evt") }],
      releasedAt: "2026-09-17T11:00:00Z",
    };

    driver.recordRelease(release);

    const context = makeContext();
    const projection = driver.projectCommitment(entry, context);

    assert.equal(projection.status, "released");
    assert.equal(projection.released_event_refs.length, 1);
  });
});
