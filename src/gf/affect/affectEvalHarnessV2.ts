import {
  createAffectTraceV1,
  shapeAttentionV1,
  shapeRetrievalV1,
  type AffectTraceV1,
  type ShapedAttentionCandidateV1,
  type ShapedMemoryCandidateV1,
} from "./affectTraceV1.js";
import type { AffectEvalCaseV1 } from "./affectEvalCasesV1.js";

export type AffectEvalModeV2 = "off" | "shadow" | "active";

export interface AffectWorkingContextV2 {
  currentActivity: string;
  noticedObservations: string[];
  relevantMemories: string[];
  userMessage?: string;
}

export interface AffectPreparedCaseV2 {
  trace: AffectTraceV1;
  baselineAttention: ShapedAttentionCandidateV1[];
  shapedAttention: ShapedAttentionCandidateV1[];
  baselineRetrieval: ShapedMemoryCandidateV1[];
  shapedRetrieval: ShapedMemoryCandidateV1[];
}

export interface AffectModeViewV2 {
  mode: AffectEvalModeV2;
  workingContext: AffectWorkingContextV2;
  attentionRanking: ShapedAttentionCandidateV1[];
  retrievalRanking: ShapedMemoryCandidateV1[];
  affectApplied: boolean;
  attentionMembershipChanged: boolean;
  retrievalMembershipChanged: boolean;
}

// V2 intentionally uses narrow capacity to test whether affect can change
// WHICH evidence reaches Working Self, rather than merely reorder the same set.
const ATTENTION_LIMIT = 1;
const MEMORY_LIMIT = 2;

export function prepareAffectCaseV2(
  evalCase: AffectEvalCaseV1,
  now = "2026-08-11T00:00:00+08:00",
): AffectPreparedCaseV2 {
  const trace = createAffectTraceV1({
    id: `trace:${evalCase.id}`,
    sourceRefs: evalCase.sourceRefs,
    appraisal: evalCase.appraisal,
    currentCue: evalCase.currentInput,
    now,
  });

  const baselineAttention = evalCase.attentionCandidates
    .map((item) => ({
      ...item,
      affectBoost: 0,
      finalSalience: item.baselineSalience,
      matchedTraceIds: [],
    }))
    .sort((a, b) => b.finalSalience - a.finalSalience);
  const shapedAttention = shapeAttentionV1(evalCase.attentionCandidates, [trace]);

  const baselineRetrieval = evalCase.memoryCandidates
    .map((item) => ({
      ...item,
      affectBoost: 0,
      finalScore: item.baselineScore,
      affectRole: "none" as const,
      matchedTraceIds: [],
    }))
    .sort((a, b) => b.finalScore - a.finalScore);
  const shapedRetrieval = shapeRetrievalV1(evalCase.memoryCandidates, [trace]);

  return {
    trace,
    baselineAttention,
    shapedAttention,
    baselineRetrieval,
    shapedRetrieval,
  };
}

export function buildAffectModeViewV2(
  evalCase: AffectEvalCaseV1,
  prepared: AffectPreparedCaseV2,
  mode: AffectEvalModeV2,
): AffectModeViewV2 {
  const affectApplied = mode === "active";
  const attentionRanking = affectApplied
    ? prepared.shapedAttention
    : prepared.baselineAttention;
  const retrievalRanking = affectApplied
    ? prepared.shapedRetrieval
    : prepared.baselineRetrieval;

  const baselineAttentionIds = prepared.baselineAttention.slice(0, ATTENTION_LIMIT).map((x) => x.id);
  const activeAttentionIds = prepared.shapedAttention.slice(0, ATTENTION_LIMIT).map((x) => x.id);
  const baselineMemoryIds = prepared.baselineRetrieval.slice(0, MEMORY_LIMIT).map((x) => x.id);
  const activeMemoryIds = prepared.shapedRetrieval.slice(0, MEMORY_LIMIT).map((x) => x.id);

  const noticedObservations = attentionRanking
    .slice(0, ATTENTION_LIMIT)
    .map((item) => item.text);
  const relevantMemories = retrievalRanking
    .slice(0, MEMORY_LIMIT)
    .map((item) => item.text);

  return {
    mode,
    affectApplied,
    attentionRanking,
    retrievalRanking,
    attentionMembershipChanged: !sameMembers(baselineAttentionIds, activeAttentionIds),
    retrievalMembershipChanged: !sameMembers(baselineMemoryIds, activeMemoryIds),
    workingContext: {
      currentActivity: evalCase.currentActivity,
      noticedObservations,
      relevantMemories,
      // User messages remain mandatory product input and are not hidden by soft attention.
      userMessage: evalCase.userMessage,
    },
  };
}

export function topMembershipChangedV2(
  baseline: Array<{ id: string }>,
  shaped: Array<{ id: string }>,
  topK: number,
): boolean {
  return !sameMembers(
    baseline.slice(0, topK).map((item) => item.id),
    shaped.slice(0, topK).map((item) => item.id),
  );
}

function sameMembers(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, index) => value === b[index]);
}
