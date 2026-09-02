import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  AttentionCompiler,
  activeAttentionSubscriptions,
} from "../cognition/attention/attentionLifecycle.js";
import { VersionedUsageSettlement } from "../cognition/energy/energyEngine.js";
import type {
  AttentionIntentV1,
  AttentionSubscriptionV1,
  CognitiveEnergyAccountV1,
  CognitiveEnergyReservationV1,
  ExperiencedUsageBreakdownV1,
  InferenceUsageReceiptV1,
  WakeCandidateV1,
  WakeDecisionV1,
} from "../generated/cognitiveRuntimeTypes.js";
import { CommitRejected } from "../state/stateManager.js";
import { computeInputClosureHash } from "../validation/derivedInputClosure.js";
import { setupRuntime, userEvent } from "./helpers.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const AT = "2026-09-02T14:00:00.000Z";

function intent(overrides: Partial<AttentionIntentV1> = {}): AttentionIntentV1 {
  return {
    schema_version: "1.0",
    intent_id: "intent:s4",
    actor_id: "terra",
    concern: "S-4 的读数是否继续变化",
    future_change: "如果终端再次出现可感知异常，我想留意",
    scope: {
      kind: "object",
      subject_refs: [{ source_type: "event", source_id: "evt_attention" }],
      valid_until: "2026-09-02T18:00:00.000Z",
    },
    lifecycle: "active",
    evidence_refs: [{ source_type: "event", source_id: "evt_attention" }],
    policy_run_id: "run_policy_attention",
    source_closure_hash: "a".repeat(64),
    base_state_revision: 4,
    created_at: AT,
    ...overrides,
  };
}

test("Attention subscriptions are perception-only, cancellable, expiring, and deduplicated", () => {
  const compiler = new AttentionCompiler();
  const filter = {
    event_kinds: ["observation.changed", "observation.changed"],
    entity_ids: ["s4-terminal"],
    location_ids: ["eco-garden"],
    match_mode: "all" as const,
  };
  const first = compiler.compile(intent(), {
    observableFilter: filter,
    compilerVersion: "attention-compiler.v1",
    createdAt: AT,
  });
  const duplicate = compiler.compile(intent({ intent_id: "intent:s4:new" }), {
    observableFilter: {
      ...filter,
      event_kinds: [...filter.event_kinds].reverse(),
    },
    compilerVersion: "attention-compiler.v1",
    createdAt: "2026-09-02T14:01:00.000Z",
  });
  assert.equal(first.subscription_id, duplicate.subscription_id);
  assert.equal(first.perception_only, true);
  assert.equal(/action|world_event|sql|threshold/i.test(JSON.stringify(first)), false);
  assert.equal(
    activeAttentionSubscriptions([first, duplicate], "2026-09-02T15:00:00.000Z").length,
    1,
  );

  const cancelled: AttentionSubscriptionV1 = {
    ...duplicate,
    status: "cancelled",
    base_state_revision: 5,
    created_at: "2026-09-02T15:01:00.000Z",
  };
  assert.deepEqual(
    activeAttentionSubscriptions([first, cancelled], "2026-09-02T16:00:00.000Z"),
    [],
  );
  assert.deepEqual(
    activeAttentionSubscriptions([first], "2026-09-02T18:00:00.000Z"),
    [],
  );
});

function wakePair(
  suffix: string,
  disposition: "ignore" | "accumulate",
): { candidate: WakeCandidateV1; decision: WakeDecisionV1 } {
  const source = { source_type: "event" as const, source_id: "evt_wake_property" };
  const hash = computeInputClosureHash(0, [source]);
  const candidate: WakeCandidateV1 = {
    schema_version: "1.0",
    candidate_id: `candidate:${suffix}`,
    actor_id: "terra",
    committed_revision: 0,
    observation_refs: [source],
    boundary_kind: "observable_change",
    occurred_at: AT,
    input_closure_hash: hash,
  };
  return {
    candidate,
    decision: {
      schema_version: "1.0",
      decision_id: `decision:${suffix}`,
      candidate_id: candidate.candidate_id,
      actor_id: "terra",
      disposition,
      queue_lane: disposition === "ignore" ? "none" : "background",
      reason_codes: disposition === "ignore"
        ? ["no_material_change"]
        : ["observable_change"],
      matched_rule_ids: [],
      observation_refs: [source],
      gate_version: "cognitive-gate.v1",
      parameter_version: "gate-params.v1",
      base_state_revision: 0,
      input_closure_hash: hash,
      decided_at: AT,
    },
  };
}

