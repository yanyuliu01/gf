import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  WorkingSelfBuilder,
  WorkingSelfBuildError,
  type WorkingSelfBuildInput,
  type WorkingSelfCandidate,
} from "../cognition/workingSelf/workingSelfBuilder.js";
import type {
  MemoryBundleV1,
  SourceRef,
} from "../generated/agentPipelineTypes.js";
import type { CognitiveCapacityEnvelopeV2 } from "../generated/cognitiveRuntimeTypes.js";
import {
  computeInputClosureHash,
  normalizeSourceRefs,
} from "../validation/derivedInputClosure.js";
import { SchemaRegistry } from "../validation/schemas.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function source(sourceType: SourceRef["source_type"], sourceId: string): SourceRef {
  return { source_type: sourceType, source_id: sourceId };
}

function candidate(
  evidenceId: string,
  origin: WorkingSelfCandidate["origin"],
  narrative: string,
  sourceRef: SourceRef,
): WorkingSelfCandidate {
  return {
    evidenceId,
    origin,
    narrative,
    sourceRefs: [sourceRef],
    asOf: "2026-08-30T09:00:00+08:00",
  };
}

function memoryBundle(): MemoryBundleV1 {
  const memories = [
    {
      memory_id: "memory-support",
      kind: "episodic" as const,
      summary: "之前的相似读数确实对应根区缺水。",
      source_refs: [source("event", "evt-memory-support")],
      as_of: "2026-08-29T09:00:00+08:00",
    },
    {
      memory_id: "memory-counter",
      kind: "episodic" as const,
      summary: "终端刷新延迟也曾制造相同的异常外观。",
      source_refs: [source("event", "evt-memory-counter")],
      as_of: "2026-08-29T08:50:00+08:00",
    },
  ];
  const sources = normalizeSourceRefs(memories.flatMap((item) => item.source_refs));
  return {
    schema_version: "1.0",
    bundle_id: "memory-bundle:test",
    actor_id: "muelsyse",
    evidence: memories,
    supporting_memory_ids: ["memory-support"],
    counter_memory_ids: ["memory-counter"],
    input_closure: {
      source_refs: sources,
      closure_hash: computeInputClosureHash(12, sources),
      base_state_revision: 12,
    },
    retrieval_version: "balanced-memory.v1",
    retrieved_at: "2026-08-30T09:00:01+08:00",
  };
}

function envelope(
  mandatorySourceRefs: readonly SourceRef[],
  maxSemanticInputUnits = 200,
): CognitiveCapacityEnvelopeV2 {
  return {
    schema_version: "2.0",
    envelope_id: "capacity-envelope:test",
    actor_id: "muelsyse",
    reservation_id: "reservation:test",
    access_class: "autonomous",
    visibility: "engine_only",
    max_semantic_input_units: maxSemanticInputUnits,
    max_deliberation_units: 20,
    max_expression_units: 20,
    max_tool_rounds: 1,
    mandatory_source_refs: [...mandatorySourceRefs],
    accounting_version: "energy.v1",
    base_state_revision: 12,
  };
}

function buildInput(maxSemanticInputUnits = 200): WorkingSelfBuildInput {
  const direct = [
    candidate(
      "current-input",
      "current_input",
      "博士刚问起 S-4 的情况。",
      source("message", "msg-current"),
    ),
    candidate(
      "current-fact",
      "current_fact",
      "我刚看到 S-4 的根区读数偏低。",
      source("event", "evt-reading"),
    ),
    candidate(
      "current-activity",
      "activity",
      "我正在生态园整理这一轮观测记录。",
      source("event", "evt-activity"),
    ),
    candidate(
      "current-physiology",
      "physiology",
      "我已经连续工作了一段时间，尚未休息。",
      source("event", "evt-physiology"),
    ),
    candidate(
      "commitment-source",
      "commitment_source",
      "我答应研究员在午前复核这组样本。",
      source("message", "msg-commitment"),
    ),
    candidate(
      "recent-episode",
      "recent_cognitive_episode",
      "刚才我决定先确认终端是否完成刷新。",
      source("event", "evt-cognitive-episode"),
    ),
    candidate(
      "belief",
      "belief",
      "我目前倾向于认为灌溉可能没有跟上。",
      source("claim", "claim-belief"),
    ),
    candidate(
      "open-loop",
      "open_loop",
      "还不确定读数异常来自植物还是终端。",
      source("claim", "claim-open-loop"),
    ),
    candidate(
      "persona",
      "persona",
      "我重视亲自观察，而不是只依赖单次读数。",
      source("canon", "canon-observation-anchor"),
    ),
    candidate(
      "lived-evidence",
      "lived_evidence",
      "S-4 最近已经出现过一次恢复不稳。",
      source("event", "evt-lived"),
    ),
  ];
  const mandatory = [
    source("message", "msg-current"),
    source("event", "evt-reading"),
    source("event", "evt-activity"),
    source("event", "evt-physiology"),
    source("message", "msg-commitment"),
    source("event", "evt-memory-counter"),
  ];
  return {
    episodeId: "episode:test",
    actorId: "muelsyse",
    baseStateRevision: 12,
    evidence: direct,
    memoryBundle: memoryBundle(),
    optionalContributions: [{
      evidenceId: "optional-lived-evidence",
      origin: "lived_evidence",
      narrative: "研究员刚才提到这批样本对照组也有轻微波动。",
      sourceRefs: [source("event", "evt-optional-lived")],
      asOf: "2026-08-30T08:59:00+08:00",
    }],
    capacityEnvelope: envelope(mandatory, maxSemanticInputUnits),
    assemblerVersion: "working-self-builder.v1",
    assembledAt: "2026-08-30T09:00:02+08:00",
  };
}

