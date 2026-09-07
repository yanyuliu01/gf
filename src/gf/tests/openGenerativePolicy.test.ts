import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  OpenGenerativePolicy,
  OpenPolicyError,
  type OpenPolicyModelRequestV1,
  type OpenPolicyModelResponseV1,
} from "../cognition/policy/openGenerativePolicy.js";
import type { WorkingSelfV1 } from "../generated/agentPipelineTypes.js";
import { computeInputClosureHash } from "../validation/derivedInputClosure.js";
import { SchemaRegistry } from "../validation/schemas.js";
import { setupRuntime } from "./helpers.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCHEMAS = new SchemaRegistry(join(ROOT, "schemas"));
const AT = "2026-09-07T10:00:00.000Z";
const SOURCE = { source_type: "event" as const, source_id: "evt_s4_visible" };

function workingSelf(): WorkingSelfV1 {
  const closureHash = computeInputClosureHash(7, [SOURCE]);
  return {
    schema_version: "1.0",
    working_self_id: "working-self:policy",
    episode_id: "episode:policy",
    actor_id: "terra",
    evidence: [{
      evidence_id: "evidence:s4",
      role: "current_fact",
      narrative: "S-4 的可见读数刚发生变化。",
      source_refs: [SOURCE],
      as_of: AT,
    }],
    input_closure: {
      source_refs: [SOURCE],
      closure_hash: closureHash,
      base_state_revision: 7,
    },
    assembler_version: "working-self.v1",
    assembled_at: AT,
  };
}

function response(overrides: Partial<OpenPolicyModelResponseV1> = {}): OpenPolicyModelResponseV1 {
  return {
    policyRunId: "run:open-policy",
    proposedAt: AT,
    draft: {
      action: {
        intent: "去终端确认 S-4 当前可见读数",
        plan: ["到达终端", "读取当前状态"],
        source_refs: [SOURCE],
      },
      self_experience: {
        narrative: "这次变化值得我亲自确认。",
        evidence_refs: [SOURCE],
      },
      attention_intent: {
        concern: "S-4 是否稳定",
        future_change: "如果后续可见读数继续偏离，我想重新注意它",
        scope: { kind: "object", subject_refs: [SOURCE], valid_until: "2026-09-07T18:00:00.000Z" },
        evidence_refs: [SOURCE],
      },
    },
    ...overrides,
  };
}

test("Open Policy emits one source-closed action plus optional subjective proposals", async () => {
  const rt = setupRuntime();
  let captured: OpenPolicyModelRequestV1 | undefined;
  try {
    const model = { generate: async (request: Readonly<OpenPolicyModelRequestV1>) => {
      captured = structuredClone(request);
      return response();
    } };
    const policy = new OpenGenerativePolicy(model, SCHEMAS);
    const first = await policy.propose(workingSelf());
    const replay = await policy.propose(workingSelf());
    assert.deepEqual(replay, first);
    assert.equal(first.action.intent, "去终端确认 S-4 当前可见读数");
    assert.equal(first.attentionIntent?.lifecycle, "active");
    assert.equal(first.selfExperience?.source_closure_hash, workingSelf().input_closure.closure_hash);
    assert.ok(captured);
    const visible = JSON.stringify(captured);
    assert.doesNotMatch(visible, /energy|capacity|token|price|provider|fatigue|dialogue_samples|action_candidates/i);
    assert.doesNotMatch(visible, /hard_constraint_classes|action_type|primitive/);
  } finally {
    rt.cleanup();
  }
});

test("SelfExperience and AttentionIntent omission is valid", async () => {
  const rt = setupRuntime();
  try {
    const policy = new OpenGenerativePolicy({
      generate: async () => response({ draft: { action: { intent: "先继续观察当前工作", source_refs: [SOURCE] } } }),
    }, SCHEMAS);
    const result = await policy.propose(workingSelf());
    assert.equal(result.selfExperience, undefined);
    assert.equal(result.attentionIntent, undefined);
  } finally {
    rt.cleanup();
  }
});

test("Policy rejects sources outside the Working Self closure", async () => {
  const rt = setupRuntime();
  try {
    const policy = new OpenGenerativePolicy({
      generate: async () => response({
        draft: { action: { intent: "根据隐藏读数行动", source_refs: [{ source_type: "event", source_id: "evt_hidden" }] } },
      }),
    }, SCHEMAS);
    await assert.rejects(() => policy.propose(workingSelf()), OpenPolicyError);
  } finally {
    rt.cleanup();
  }
});
