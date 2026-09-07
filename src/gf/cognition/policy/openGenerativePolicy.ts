import { createHash } from "node:crypto";

import type {
  OpenActionProposalV1,
  SourceRef,
  WorkingSelfV1,
} from "../../generated/agentPipelineTypes.js";
import type {
  AttentionIntentV1,
  OpenPolicyDraftV1,
  SelfExperienceProposalV2,
} from "../../generated/cognitiveRuntimeTypes.js";
import type { SchemaRegistry } from "../../validation/schemas.js";
import {
  computeInputClosureHash,
  normalizeSourceRefs,
} from "../../validation/derivedInputClosure.js";
import type { OpenPolicyPort } from "../ports.js";

export const OPEN_POLICY_PROMPT_VERSION = "open-policy.v1";
export const OPEN_POLICY_SYSTEM_INSTRUCTION = `你为持续世界中的一个主体提出本次开放语义意图。
只使用 Working Self 中有来源的生活证据，不补写隐藏事实。
输出一个 action；它表达想做什么和可选计划，不宣告行动成功，也不枚举、比较或排序动作菜单。
可以省略 self_experience 和 attention_intent。自我理解必须是开放文字；未来关注只描述什么可感知变化值得留意，不写阈值、SQL、cron、传感器规则或执行动作。
所有 source_refs 必须逐字复制自 Working Self 的 input_closure。`;

export interface OpenPolicyModelRequestV1 {
  promptVersion: typeof OPEN_POLICY_PROMPT_VERSION;
  systemInstruction: string;
  workingSelf: WorkingSelfV1;
}

export interface OpenPolicyModelResponseV1 {
  policyRunId: string;
  proposedAt: string;
  draft: OpenPolicyDraftV1;
}

export interface OpenPolicyModelPort {
  generate(
    request: Readonly<OpenPolicyModelRequestV1>,
  ): Promise<Readonly<OpenPolicyModelResponseV1>>;
}

export interface OpenPolicyResultV1 {
  action: OpenActionProposalV1;
  selfExperience?: SelfExperienceProposalV2;
  attentionIntent?: AttentionIntentV1;
}

export class OpenPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenPolicyError";
  }
}

/** Async model boundary followed by deterministic source-closed proposal stamping. */
export class OpenGenerativePolicy
  implements OpenPolicyPort<WorkingSelfV1, OpenPolicyResultV1>
{
  constructor(
    private readonly model: OpenPolicyModelPort,
    private readonly schemas: SchemaRegistry,
  ) {}

  async propose(
    workingSelf: Readonly<WorkingSelfV1>,
  ): Promise<Readonly<OpenPolicyResultV1>> {
    this.schemas.validate("working-self.schema.json", workingSelf);
    const closure = normalizeSourceRefs(workingSelf.input_closure.source_refs);
    const closureHash = computeInputClosureHash(
      workingSelf.input_closure.base_state_revision,
      closure,
    );
    if (closureHash !== workingSelf.input_closure.closure_hash) {
      throw new OpenPolicyError("Working Self input closure is invalid");
    }

    const response = await this.model.generate({
      promptVersion: OPEN_POLICY_PROMPT_VERSION,
      systemInstruction: OPEN_POLICY_SYSTEM_INSTRUCTION,
      workingSelf: structuredClone(workingSelf),
    });
    this.schemas.validate("open-policy-draft.schema.json", response.draft);
    const allowed = new Set(closure.map(sourceKey));
    assertSources(response.draft.action.source_refs, allowed);
    if (response.draft.self_experience) {
      assertSources(response.draft.self_experience.evidence_refs, allowed);
    }
    if (response.draft.attention_intent) {
      assertSources(response.draft.attention_intent.evidence_refs, allowed);
      assertSources(response.draft.attention_intent.scope.subject_refs, allowed);
    }

    const basis = {
      actor_id: workingSelf.actor_id,
      policy_run_id: response.policyRunId,
      base_state_revision: workingSelf.input_closure.base_state_revision,
      proposed_at: response.proposedAt,
      draft: response.draft,
    };
    const action: OpenActionProposalV1 = {
      schema_version: "1.0",
      proposal_id: deterministicId("open_action", { ...basis, kind: "action" }),
      actor_id: workingSelf.actor_id,
      policy_run_id: response.policyRunId,
      intent: response.draft.action.intent,
      ...(response.draft.action.plan === undefined
        ? {}
        : { plan: [...response.draft.action.plan] }),
      source_refs: normalizeSourceRefs(response.draft.action.source_refs),
      source_closure_hash: closureHash,
      base_state_revision: workingSelf.input_closure.base_state_revision,
      proposed_at: response.proposedAt,
    };
    this.schemas.validate("open-action-proposal.schema.json", action);

    const result: OpenPolicyResultV1 = { action };
    if (response.draft.self_experience) {
      result.selfExperience = {
        schema_version: "2.0",
        proposal_id: deterministicId("self_experience", { ...basis, kind: "self" }),
        actor_id: workingSelf.actor_id,
        narrative: response.draft.self_experience.narrative,
        evidence_refs: normalizeSourceRefs(response.draft.self_experience.evidence_refs),
        ...(response.draft.self_experience.uncertainty_narrative === undefined
          ? {}
          : { uncertainty_narrative: response.draft.self_experience.uncertainty_narrative }),
        policy_run_id: response.policyRunId,
        source_closure_hash: closureHash,
        base_state_revision: workingSelf.input_closure.base_state_revision,
        as_of: response.proposedAt,
      };
      this.schemas.validate("self-experience-proposal.schema.json", result.selfExperience);
    }
    if (response.draft.attention_intent) {
      result.attentionIntent = {
        schema_version: "1.0",
        intent_id: deterministicId("attention_intent", { ...basis, kind: "attention" }),
        actor_id: workingSelf.actor_id,
        concern: response.draft.attention_intent.concern,
        future_change: response.draft.attention_intent.future_change,
        scope: structuredClone(response.draft.attention_intent.scope),
        lifecycle: "active",
        evidence_refs: normalizeSourceRefs(response.draft.attention_intent.evidence_refs),
        policy_run_id: response.policyRunId,
        source_closure_hash: closureHash,
        base_state_revision: workingSelf.input_closure.base_state_revision,
        created_at: response.proposedAt,
        ...(response.draft.attention_intent.supersedes_intent_id === undefined
          ? {}
          : { supersedes_intent_id: response.draft.attention_intent.supersedes_intent_id }),
      };
      this.schemas.validate("attention-intent.schema.json", result.attentionIntent);
    }
    return structuredClone(result);
  }
}

function assertSources(sources: readonly SourceRef[], allowed: ReadonlySet<string>): void {
  for (const source of normalizeSourceRefs(sources)) {
    if (!allowed.has(sourceKey(source))) {
      throw new OpenPolicyError(`Policy output cites source outside Working Self: ${source.source_id}`);
    }
  }
}

function sourceKey(source: SourceRef): string {
  return JSON.stringify([
    source.source_type,
    source.source_id,
    source.quote_hash ?? null,
    source.observed_at ?? null,
  ]);
}

function deterministicId(prefix: string, value: unknown): string {
  return `${prefix}:${createHash("sha256").update(stableJson(value)).digest("hex").slice(0, 32)}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
