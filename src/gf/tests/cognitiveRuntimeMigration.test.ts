import assert from "node:assert/strict";
import test from "node:test";

import { setupRuntime } from "./helpers.js";

test("migration 003 adds cognitive runtime tables outside WorldEvent", () => {
  const rt = setupRuntime();
  try {
    const latest = rt.db
      .prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1")
      .get() as { version: string };
    assert.equal(latest.version, "003");
    const names = new Set(
      (rt.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[]).map((row) => row.name),
    );
    for (const name of [
      "attention_intents",
      "attention_subscription_records",
      "cognitive_energy_accounts",
      "cognitive_energy_reservations",
      "inference_usage_receipts",
      "experienced_usage_breakdowns",
      "cognitive_energy_settlements",
      "wake_candidates",
      "wake_decision_audit",
      "salience_accumulations",
      "cognitive_episode_evidence",
      "subjective_experience_records",
    ]) {
      assert.ok(names.has(name), name);
    }
  } finally {
    rt.cleanup();
  }
});

test("non-wake audit and hidden energy constraints fail closed", () => {
  const rt = setupRuntime();
  try {
    const account = rt.db.prepare(`
      INSERT INTO cognitive_energy_accounts(
        actor_id, schema_version, available, reserved, capacity,
        protected_reply_reserve, recovered_at, recovery_model_version, revision
      ) VALUES (?, '1.0', ?, ?, ?, ?, '2026-08-29T10:00:00Z', 'recovery.v1', 0)
    `);
    assert.throws(() => account.run("bad", 90, 20, 100, 10));
    account.run("terra", 80, 10, 100, 20);

    rt.db.prepare(`
      INSERT INTO wake_candidates(
        candidate_id, schema_version, actor_id, committed_revision,
        boundary_kind, input_closure_hash, payload_json, occurred_at
      ) VALUES ('candidate_1', '1.0', 'terra', 0, 'observable_change', ?, '{}',
                '2026-08-29T10:00:01Z')
    `).run("9".repeat(64));
    const decision = rt.db.prepare(`
      INSERT INTO wake_decision_audit(
        decision_id, schema_version, candidate_id, actor_id, disposition, wake,
        queue_lane, reason_codes_json, matched_rule_ids_json, gate_version,
        parameter_version, affect_mode, affect_contributed, base_state_revision,
        input_closure_hash, payload_json, decided_at
      ) VALUES (?, '1.0', 'candidate_1', 'terra', ?, ?, 'none',
                '["no_material_change"]', '[]', 'gate.v1', 'params.v1', ?, ?, 0,
                ?, '{}', '2026-08-29T10:00:02Z')
    `);
    assert.throws(() =>
      decision.run("bad_wake", "ignore", 1, "off", 0, "9".repeat(64)),
    );
    assert.throws(() =>
      decision.run("bad_shadow", "ignore", 0, "shadow", 1, "9".repeat(64)),
    );
    decision.run("nonwake_1", "ignore", 0, "shadow", 0, "9".repeat(64));
    const stored = rt.db
      .prepare("SELECT disposition, wake FROM wake_decision_audit")
      .get() as { disposition: string; wake: number };
    assert.equal(stored.disposition, "ignore");
    assert.equal(stored.wake, 0);

    const episodeColumns = (
      rt.db.prepare("PRAGMA table_info(cognitive_episode_evidence)").all() as {
        name: string;
      }[]
    ).map((row) => row.name);
    assert.equal(
      episodeColumns.some((name) =>
        /energy|token|provider|price|fatigue/i.test(name),
      ),
      false,
    );
  } finally {
    rt.cleanup();
  }
});
