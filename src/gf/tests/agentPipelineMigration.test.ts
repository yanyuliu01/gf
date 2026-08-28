import assert from "node:assert/strict";
import test from "node:test";

import { setupRuntime } from "./helpers.js";

test("migration 002 adds derived pipeline persistence without world-event tables", () => {
  const rt = setupRuntime();
  try {
    const version = rt.db
      .prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1")
      .get() as { version: string };
    assert.equal(version.version, "002");

    const names = new Set(
      (rt.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[]).map((row) => row.name),
    );
    for (const name of [
      "observations",
      "belief_proposals",
      "open_loop_records",
      "commitment_projections",
      "action_proposal_audit",
      "world_outcome_audit",
      "derived_input_closures",
    ]) {
      assert.ok(names.has(name), name);
    }
  } finally {
    rt.cleanup();
  }
});

test("pipeline audit tables fail closed on unsupported terminal claims", () => {
  const rt = setupRuntime();
  try {
    const commitment = rt.db.prepare(`
      INSERT INTO commitment_projections(
        projection_id, commitment_id, schema_version, subject_id, object_id,
        content, status, fulfillment_event_refs_json, broken_event_refs_json,
        released_event_refs_json, derived_from_ledger, projection_scope,
        projection_version, base_state_revision, input_closure_hash,
        payload_json, derived_at
      ) VALUES (?, ?, '1.0', 'terra', 'veyl', 'send result', ?, ?, '[]', '[]',
                1, 'adjudication_audit_only', 'commitment_projection.v1', 0,
                ?, '{}', '2026-08-29T09:00:00Z')
    `);
    assert.throws(() =>
      commitment.run(
        "projection_invalid",
        "commitment_invalid",
        "fulfilled",
        "[]",
        "5".repeat(64),
      ),
    );
    commitment.run(
      "projection_active",
      "commitment_active",
      "active",
      "[]",
      "5".repeat(64),
    );

    rt.db.prepare(`
      INSERT INTO action_proposal_audit(
        proposal_id, schema_version, actor_id, policy_run_id, intent,
        source_closure_hash, base_state_revision, payload_json, proposed_at
      ) VALUES ('action_1', '1.0', 'terra', 'run_1', 'inspect S-4', ?, 0, '{}',
                '2026-08-29T09:00:01Z')
    `).run("6".repeat(64));

    const outcome = rt.db.prepare(`
      INSERT INTO world_outcome_audit(
        outcome_id, schema_version, action_proposal_id, actor_id, status,
        summary, hard_constraint_classes_json, proposed_effects_json,
        adjudicator_version, rule_version, source_closure_hash,
        base_state_revision, payload_json, proposed_at
      ) VALUES (?, '1.0', 'action_1', 'terra', ?, 'result', ?, ?,
                'adjudicator.v1', 'rules.v1', ?, 0, '{}',
                '2026-08-29T09:00:02Z')
    `);
    assert.throws(() =>
      outcome.run("outcome_invalid", "accepted", "[]", "[]", "7".repeat(64)),
    );
    outcome.run(
      "outcome_1",
      "accepted",
      "[]",
      '[{"effect_id":"effect_1"}]',
      "7".repeat(64),
    );
    assert.throws(() =>
      rt.db.prepare(
        "UPDATE world_outcome_audit SET summary = 'mutated' WHERE outcome_id = 'outcome_1'",
      ).run(),
    );
  } finally {
    rt.cleanup();
  }
});
