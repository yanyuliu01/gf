import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CognitiveBudgetPlanner,
  CognitiveCapacityError,
  CognitiveCapacityLimiter,
  CognitiveEnergyEngine,
} from "../cognition/energy/energyEngine.js";
import type {
  CognitiveEnergyAccountV1,
  CognitiveEnergyReservationV1,
  CognitiveEnergySettlementV1,
  WakeDecisionV1,
} from "../generated/cognitiveRuntimeTypes.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const fixture = JSON.parse(
  readFileSync(
    join(ROOT, "tests", "contracts", "cognitive-runtime.valid.json"),
    "utf8",
  ),
) as Record<string, unknown>;

function contract<T>(key: string): T {
  return structuredClone(fixture[key]) as T;
}

test("recovery is deterministic, lazy, and capped around active leases", () => {
  const account = contract<CognitiveEnergyAccountV1>("cognitive_energy_account");
  const engine = new CognitiveEnergyEngine({
    version: "recovery.v2",
    baseUnitsPerHour: 10,
    protectedReplyReserveUnits: 20,
  });
  const context = {
    now: "2026-08-29T10:00:00+08:00",
    activityRecoveryFactor: 1,
    physiologyRecoveryFactor: 1,
    concurrentLoadFraction: 0,
  };
  const first = engine.proposeRecovery(account, context);
  const replay = engine.proposeRecovery(account, context);

  assert.deepEqual(first, replay);
  assert.equal(first.available, 90);
  assert.equal(first.reserved, 10);
  assert.equal(first.available + first.reserved, first.capacity);
  assert.equal(first.recovery_model_version, "recovery.v2");
});

test("planner protects replies and fails closed when mandatory work cannot fit", () => {
  const account = contract<CognitiveEnergyAccountV1>("cognitive_energy_account");
  const decision = contract<WakeDecisionV1>("wake_decision");
  const planner = new CognitiveBudgetPlanner();
  const base = {
    reservationId: "reservation_autonomous",
    promptRunId: "run_autonomous",
    purpose: "policy" as const,
    accessClass: "autonomous" as const,
    requestedNormalizedUnits: 70,
    mandatorySemanticUnits: 35,
    minimumExpressionUnits: 10,
    accountingVersion: "energy.v1",
    expiresAt: "2026-08-29T08:05:00+08:00",
    idempotencyKey: "reservation:autonomous",
  };
  const autonomous = planner.plan(decision, account, base);
  assert.equal(autonomous?.max_normalized_token_units, 60);

  const reply = planner.plan(decision, account, {
    ...base,
    reservationId: "reservation_reply",
    promptRunId: "run_reply",
    accessClass: "reply",
    idempotencyKey: "reservation:reply",
  });
  assert.equal(reply?.max_normalized_token_units, 70);

  assert.equal(
    planner.plan(decision, account, {
      ...base,
      mandatorySemanticUnits: 55,
      minimumExpressionUnits: 10,
    }),
    null,
  );
  assert.equal(
    planner.plan({ ...decision, disposition: "accumulate" }, account, base),
    null,
  );
});

test("reservation and settlement proposals conserve free plus leased energy", () => {
  const account = contract<CognitiveEnergyAccountV1>("cognitive_energy_account");
  const reservation = {
    ...contract<CognitiveEnergyReservationV1>("cognitive_energy_reservation"),
    max_normalized_token_units: 20,
  };
  const settlement = contract<CognitiveEnergySettlementV1>(
    "cognitive_energy_settlement",
  );
  const engine = new CognitiveEnergyEngine({
    version: "recovery.v2",
    baseUnitsPerHour: 10,
    protectedReplyReserveUnits: 20,
  });

  const reserved = engine.proposeReservation(account, reservation);
  assert.equal(reserved.available, 60);
  assert.equal(reserved.reserved, 30);
  assert.equal(reserved.available + reserved.reserved, 90);

  const settled = engine.proposeSettlement(reserved, settlement);
  assert.equal(settled.available, 66);
  assert.equal(settled.reserved, 10);
  assert.equal(settled.available + settled.reserved, 76);
  assert.equal(90 - (settled.available + settled.reserved), settlement.energy_spent);
});

test("capacity removes optional breadth before mandatory evidence", () => {
  const account = contract<CognitiveEnergyAccountV1>("cognitive_energy_account");
  const reservation = {
    ...contract<CognitiveEnergyReservationV1>("cognitive_energy_reservation"),
    max_normalized_token_units: 50,
  };
  const mandatorySources = [
    { source_type: "message" as const, source_id: "msg_current" },
    { source_type: "event" as const, source_id: "evt_counter" },
    { source_type: "message" as const, source_id: "msg_current" },
  ];
  const limiter = new CognitiveCapacityLimiter();
  const context = {
    mandatorySemanticUnits: 30,
    requestedOptionalSemanticUnits: 40,
    requestedDeliberationUnits: 20,
    minimumExpressionUnits: 10,
    requestedExtraExpressionUnits: 10,
    requestedToolRounds: 4,
    deliberationUnitsPerToolRound: 5,
  };
  const envelope = limiter.limit(account, reservation, mandatorySources, context);
  const replay = limiter.limit(account, reservation, mandatorySources, context);

  assert.deepEqual(envelope, replay);
  assert.equal(envelope.visibility, "engine_only");
  assert.equal(envelope.max_semantic_input_units, 30);
  assert.equal(envelope.max_deliberation_units, 0);
  assert.equal(envelope.max_expression_units, 20);
  assert.equal(envelope.max_tool_rounds, 0);
  assert.equal(envelope.mandatory_source_refs.length, 2);
  assert.equal(
    envelope.max_semantic_input_units +
      envelope.max_deliberation_units +
      envelope.max_expression_units,
    50,
  );
  assert.equal(
    /fatigue|suggested_behavior|provider|price/i.test(JSON.stringify(envelope)),
    false,
  );
});

test("capacity refuses to drop mandatory closure or minimum expression", () => {
  const account = contract<CognitiveEnergyAccountV1>("cognitive_energy_account");
  const reservation = {
    ...contract<CognitiveEnergyReservationV1>("cognitive_energy_reservation"),
    max_normalized_token_units: 39,
  };
  const limiter = new CognitiveCapacityLimiter();
  assert.throws(
    () =>
      limiter.limit(
        account,
        reservation,
        [{ source_type: "message", source_id: "msg_current" }],
        {
          mandatorySemanticUnits: 30,
          requestedOptionalSemanticUnits: 0,
          requestedDeliberationUnits: 0,
          minimumExpressionUnits: 10,
          requestedExtraExpressionUnits: 0,
          requestedToolRounds: 0,
          deliberationUnitsPerToolRound: 5,
        },
      ),
    CognitiveCapacityError,
  );
});
