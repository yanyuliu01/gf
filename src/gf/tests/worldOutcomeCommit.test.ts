import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupRuntime, type TestRuntime } from "./helpers.js";
import { CommitRejected } from "../state/stateManager.js";
import type { WorldOutcomeProposalV1, SourceRef } from "../generated/agentPipelineTypes.js";

const TEST_HASH = "a".repeat(64);

function makeOutcomeProposal(
  overrides: Partial<WorldOutcomeProposalV1> = {},
): WorldOutcomeProposalV1 {
  return {
    schema_version: "1.0",
    outcome_id: `out_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    action_proposal_id: "act_test",
    actor_id: "muelsyse",
    status: "accepted",
    summary: "Action accepted successfully",
    hard_constraint_classes: [],
    proposed_effects: [
      {
        effect_id: "eff_1",
        kind: "communicate",
        summary: "Message sent",
        source_refs: [{ source_type: "event", source_id: "evt_test" }],
      },
    ],
    source_refs: [{ source_type: "event", source_id: "evt_test" }],
    adjudicator_version: "world-adjudicator.v1",
    rule_version: "hard-constraints.v1",
    source_closure_hash: TEST_HASH,
    base_state_revision: 0,
    proposed_at: "2026-09-17T10:00:00.000Z",
    ...overrides,
  };
}

describe("M20-024: World Outcome Commit", () => {
  let rt: TestRuntime;

  beforeEach(() => {
    rt = setupRuntime();

    rt.db.prepare(`INSERT INTO world_events(
      event_id, schema_version, origin, kind, occurred_at, received_at,
      principal_id, trust, privacy_scope, idempotency_key, payload_json
    ) VALUES (
      'evt_test', '1.0', 'user', 'im.message.received', datetime('now'), datetime('now'),
      'doctor', 'authenticated', 'private_im', 'idem_test', '{}'
    )`).run();

    rt.db.prepare(`INSERT INTO action_proposal_audit(
      proposal_id, schema_version, actor_id, policy_run_id, intent,
      source_closure_hash, base_state_revision, payload_json, proposed_at
    ) VALUES ('act_test', '1.0', 'muelsyse', 'pol_test', 'test intent',
      '${TEST_HASH}', 0, '{}', datetime('now'))`).run();
  });

  afterEach(() => {
    rt.cleanup();
  });

  test("successful commit returns committed=true", () => {
    const proposal = makeOutcomeProposal();
    const inputSources: SourceRef[] = [
      { source_type: "event", source_id: "evt_test" },
    ];

    const result = rt.stateManager.submitWorldOutcome(proposal, { inputSources });

    assert.equal(result.committed, true);
    assert.equal(result.replay, false);
    assert.equal(result.outcomeId, proposal.outcome_id);
    assert.equal(result.baseRevision, 0);
  });

  test("duplicate outcome_id returns replay result", () => {
    const proposal = makeOutcomeProposal({ outcome_id: "out_duplicate" });
    const inputSources: SourceRef[] = [
      { source_type: "event", source_id: "evt_test" },
    ];

    const first = rt.stateManager.submitWorldOutcome(proposal, { inputSources });
    assert.equal(first.committed, true);

    const second = rt.stateManager.submitWorldOutcome(proposal, { inputSources });
    assert.equal(second.committed, false);
    assert.equal(second.replay, true);
    assert.equal(second.outcomeId, proposal.outcome_id);
  });

  test("stale base_state_revision throws CommitRejected", () => {
    const proposal = makeOutcomeProposal({ base_state_revision: 999 });
    const inputSources: SourceRef[] = [
      { source_type: "event", source_id: "evt_test" },
    ];

    assert.throws(
      () => rt.stateManager.submitWorldOutcome(proposal, { inputSources }),
      (err: Error) => {
        assert.ok(err instanceof CommitRejected);
        assert.ok(err.message.includes("stale base_state_revision"));
        return true;
      },
    );
  });

  test("source outside closure throws CommitRejected", () => {
    const proposal = makeOutcomeProposal({
      source_refs: [{ source_type: "event", source_id: "evt_unknown" }],
    });
    const inputSources: SourceRef[] = [
      { source_type: "event", source_id: "evt_test" },
    ];

    assert.throws(
      () => rt.stateManager.submitWorldOutcome(proposal, { inputSources }),
      (err: Error) => {
        assert.ok(err instanceof CommitRejected);
        assert.ok(err.message.includes("outside legal closure"));
        return true;
      },
    );
  });

  test("effect source outside closure throws CommitRejected", () => {
    const proposal = makeOutcomeProposal({
      proposed_effects: [
        {
          effect_id: "eff_bad",
          kind: "observe",
          summary: "Bad effect",
          source_refs: [{ source_type: "event", source_id: "evt_unknown" }],
        },
      ],
    });
    const inputSources: SourceRef[] = [
      { source_type: "event", source_id: "evt_test" },
    ];

    assert.throws(
      () => rt.stateManager.submitWorldOutcome(proposal, { inputSources }),
      (err: Error) => {
        assert.ok(err instanceof CommitRejected);
        assert.ok(err.message.includes("outside legal closure"));
        return true;
      },
    );
  });

  test("empty input sources throws CommitRejected", () => {
    const proposal = makeOutcomeProposal();

    assert.throws(
      () => rt.stateManager.submitWorldOutcome(proposal, { inputSources: [] }),
      (err: Error) => {
        assert.ok(err instanceof CommitRejected);
        assert.ok(err.message.includes("requires input sources"));
        return true;
      },
    );
  });

  test("missing action proposal throws CommitRejected", () => {
    const proposal = makeOutcomeProposal();
    const inputSources: SourceRef[] = [
      { source_type: "event", source_id: "evt_test" },
    ];

    assert.throws(
      () => rt.stateManager.submitWorldOutcome(proposal, {
        inputSources,
        actionProposal: { proposal_id: "act_missing" },
      }),
      (err: Error) => {
        assert.ok(err instanceof CommitRejected);
        assert.ok(err.message.includes("does not exist"));
        return true;
      },
    );
  });

  test("rejected status with constraint classes commits successfully", () => {
    const proposal = makeOutcomeProposal({
      status: "rejected",
      hard_constraint_classes: ["location", "capability"],
      proposed_effects: [],
    });
    const inputSources: SourceRef[] = [
      { source_type: "event", source_id: "evt_test" },
    ];

    const result = rt.stateManager.submitWorldOutcome(proposal, { inputSources });

    assert.equal(result.committed, true);
  });

  test("partial status with effects commits successfully", () => {
    const proposal = makeOutcomeProposal({
      status: "partial",
      hard_constraint_classes: ["time"],
      proposed_effects: [
        {
          effect_id: "eff_partial",
          kind: "move",
          summary: "Partial movement",
          source_refs: [{ source_type: "event", source_id: "evt_test" }],
        },
      ],
    });
    const inputSources: SourceRef[] = [
      { source_type: "event", source_id: "evt_test" },
    ];

    const result = rt.stateManager.submitWorldOutcome(proposal, { inputSources });

    assert.equal(result.committed, true);
    assert.equal(result.outcomeId, proposal.outcome_id);
  });

  test("outcome persisted in world_outcome_audit table", () => {
    const proposal = makeOutcomeProposal({ outcome_id: "out_persisted" });
    const inputSources: SourceRef[] = [
      { source_type: "event", source_id: "evt_test" },
    ];

    rt.stateManager.submitWorldOutcome(proposal, { inputSources });

    const row = rt.db
      .prepare("SELECT * FROM world_outcome_audit WHERE outcome_id = ?")
      .get("out_persisted") as Record<string, unknown> | undefined;

    assert.ok(row);
    assert.equal(row.outcome_id, "out_persisted");
    assert.equal(row.actor_id, "muelsyse");
    assert.equal(row.status, "accepted");
    assert.equal(row.base_state_revision, 0);
  });

  test("sources persisted in world_outcome_sources table", () => {
    const proposal = makeOutcomeProposal({
      outcome_id: "out_sources",
      source_refs: [
        { source_type: "event", source_id: "evt_test" },
      ],
    });
    const inputSources: SourceRef[] = [
      { source_type: "event", source_id: "evt_test" },
    ];

    rt.stateManager.submitWorldOutcome(proposal, { inputSources });

    const rows = rt.db
      .prepare("SELECT * FROM world_outcome_sources WHERE outcome_id = ?")
      .all("out_sources") as { source_type: string; source_id: string }[];

    assert.equal(rows.length, 1);
    assert.equal(rows[0].source_type, "event");
    assert.equal(rows[0].source_id, "evt_test");
  });

  test("derived input closure persisted", () => {
    const proposal = makeOutcomeProposal({ outcome_id: "out_closure" });
    const inputSources: SourceRef[] = [
      { source_type: "event", source_id: "evt_test" },
    ];

    rt.stateManager.submitWorldOutcome(proposal, { inputSources });

    const row = rt.db
      .prepare(
        "SELECT * FROM derived_input_closures WHERE artifact_kind = 'world_outcome' AND artifact_id = ?",
      )
      .get("out_closure") as Record<string, unknown> | undefined;

    assert.ok(row);
    assert.equal(row.artifact_kind, "world_outcome");
    assert.equal(row.closure_hash, TEST_HASH);
    assert.equal(row.base_state_revision, 0);
  });
});

describe("Replay and Idempotency", () => {
  let rt: TestRuntime;

  beforeEach(() => {
    rt = setupRuntime();

    rt.db.prepare(`INSERT INTO world_events(
      event_id, schema_version, origin, kind, occurred_at, received_at,
      principal_id, trust, privacy_scope, idempotency_key, payload_json
    ) VALUES (
      'evt_test', '1.0', 'user', 'im.message.received', datetime('now'), datetime('now'),
      'doctor', 'authenticated', 'private_im', 'idem_test', '{}'
    )`).run();

    rt.db.prepare(`INSERT INTO action_proposal_audit(
      proposal_id, schema_version, actor_id, policy_run_id, intent,
      source_closure_hash, base_state_revision, payload_json, proposed_at
    ) VALUES ('act_test', '1.0', 'muelsyse', 'pol_test', 'test intent',
      '${TEST_HASH}', 0, '{}', datetime('now'))`).run();
  });

  afterEach(() => {
    rt.cleanup();
  });

  test("identical replay returns same outcome_id", () => {
    const proposal = makeOutcomeProposal({ outcome_id: "out_replay" });
    const inputSources: SourceRef[] = [
      { source_type: "event", source_id: "evt_test" },
    ];

    const first = rt.stateManager.submitWorldOutcome(proposal, { inputSources });
    const second = rt.stateManager.submitWorldOutcome(proposal, { inputSources });

    assert.equal(first.outcomeId, second.outcomeId);
    assert.equal(first.committed, true);
    assert.equal(second.committed, false);
    assert.equal(second.replay, true);
  });

  test("same inputs produce deterministic outcome", () => {
    const proposal1 = makeOutcomeProposal({
      outcome_id: "out_det_1",
      proposed_at: "2026-09-17T10:00:00.000Z",
    });
    const proposal2 = makeOutcomeProposal({
      outcome_id: "out_det_2",
      proposed_at: "2026-09-17T10:00:00.000Z",
    });
    const inputSources: SourceRef[] = [
      { source_type: "event", source_id: "evt_test" },
    ];

    const result1 = rt.stateManager.submitWorldOutcome(proposal1, { inputSources });
    const result2 = rt.stateManager.submitWorldOutcome(proposal2, { inputSources });

    assert.equal(result1.committed, true);
    assert.equal(result2.committed, true);
    assert.equal(result1.baseRevision, result2.baseRevision);
  });
});