test("off and shadow persist byte-identical complete non-wake audits", () => {
  const payloads: string[][] = [];
  for (const mode of ["off", "shadow"] as const) {
    const rt = setupRuntime();
    try {
      rt.stateManager.ingestEvent(userEvent("可感知的小变化", {
        event_id: "evt_wake_property",
        idempotency_key: `wake-${mode}`,
      }));
      for (const disposition of ["ignore", "accumulate"] as const) {
        const pair = wakePair(disposition, disposition);
        rt.stateManager.recordWakeDecision(pair.candidate, pair.decision, {
          inputSources: pair.candidate.observation_refs,
          affectMode: mode,
          affectContributed: false,
        });
        rt.stateManager.recordWakeDecision(pair.candidate, pair.decision, {
          inputSources: pair.candidate.observation_refs,
          affectMode: mode,
          affectContributed: false,
        });
      }
      const rows = rt.db.prepare(
        `SELECT payload_json, wake FROM wake_decision_audit
         ORDER BY decision_id`,
      ).all() as { payload_json: string; wake: number }[];
      assert.equal(rows.length, 2);
      assert.deepEqual(rows.map((row) => row.wake), [0, 0]);
      payloads.push(rows.map((row) => row.payload_json));
      const pair = wakePair("forged", "ignore");
      assert.throws(
        () => rt.stateManager.recordWakeDecision(pair.candidate, pair.decision, {
          inputSources: pair.candidate.observation_refs,
          affectMode: "shadow",
          affectContributed: true,
        }),
        CommitRejected,
      );
    } finally {
      rt.cleanup();
    }
  }
  assert.deepEqual(payloads[1], payloads[0]);
});

test("optional SelfExperience is source-linked and cannot mutate objective ledgers", () => {
  const rt = setupRuntime();
  try {
    const event = userEvent("刚处理完一轮记录。", {
      event_id: "evt_self_experience",
      idempotency_key: "self-experience-source",
    });
    rt.stateManager.ingestEvent(event);
    rt.stateManager.recordPromptRunStarted({
      runId: "run_self_experience",
      promptName: "policy",
      promptVersion: "policy.v1",
      promptManifestHash: "a".repeat(64),
      inputHash: "b".repeat(64),
      modelId: "deepseek-v4-flash",
      startedAt: AT,
    });
    rt.stateManager.recordPromptRunFinished({
      runId: "run_self_experience",
      status: "validated",
      outputHash: "c".repeat(64),
      finishedAt: AT,
    });
    const source = { source_type: "event" as const, source_id: event.event_id };
    const proposal = {
      schema_version: "2.0" as const,
      proposal_id: "self_experience:1",
      actor_id: "terra",
      narrative: "我好像有点走神，也可能只是刚才一直盯着同一列数字。",
      evidence_refs: [source],
      policy_run_id: "run_self_experience",
      source_closure_hash: computeInputClosureHash(0, [source]),
      base_state_revision: 0,
      as_of: AT,
    };
    assert.equal(
      (rt.db.prepare("SELECT count(*) AS n FROM subjective_experience_records").get() as { n: number }).n,
      0,
      "omission is valid",
    );
    rt.stateManager.recordSubjectiveExperience("subjective:1", proposal, {
      inputSources: [source],
    });
    rt.stateManager.recordSubjectiveExperience("subjective:1", proposal, {
      inputSources: [source],
    });
    assert.equal(
      (rt.db.prepare("SELECT count(*) AS n FROM subjective_experience_records").get() as { n: number }).n,
      1,
    );
    assert.equal(
      (rt.db.prepare("SELECT count(*) AS n FROM cognitive_energy_accounts").get() as { n: number }).n,
      0,
    );
    assert.equal(
      (rt.db.prepare("SELECT count(*) AS n FROM world_events").get() as { n: number }).n,
      1,
    );
    assert.throws(
      () => rt.stateManager.recordSubjectiveExperience(
        "subjective:forged",
        { ...proposal, proposal_id: "self_experience:forged" },
        { inputSources: [{ source_type: "event", source_id: "evt_hidden" }] },
      ),
      CommitRejected,
    );
  } finally {
    rt.cleanup();
  }
});

