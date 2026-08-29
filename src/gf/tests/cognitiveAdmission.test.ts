import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ChangeAggregator,
  CognitiveAdmissionPipeline,
  CognitiveGate,
  type CognitiveAdmissionInput,
  type CommittedAdmissionChange,
} from "../cognition/admission/cognitiveAdmission.js";
import { PerceptionProjector } from "../cognition/perception/perceptionProjector.js";
import type { AttentionSubscriptionV1 } from "../generated/cognitiveRuntimeTypes.js";
import { SchemaRegistry } from "../validation/schemas.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function change(
  id: string,
  visibility: CommittedAdmissionChange["perceptionCandidate"]["visibility"],
  salience: number,
  sourceId: string,
  overrides: Partial<CommittedAdmissionChange> = {},
): CommittedAdmissionChange {
  return {
    changeId: id,
    aggregationKey: "s4-reading",
    eventKind: "observation.s4_reading_changed",
    entityIds: ["s4-terminal"],
    locationIds: ["eco-garden"],
    salience,
    boundaryHint: "observable_change",
    recursiveInternal: false,
    perceptionCandidate: {
      summary: `change ${id}`,
      occurred_at: "2026-08-30T09:00:00+08:00",
      privacy_scope: "internal",
      source_refs: [{ source_type: "event", source_id: sourceId }],
      provenance: {
        kind: "world_event",
        principal_id: "world-engine",
        trust: "verified",
      },
      visibility,
    },
    ...overrides,
  };
}

function subscription(): AttentionSubscriptionV1 {
  return {
    schema_version: "1.0",
    subscription_id: "subscription:s4",
    intent_id: "intent:s4",
    actor_id: "muelsyse",
    status: "active",
    observable_filter: {
      event_kinds: ["observation.s4_reading_changed"],
      entity_ids: ["s4-terminal"],
      location_ids: ["eco-garden"],
      match_mode: "all",
    },
    perception_only: true,
    evidence_refs: [{ source_type: "event", source_id: "evt-intent-source" }],
    compiler_version: "attention-compiler.v1",
    base_state_revision: 20,
    created_at: "2026-08-30T08:00:00+08:00",
    expires_at: "2026-08-30T18:00:00+08:00",
  };
}

function input(
  changes: readonly CommittedAdmissionChange[],
  subscriptions: readonly AttentionSubscriptionV1[] = [],
): CognitiveAdmissionInput {
  return {
    changes,
    aggregation: {
      windowStartedAt: "2026-08-30T08:59:00+08:00",
      windowEndedAt: "2026-08-30T09:01:00+08:00",
      accumulatorVersion: "change-aggregator.v1",
    },
    perception: {
      actor_id: "muelsyse",
      actor_location_id: "eco-garden",
      private_channel_ids: ["doctor-im"],
      public_channel_ids: [],
      device_feed_ids: [],
      authorized_record_ids: [],
      projected_at: "2026-08-30T09:01:00+08:00",
      projection_version: "perception-projector.v1",
      base_state_revision: 20,
    },
    gate: {
      currentActivity: {
        activityId: "activity:recording",
        continuation: "automatic",
        sourceRefs: [{ source_type: "event", source_id: "evt-activity" }],
      },
      hardInterrupts: [],
      activeSubscriptions: subscriptions,
      previousAccumulations: [],
      parameters: {
        parameterVersion: "cognitive-gate-params.v1",
        wakeSalience: 1,
        accumulateSalience: 0.1,
        accumulatedWakeCount: 3,
        accumulatedWakeSalience: 1,
      },
      gateVersion: "cognitive-gate.v1",
      decidedAt: "2026-08-30T09:01:01+08:00",
    },
  };
}

function pipeline(): CognitiveAdmissionPipeline {
  return new CognitiveAdmissionPipeline(
    new ChangeAggregator(),
    new PerceptionProjector(),
    new CognitiveGate(),
  );
}

test("hidden world facts cannot alter WakeDecision through Attention", () => {
  const visible = change(
    "visible-change",
    { kind: "co_located", location_id: "eco-garden" },
    0.2,
    "evt-visible",
  );
  const hidden = change(
    "hidden-change",
    { kind: "hidden" },
    100,
    "evt-hidden",
  );
  const watcher = subscription();
  const baseline = pipeline().evaluate(input([visible], [watcher]));
  const withHidden = pipeline().evaluate(input([visible, hidden], [watcher]));

  assert.equal(baseline.decision?.disposition, "wake");
  assert.equal(baseline.candidate?.boundary_kind, "attention_match");
  assert.deepEqual(withHidden.decision, baseline.decision);
  assert.equal(JSON.stringify(withHidden).includes("evt-hidden"), true);
  assert.equal(JSON.stringify(withHidden.decision).includes("evt-hidden"), false);
});

