import { createHash } from "node:crypto";

import type {
  ExperiencedUsageBreakdownV1,
  InferenceUsageReceiptV1,
  SourceRef,
  TokenSegmentUsageV1,
} from "../../generated/cognitiveRuntimeTypes.js";
import type { UsageClassifierPort } from "../../cognition/runtimePorts.js";
import { normalizeSourceRefs } from "../../validation/derivedInputClosure.js";

export const USAGE_CLASSIFICATION_VERSION = "usage-classifier.v1";

type SegmentPurpose = TokenSegmentUsageV1["purpose"];
type InputPurpose = Exclude<
  SegmentPurpose,
  "deliberation" | "self_experience" | "expression"
>;

export interface InputUsageSegmentPlanV1 {
  segmentId: string;
  purpose: InputPurpose;
  weight: number;
  sourceRefs: readonly SourceRef[];
}

export interface UsageClassificationContextV1 {
  attemptClass: ExperiencedUsageBreakdownV1["attempt_class"];
  inputClosureHash: string;
  inputSegments: readonly InputUsageSegmentPlanV1[];
  outputPurpose: "deliberation" | "expression";
  outputSourceRefs?: readonly SourceRef[];
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function deterministicId(prefix: string, value: unknown): string {
  const hash = createHash("sha256").update(stableJson(value)).digest("hex");
  return `${prefix}_${hash.slice(0, 32)}`;
}

function assertCounter(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function allocateTokens(
  total: number,
  plans: readonly InputUsageSegmentPlanV1[],
): number[] {
  if (plans.length === 0) {
    if (total === 0) {
      return [];
    }
    throw new Error("positive input usage requires at least one segment plan");
  }
  const ids = new Set<string>();
  for (const plan of plans) {
    if (ids.has(plan.segmentId)) {
      throw new Error(`duplicate input usage segment ${plan.segmentId}`);
    }
    ids.add(plan.segmentId);
    assertCounter(plan.weight, `weight for ${plan.segmentId}`);
  }
  const totalWeight = plans.reduce((sum, plan) => sum + plan.weight, 0);
  if (total > 0 && totalWeight === 0) {
    throw new Error("positive input usage requires positive segment weight");
  }
  if (totalWeight === 0) {
    return plans.map(() => 0);
  }
  const exact = plans.map((plan) => total * plan.weight / totalWeight);
  const allocated = exact.map(Math.floor);
  let remaining = total - allocated.reduce((sum, value) => sum + value, 0);
  const order = plans
    .map((plan, index) => ({
      index,
      remainder: exact[index] - allocated[index],
      segmentId: plan.segmentId,
    }))
    .sort((left, right) =>
      right.remainder - left.remainder
      || left.segmentId.localeCompare(right.segmentId));
  for (let index = 0; index < remaining; index += 1) {
    allocated[order[index].index] += 1;
  }
  return allocated;
}

function allOutputSources(
  context: Readonly<UsageClassificationContextV1>,
): SourceRef[] {
  return normalizeSourceRefs(
    context.outputSourceRefs
      ?? context.inputSegments.flatMap((segment) => [...segment.sourceRefs]),
  );
}

/**
 * Deterministic classification of provider/local counters into lived semantic
 * load. Cache counters never reduce semantic input; retry and repair attempts
 * become a single non-experienced runtime segment.
 */
export class VersionedUsageClassifier implements UsageClassifierPort<UsageClassificationContextV1> {
  classify(
    receipt: Readonly<InferenceUsageReceiptV1>,
    context: Readonly<UsageClassificationContextV1>,
  ): ExperiencedUsageBreakdownV1 {
    assertCounter(receipt.input_tokens, "input_tokens");
    assertCounter(receipt.output_tokens, "output_tokens");
    const cached = receipt.cached_input_tokens ?? 0;
    const reasoning = receipt.reasoning_tokens ?? 0;
    assertCounter(cached, "cached_input_tokens");
    assertCounter(reasoning, "reasoning_tokens");
    if (cached > receipt.input_tokens) {
      throw new Error("cached_input_tokens exceeds input_tokens");
    }
    if (reasoning > receipt.output_tokens) {
      throw new Error("reasoning_tokens exceeds output_tokens");
    }
    if (!/^[a-f0-9]{64}$/i.test(context.inputClosureHash)) {
      throw new Error("inputClosureHash must be a SHA-256 hash");
    }

    const accepted = context.attemptClass === "accepted_semantic";
    if (accepted && receipt.completion_status !== "completed") {
      throw new Error("accepted semantic usage requires a completed receipt");
    }
    if (
      context.attemptClass === "transport_retry"
      && receipt.completion_status === "completed"
    ) {
      throw new Error("transport retry usage requires a failed or cancelled receipt");
    }

    let segments: TokenSegmentUsageV1[];
    if (!accepted) {
      segments = [{
        segment_id: "segment_runtime_attempt",
        purpose: "runtime_overhead",
        token_count: receipt.input_tokens + receipt.output_tokens,
        experienced: false,
        source_refs: [],
      }];
    } else {
      if (context.inputSegments.length > 125) {
        throw new Error("too many input usage segment plans");
      }
      const allocated = allocateTokens(
        receipt.input_tokens,
        context.inputSegments,
      );
      segments = context.inputSegments.map((plan, index) => ({
        segment_id: plan.segmentId,
        purpose: plan.purpose,
        token_count: allocated[index],
        experienced: plan.purpose !== "runtime_overhead",
        source_refs: plan.purpose === "runtime_overhead"
          ? []
          : normalizeSourceRefs(plan.sourceRefs),
      }));
      const outputSources = allOutputSources(context);
      if (reasoning > 0) {
        segments.push({
          segment_id: "segment_deliberation",
          purpose: "deliberation",
          token_count: reasoning,
          experienced: true,
          source_refs: outputSources,
        });
      }
      const visibleOutput = receipt.output_tokens - reasoning;
      if (visibleOutput > 0) {
        segments.push({
          segment_id: context.outputPurpose === "deliberation"
            ? "segment_visible_deliberation"
            : "segment_expression",
          purpose: context.outputPurpose,
          token_count: visibleOutput,
          experienced: true,
          source_refs: outputSources,
        });
      }
      if (segments.length === 0) {
        segments.push({
          segment_id: "segment_runtime_empty",
          purpose: "runtime_overhead",
          token_count: 0,
          experienced: false,
          source_refs: [],
        });
      }
      if (segments.some((segment) =>
        segment.experienced && segment.source_refs.length === 0)) {
        throw new Error("experienced usage segments require source refs");
      }
    }

    const identity = {
      receipt_id: receipt.receipt_id,
      prompt_run_id: receipt.prompt_run_id,
      attempt_class: context.attemptClass,
      input_closure_hash: context.inputClosureHash,
      classification_version: USAGE_CLASSIFICATION_VERSION,
      segments,
    };
    return {
      schema_version: "1.0",
      breakdown_id: deterministicId("usagebd", identity),
      usage_receipt_id: receipt.receipt_id,
      prompt_run_id: receipt.prompt_run_id,
      segments,
      attempt_class: context.attemptClass,
      classification_version: USAGE_CLASSIFICATION_VERSION,
      input_closure_hash: context.inputClosureHash,
    };
  }
}