test("normalization is deterministic, monotonic, price-independent, and model-version gated", () => {
  const settlement = new VersionedUsageSettlement();
  const account: CognitiveEnergyAccountV1 = {
    schema_version: "1.0", actor_id: "terra", available: 50, reserved: 50,
    capacity: 100, protected_reply_reserve: 20, recovered_at: AT,
    recovery_model_version: "recovery.v1", revision: 1,
  };
  const reservation: CognitiveEnergyReservationV1 = {
    schema_version: "1.0", reservation_id: "reservation:property",
    actor_id: "terra", wake_decision_id: "decision:property",
    prompt_run_id: "run:property", purpose: "policy",
    max_normalized_token_units: 50, access_class: "autonomous",
    base_state_revision: 0, accounting_version: "energy.v1",
    expires_at: "2026-09-02T15:00:00.000Z", idempotency_key: "property",
  };
  const source = { source_type: "event" as const, source_id: "evt_property" };
  const receipt: InferenceUsageReceiptV1 = {
    schema_version: "1.0", receipt_id: "usage:property",
    prompt_run_id: "run:property", provider_request_id: "provider:property",
    model_id: "deepseek-v4-flash", tokenizer_version: "tokenizer.v1",
    input_tokens: 10, cached_input_tokens: 9, output_tokens: 5,
    reasoning_tokens: 2, attempt_ordinal: 1, completion_status: "completed",
    usage_source: "provider", received_at: AT,
  };
  const context = {
    accountingVersion: "energy.v1",
    settledAt: AT,
    normalization: {
      version: "calibration.v1", modelId: "deepseek-v4-flash",
      tokenizerVersion: "tokenizer.v1", semanticInputWeight: 1,
      deliberationWeight: 2, expressionWeight: 1,
    },
  };
  let prior = -1;
  let offSettlement;
  let shadowSettlement;
  for (let tokens = 0; tokens <= 20; tokens += 1) {
    const breakdown: ExperiencedUsageBreakdownV1 = {
      schema_version: "1.0", breakdown_id: `breakdown:${tokens}`,
      usage_receipt_id: receipt.receipt_id, prompt_run_id: receipt.prompt_run_id,
      segments: [{ segment_id: "semantic", purpose: "current_message",
        token_count: tokens, experienced: true, source_refs: [source] }],
      attempt_class: "accepted_semantic", classification_version: "classifier.v1",
      input_closure_hash: "d".repeat(64),
    };
    const plain = settlement.propose(account, reservation, receipt, breakdown, context);
    const priced = settlement.propose(account, reservation, receipt, breakdown, {
      ...context,
      price: 999,
      cacheDiscount: 0.99,
    } as typeof context);
    assert.deepEqual(priced, plain);
    if (tokens === 10) {
      offSettlement = settlement.propose(account, reservation, receipt, breakdown, {
        ...context,
        affectMode: "off",
      } as typeof context);
      shadowSettlement = settlement.propose(account, reservation, receipt, breakdown, {
        ...context,
        affectMode: "shadow",
      } as typeof context);
    }
    assert.ok(plain.normalized_token_units >= prior);
    prior = plain.normalized_token_units;
  }
  assert.deepEqual(shadowSettlement, offSettlement);
  assert.throws(
    () => settlement.propose(account, reservation, {
      ...receipt,
      tokenizer_version: "unconfigured.v2",
    }, {
      schema_version: "1.0", breakdown_id: "breakdown:mismatch",
      usage_receipt_id: receipt.receipt_id, prompt_run_id: receipt.prompt_run_id,
      segments: [{ segment_id: "semantic", purpose: "current_message",
        token_count: 1, experienced: true, source_refs: [source] }],
      attempt_class: "accepted_semantic", classification_version: "classifier.v1",
      input_closure_hash: "d".repeat(64),
    }, context),
    /no matching model\/tokenizer normalization profile/,
  );
});

function filesUnder(path: string): string[] {
  return readdirSync(path).flatMap((name) => {
    const child = join(path, name);
    return statSync(child).isDirectory() ? filesUnder(child) : [child];
  });
}

test("active prompts, schemas, and cognition code contain no fatigue mapping or counter leak", () => {
  const files = ["prompts", "schemas", "src/gf/cognition"]
    .flatMap((path) => filesUnder(join(ROOT, path)))
    .filter((path) => /\.(md|json|ts)$/.test(path));
  const content = files.map((path) => readFileSync(path, "utf-8")).join("\n");
  assert.equal(
    /fatigue_level|attention_state|capability_effects|suggested_behavior|CognitiveConditionProjector/i
      .test(content),
    false,
  );
  const promptText = files
    .filter((path) => path.includes(`${join("", "prompts")}`))
    .map((path) => readFileSync(path, "utf-8"))
    .join("\n");
  assert.equal(
    /provider_request_id|cached_input_tokens|max_semantic_input_units|protected_reply_reserve/i
      .test(promptText),
    false,
  );
});