test("Working Self assembles all lived domains as one source-closed view", () => {
  const builder = new WorkingSelfBuilder();
  const input = buildInput();
  const workingSelf = builder.build(input);

  const roles = new Set(workingSelf.evidence.map((item) => item.role));
  for (const role of [
    "current_input",
    "current_fact",
    "activity",
    "commitment_evidence",
    "memory",
    "belief",
    "open_loop",
    "counter_evidence",
    "persona",
    "lived_evidence",
  ]) {
    assert.equal(roles.has(role as never), true, `missing ${role}`);
  }
  assert.equal(
    workingSelf.input_closure.closure_hash,
    computeInputClosureHash(
      12,
      workingSelf.evidence.flatMap((item) => item.source_refs),
    ),
  );
  const serialized = JSON.stringify(workingSelf);
  assert.equal(
    /energy|capacity|fatigue|suggested_behavior|current_affect|affect_state|provider|price/i
      .test(serialized),
    false,
  );
  const registry = new SchemaRegistry(join(ROOT, "schemas"));
  registry.validate("working-self.schema.json", workingSelf);
});

test("optional breadth is dropped before current facts, commitments, and contradiction", () => {
  const builder = new WorkingSelfBuilder();
  const full = buildInput();
  const requiredOrigins = new Set([
    "current_input",
    "safety",
    "current_fact",
    "activity",
    "physiology",
    "commitment_source",
  ]);
  const requiredDirect = full.evidence.filter((item) => requiredOrigins.has(item.origin));
  const counter = full.memoryBundle!.evidence.find(
    (item) => item.memory_id === "memory-counter",
  )!;
  const mandatoryUnits = [...requiredDirect.map((item) => item.narrative), counter.summary]
    .reduce(
      (total, narrative) => total
        + Math.max(1, Math.ceil(Array.from(narrative).length / 4)),
      0,
    );
  const constrained = builder.build({
    ...full,
    capacityEnvelope: envelope(
      full.capacityEnvelope.mandatory_source_refs,
      mandatoryUnits,
    ),
  });

  assert.deepEqual(
    new Set(constrained.evidence.map((item) => item.evidence_id)),
    new Set([
      ...requiredDirect.map((item) => item.evidenceId),
      "memory-counter",
    ]),
  );
  assert.equal(
    constrained.evidence.some((item) => item.role === "counter_evidence"),
    true,
  );
  assert.equal(constrained.evidence.some((item) => item.role === "persona"), false);
});

test("mandatory source closure fails closed instead of inventing context", () => {
  const input = buildInput();
  const builder = new WorkingSelfBuilder();
  assert.throws(
    () => builder.build({
      ...input,
      capacityEnvelope: envelope([
        ...input.capacityEnvelope.mandatory_source_refs,
        source("event", "evt-hidden-not-selected"),
      ]),
    }),
    WorkingSelfBuildError,
  );
});

test("forged or future-revision memory bundles are rejected", () => {
  const input = buildInput();
  const builder = new WorkingSelfBuilder();
  assert.throws(
    () => builder.build({
      ...input,
      memoryBundle: {
        ...input.memoryBundle!,
        input_closure: {
          ...input.memoryBundle!.input_closure,
          closure_hash: "f".repeat(64),
        },
      },
    }),
    WorkingSelfBuildError,
  );
  assert.throws(
    () => builder.build({
      ...input,
      memoryBundle: {
        ...input.memoryBundle!,
        input_closure: {
          ...input.memoryBundle!.input_closure,
          base_state_revision: 13,
        },
      },
    }),
    WorkingSelfBuildError,
  );
});
