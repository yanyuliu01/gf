import assert from "node:assert/strict";
import test from "node:test";

import {
  CognitiveCapacityLimiter,
  CognitiveEnergyEngine,
  VersionedUsageSettlement,
} from "../cognition/energy/energyEngine.js";
import { CognitiveCallLifecycle } from "../cognition/lifecycle/cognitiveCallLifecycle.js";
import type {
  CognitiveEnergyAccountV1,
  CognitiveEnergyReservationV1,
  InferenceUsageReceiptV1,
} from "../generated/cognitiveRuntimeTypes.js";
import {
  VersionedUsageClassifier,
  type UsageClassificationContextV1,
} from "../inference/usage/usageAccounting.js";
import { connect } from "../state/db.js";
import { computeInputClosureHash } from "../validation/derivedInputClosure.js";
import { setupRuntime, userEvent, type TestRuntime } from "./helpers.js";

const AT = "2026-09-02T12:00:00.000Z";
const DONE_AT = "2026-09-02T12:00:01.000Z";

function seedAdmission(rt: TestRuntime, suffix: string): {
  source: { source_type: "event"; source_id: string };
  account: CognitiveEnergyAccountV1;
} {
  const eventId = `evt_call_${suffix}`;
  rt.stateManager.ingestEvent(userEvent("继续观察。", {
    event_id: eventId,
    idempotency_key: `call-source-${suffix}`,
  }));
  const account: CognitiveEnergyAccountV1 = {
    schema_version: "1.0",
    actor_id: "terra",
    available: 100,
    reserved: 0,
    capacity: 100,
    protected_reply_reserve: 20,
    recovered_at: AT,
    recovery_model_version: "recovery.v1",
    revision: 0,
  };
  rt.db.prepare(`
    INSERT INTO cognitive_energy_accounts(
      actor_id, schema_version, available, reserved, capacity,
      protected_reply_reserve, recovered_at, recovery_model_version, revision
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    account.actor_id,
    account.schema_version,
    account.available,
    account.reserved,
    account.capacity,
    account.protected_reply_reserve,
    account.recovered_at,
    account.recovery_model_version,
    account.revision,
  );
  const closureHash = computeInputClosureHash(0, [{
    source_type: "event",
    source_id: eventId,
  }]);
  rt.db.prepare(`
    INSERT INTO wake_candidates(
      candidate_id, schema_version, actor_id, committed_revision,
      boundary_kind, input_closure_hash, payload_json, occurred_at
    ) VALUES (?, '1.0', 'terra', 0, 'observable_change', ?, '{}', ?)
  `).run(`candidate_${suffix}`, closureHash, AT);
  rt.db.prepare(`
    INSERT INTO wake_decision_audit(
      decision_id, schema_version, candidate_id, actor_id, disposition, wake,
      queue_lane, reason_codes_json, matched_rule_ids_json, gate_version,
      parameter_version, affect_mode, affect_contributed, base_state_revision,
      input_closure_hash, payload_json, decided_at
    ) VALUES (?, '1.0', ?, 'terra', 'wake', 1, 'reply',
              '["observable_change"]', '[]', 'gate.v1', 'params.v1',
              'off', 0, 0, ?, '{}', ?)
  `).run(`decision_${suffix}`, `candidate_${suffix}`, closureHash, AT);
  return {
    source: { source_type: "event", source_id: eventId },
    account,
  };
}

function makeRuntimeParts() {
  const energy = new CognitiveEnergyEngine({
    version: "recovery.v1",
    baseUnitsPerHour: 10,
    protectedReplyReserveUnits: 20,
  });
  return {
    energy,
    classifier: new VersionedUsageClassifier(),
    settlement: new VersionedUsageSettlement(),
    limiter: new CognitiveCapacityLimiter(),
  };
}

test("call lifecycle reserves before an unlocked model await and settles accepted usage", async () => {
  const rt = setupRuntime();
  try {
    const { source, account } = seedAdmission(rt, "success");
    const parts = makeRuntimeParts();
    const reservation: CognitiveEnergyReservationV1 = {
      schema_version: "1.0",
      reservation_id: "reservation_success",
      actor_id: "terra",
      wake_decision_id: "decision_success",
      prompt_run_id: "run_call_success",
      purpose: "surface",
      max_normalized_token_units: 50,
      access_class: "reply",
      base_state_revision: 0,
      accounting_version: "cognitive_energy.v1",
      expires_at: "2026-09-02T12:05:00.000Z",
      idempotency_key: "reservation:success",
    };
    const reservedAccount = parts.energy.proposeReservation(account, reservation);
    const envelope = parts.limiter.limit(account, reservation, [source], {
      mandatorySemanticUnits: 10,
      requestedOptionalSemanticUnits: 10,
      requestedDeliberationUnits: 10,
      minimumExpressionUnits: 5,
      requestedExtraExpressionUnits: 15,
      requestedToolRounds: 0,
      deliberationUnitsPerToolRound: 1,
    });
    const closureHash = computeInputClosureHash(0, [source]);
    const classification: UsageClassificationContextV1 = {
      attemptClass: "accepted_semantic",
      inputClosureHash: closureHash,
      inputSegments: [
        {
          segmentId: "segment_semantic",
          purpose: "current_message",
          weight: 3,
          sourceRefs: [source],
        },
        {
          segmentId: "segment_runtime",
          purpose: "runtime_overhead",
          weight: 1,
          sourceRefs: [],
        },
      ],
      outputPurpose: "expression",
    };
    const lifecycle = new CognitiveCallLifecycle(
      rt.stateManager,
      parts.energy,
      parts.classifier,
      parts.settlement,
    );
    let sawEnvelope = false;
    const receipt: InferenceUsageReceiptV1 = {
      schema_version: "1.0",
      receipt_id: "usage_call_success",
      prompt_run_id: reservation.prompt_run_id,
      provider_request_id: "provider:success",
      model_id: "deepseek-v4-flash",
      tokenizer_version: "deepseek.responses.usage.v1",
      input_tokens: 20,
      cached_input_tokens: 15,
      output_tokens: 10,
      reasoning_tokens: 5,
      attempt_ordinal: 1,
      completion_status: "completed",
      usage_source: "provider",
      received_at: DONE_AT,
    };
    const result = await lifecycle.execute({
      reservation,
      reservedAccount,
      capacityEnvelope: envelope,
      promptRunStarted: {
        runId: reservation.prompt_run_id,
        promptName: "fast_reply",
        promptVersion: "fast_reply.v0.2",
        promptManifestHash: "a".repeat(64),
        inputHash: "b".repeat(64),
        modelId: "deepseek-v4-flash",
        startedAt: AT,
      },
      baseStateRevision: 0,
      inputSources: [source],
      classificationContext: classification,
      settlementContext: {
        accountingVersion: "cognitive_energy.v1",
        settledAt: DONE_AT,
        normalization: {
          version: "deepseek-calibration.v1",
          modelId: "deepseek-v4-flash",
          tokenizerVersion: "deepseek.responses.usage.v1",
          semanticInputWeight: 1,
          deliberationWeight: 1,
          expressionWeight: 1,
        },
      },
      failureFinishedAt: DONE_AT,
      run: async (capacity) => {
        sawEnvelope = capacity.visibility === "engine_only"
          && capacity.reservation_id === reservation.reservation_id;
        const concurrent = connect(rt.dbPath);
        try {
          assert.doesNotThrow(() => {
            concurrent.exec("BEGIN IMMEDIATE");
            concurrent.exec("ROLLBACK");
          });
        } finally {
          concurrent.close();
        }
        return {
          value: { bubbles: ["看到了。"] },
          receipt,
          promptRunFinished: {
            runId: reservation.prompt_run_id,
            status: "validated",
            outputHash: "c".repeat(64),
            finishedAt: DONE_AT,
          },
          capacityApplication: {
            semanticInput: "applied",
            expression: "applied",
            deliberation: "unsupported_explicit",
            toolRounds: "applied",
          },
        };
      },
    });
    assert.equal(sawEnvelope, true);
    assert.equal(result.settlement.normalized_token_units, 25);
    assert.equal(result.settlement.released_reservation, 25);
    assert.deepEqual(result.account, {
      ...account,
      available: 75,
      reserved: 0,
      revision: 2,
    });
    const lease = rt.db.prepare(
      "SELECT status FROM cognitive_energy_reservations",
    ).get() as { status: string };
    assert.equal(lease.status, "settled");
    const prompt = rt.db.prepare(
      "SELECT status FROM prompt_runs WHERE run_id = ?",
    ).get(reservation.prompt_run_id) as { status: string };
    assert.equal(prompt.status, "validated");
    const settlementReplay = rt.stateManager.settleCognitiveCall(
      result.settlement,
      result.account,
    );
    assert.equal(settlementReplay.committed, false);
    assert.equal(settlementReplay.replay, true);
    assert.equal(result.account.available + result.account.reserved, 75);
  } finally {
    rt.cleanup();
  }
});

test("failed model execution releases the full lease and closes prompt audit", async () => {
  const rt = setupRuntime();
  try {
    const { source, account } = seedAdmission(rt, "failure");
    const parts = makeRuntimeParts();
    const reservation: CognitiveEnergyReservationV1 = {
      schema_version: "1.0",
      reservation_id: "reservation_failure",
      actor_id: "terra",
      wake_decision_id: "decision_failure",
      prompt_run_id: "run_call_failure",
      purpose: "policy",
      max_normalized_token_units: 40,
      access_class: "autonomous",
      base_state_revision: 0,
      accounting_version: "cognitive_energy.v1",
      expires_at: "2026-09-02T12:05:00.000Z",
      idempotency_key: "reservation:failure",
    };
    const reservedAccount = parts.energy.proposeReservation(account, reservation);
    const envelope = parts.limiter.limit(account, reservation, [source], {
      mandatorySemanticUnits: 10,
      requestedOptionalSemanticUnits: 10,
      requestedDeliberationUnits: 10,
      minimumExpressionUnits: 5,
      requestedExtraExpressionUnits: 5,
      requestedToolRounds: 0,
      deliberationUnitsPerToolRound: 1,
    });
    const lifecycle = new CognitiveCallLifecycle(
      rt.stateManager,
      parts.energy,
      parts.classifier,
      parts.settlement,
    );
    await assert.rejects(
      lifecycle.execute({
        reservation,
        reservedAccount,
        capacityEnvelope: envelope,
        promptRunStarted: {
          runId: reservation.prompt_run_id,
          promptName: "tick",
          promptVersion: "tick.v0.3",
          promptManifestHash: "a".repeat(64),
          inputHash: "b".repeat(64),
          modelId: "deepseek-v4-flash",
          startedAt: AT,
        },
        baseStateRevision: 0,
        inputSources: [source],
        classificationContext: {
          attemptClass: "accepted_semantic",
          inputClosureHash: computeInputClosureHash(0, [source]),
          inputSegments: [],
          outputPurpose: "deliberation",
        },
        settlementContext: {
          accountingVersion: "cognitive_energy.v1",
          settledAt: DONE_AT,
          normalization: {
            version: "deepseek-calibration.v1",
            modelId: "deepseek-v4-flash",
            tokenizerVersion: "deepseek.responses.usage.v1",
            semanticInputWeight: 1,
            deliberationWeight: 1,
            expressionWeight: 1,
          },
        },
        failureFinishedAt: DONE_AT,
        run: async () => {
          throw new Error("synthetic provider failure");
        },
      }),
      /synthetic provider failure/,
    );
    assert.deepEqual(rt.stateManager.getCognitiveEnergyAccount("terra"), {
      ...account,
      revision: 2,
    });
    const lease = rt.db.prepare(
      "SELECT status FROM cognitive_energy_reservations",
    ).get() as { status: string };
    assert.equal(lease.status, "released");
    const prompt = rt.db.prepare(
      "SELECT status, error_code FROM prompt_runs",
    ).get() as { status: string; error_code: string };
    assert.equal(prompt.status, "failed");
    assert.equal(prompt.error_code, "cognitive_call_failed");
  } finally {
    rt.cleanup();
  }
});