test("weak visible changes accumulate and deduplicate without a wake storm", () => {
  const weak = change(
    "weak-change",
    { kind: "co_located", location_id: "eco-garden" },
    0.2,
    "evt-weak",
  );
  const result = pipeline().evaluate(input([weak, structuredClone(weak)]));

  assert.equal(result.batch.droppedDuplicateCount, 1);
  assert.equal(result.observations.length, 1);
  assert.equal(result.decision?.disposition, "accumulate");
  assert.equal(result.decision?.queue_lane, "background");
  assert.deepEqual(
    result.decision?.reason_codes,
    ["deduplicated", "observable_change"],
  );
});

test("prior legal weak signals cross one accumulated wake boundary", () => {
  const weak = change(
    "weak-later",
    { kind: "co_located", location_id: "eco-garden" },
    0.2,
    "evt-weak-later",
  );
  const request = input([weak]);
  request.gate.previousAccumulations = [{
    accumulationId: "accumulation:s4",
    aggregationKey: "s4-reading",
    signalCount: 2,
    salience: 0.4,
    sourceRefs: [
      { source_type: "event", source_id: "evt-weak-1" },
      { source_type: "event", source_id: "evt-weak-2" },
    ],
  }];
  const result = pipeline().evaluate(request);

  assert.equal(result.candidate?.boundary_kind, "accumulated_signal");
  assert.equal(result.decision?.disposition, "wake");
  assert.deepEqual(result.decision?.reason_codes, ["accumulated_signal"]);
  assert.equal(
    result.decision?.observation_refs.some(
      (source) => source.source_id === "evt-weak-1",
    ),
    true,
  );
});

test("visible hard interrupts and direct user messages receive protected lanes", () => {
  const alarm = change(
    "alarm",
    { kind: "co_located", location_id: "eco-garden" },
    0,
    "evt-alarm",
    { boundaryHint: "runtime_hard_interrupt" },
  );
  const alarmInput = input([alarm]);
  alarmInput.gate.hardInterrupts = [{
    ruleId: "interrupt:audible-alarm",
    observationRefs: [{ source_type: "event", source_id: "evt-alarm" }],
    queueLane: "safety",
  }];
  const alarmResult = pipeline().evaluate(alarmInput);
  assert.equal(alarmResult.decision?.queue_lane, "safety");
  assert.deepEqual(alarmResult.decision?.reason_codes, ["runtime_hard_interrupt"]);

  const message = change(
    "doctor-message",
    {
      kind: "direct_message",
      channel_id: "doctor-im",
      recipient_actor_ids: ["muelsyse"],
    },
    0,
    "msg-doctor",
    {
      eventKind: "message.user",
      perceptionCandidate: {
        summary: "博士发来了一条消息。",
        occurred_at: "2026-08-30T09:00:00+08:00",
        privacy_scope: "private_im",
        source_refs: [{ source_type: "message", source_id: "msg-doctor" }],
        provenance: {
          kind: "message",
          principal_id: "doctor",
          trust: "authenticated",
        },
        visibility: {
          kind: "direct_message",
          channel_id: "doctor-im",
          recipient_actor_ids: ["muelsyse"],
        },
      },
    },
  );
  const messageResult = pipeline().evaluate(input([message]));
  assert.equal(messageResult.decision?.disposition, "wake");
  assert.equal(messageResult.decision?.queue_lane, "reply");
});

test("internal bookkeeping is audited as non-recursive ignore", () => {
  const internal = change(
    "gate-audit",
    { kind: "authorized_record", record_id: "runtime-audit" },
    50,
    "claim-gate-audit",
    {
      recursiveInternal: true,
      eventKind: "runtime.gate_audit",
      perceptionCandidate: {
        summary: "gate audit row",
        occurred_at: "2026-08-30T09:00:00+08:00",
        privacy_scope: "internal",
        source_refs: [{ source_type: "claim", source_id: "claim-gate-audit" }],
        provenance: {
          kind: "record",
          principal_id: "runtime",
          trust: "verified",
        },
        visibility: { kind: "authorized_record", record_id: "runtime-audit" },
      },
    },
  );
  const request = input([internal]);
  request.perception.authorized_record_ids = ["runtime-audit"];
  const result = pipeline().evaluate(request);
  assert.equal(result.decision?.disposition, "ignore");
  assert.deepEqual(
    result.decision?.reason_codes,
    ["non_recursive_internal_change"],
  );

  const registry = new SchemaRegistry(join(ROOT, "schemas"));
  registry.validate("wake-candidate.schema.json", result.candidate);
  registry.validate("wake-decision.schema.json", result.decision);
});
