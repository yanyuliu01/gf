import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type {
  AttentionIntentV1,
  AttentionSubscriptionV1,
  CognitiveCapacityEnvelopeV2,
  CognitiveEnergyAccountV1,
  CognitiveEnergyReservationV1,
  CognitiveEnergySettlementV1,
  ExperiencedUsageBreakdownV1,
  InferenceUsageReceiptV1,
  WakeCandidateV1,
  WakeDecisionV1,
} from "../generated/cognitiveRuntimeTypes.js";
import type {
  AttentionCompilerPort,
  AttentionContextProviderPort,
  ChangeAggregatorPort,
  CognitiveBudgetPlannerPort,
  CognitiveCapacityLimiterPort,
  CognitiveEnergyEnginePort,
  CognitiveGatePort,
  UsageClassifierPort,
  UsageSettlementPort,
} from "../cognition/runtimePorts.js";

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

test("runtime decision ports are synchronous pure proposal boundaries", () => {
  const candidate = contract<WakeCandidateV1>("wake_candidate");
  const decision = contract<WakeDecisionV1>("wake_decision");
  const intent = contract<AttentionIntentV1>("attention_intent");
  const subscription = contract<AttentionSubscriptionV1>("attention_subscription");
  const account = contract<CognitiveEnergyAccountV1>("cognitive_energy_account");
  const reservation = contract<CognitiveEnergyReservationV1>(
    "cognitive_energy_reservation",
  );
  const envelope = contract<CognitiveCapacityEnvelopeV2>(
    "cognitive_capacity_envelope",
  );
  const receipt = contract<InferenceUsageReceiptV1>("inference_usage_receipt");
  const breakdown = contract<ExperiencedUsageBreakdownV1>(
    "experienced_usage_breakdown",
  );
  const settlement = contract<CognitiveEnergySettlementV1>(
    "cognitive_energy_settlement",
  );

  const aggregator: ChangeAggregatorPort<number, { window: number }, number> = {
    aggregate: (changes) => changes.reduce((sum, value) => sum + value, 0),
  };
  const gate: CognitiveGatePort<{ observable: true }> = {
    evaluate: () => structuredClone(decision),
  };
  const compiler: AttentionCompilerPort<{ perceptionOnly: true }> = {
    compile: () => structuredClone(subscription),
  };
  const planner: CognitiveBudgetPlannerPort<{ promptRunId: string }> = {
    plan: () => structuredClone(reservation),
  };
  const limiter: CognitiveCapacityLimiterPort = {
    limit: () => structuredClone(envelope),
  };
  const energy: CognitiveEnergyEnginePort<{ elapsedSeconds: number }> = {
    proposeRecovery: (current) => ({ ...current, revision: current.revision + 1 }),
    proposeReservation: (current) => ({
      ...current,
      reserved: current.reserved + reservation.max_normalized_token_units,
      revision: current.revision + 1,
    }),
    proposeSettlement: (current) => ({
      ...current,
      reserved: Math.max(0, current.reserved - settlement.released_reservation),
      revision: current.revision + 1,
    }),
  };
  const classifier: UsageClassifierPort<{ closureHash: string }> = {
    classify: () => structuredClone(breakdown),
  };
  const usageSettlement: UsageSettlementPort<{ accountingVersion: string }> = {
    propose: () => structuredClone(settlement),
  };

  const results = [
    aggregator.aggregate([1, 2], { window: 30 }),
    gate.evaluate(candidate, { observable: true }),
    compiler.compile(intent, { perceptionOnly: true }),
    planner.plan(decision, account, { promptRunId: reservation.prompt_run_id }),
    limiter.limit(account, reservation, envelope.mandatory_source_refs, {}),
    energy.proposeRecovery(account, { elapsedSeconds: 60 }),
    energy.proposeReservation(account, reservation),
    energy.proposeSettlement(account, settlement),
    classifier.classify(receipt, { closureHash: breakdown.input_closure_hash }),
    usageSettlement.propose(account, reservation, receipt, breakdown, {
      accountingVersion: settlement.accounting_version,
    }),
  ];

  for (const result of results) {
    assert.equal(result instanceof Promise, false);
  }
  assert.equal(results[0], 3);
  assert.equal((results[4] as CognitiveCapacityEnvelopeV2).visibility, "engine_only");
});

test("attention context provider is the explicit asynchronous read boundary", async () => {
  const provider: AttentionContextProviderPort<
    { actorId: string },
    { activeSubscriptionIds: string[] }
  > = {
    load: async () => ({ activeSubscriptionIds: ["attention_subscription_0001"] }),
  };

  const pending = provider.load({ actorId: "terra" });
  assert.ok(pending instanceof Promise);
  assert.deepEqual(await pending, {
    activeSubscriptionIds: ["attention_subscription_0001"],
  });
});

test("runtime port surface contains no state-label projector", () => {
  const source = readFileSync(
    join(ROOT, "src", "gf", "cognition", "runtimePorts.ts"),
    "utf8",
  );
  assert.equal(/fatigue|feeling_projector|state_label_projector/i.test(source), false);
});
