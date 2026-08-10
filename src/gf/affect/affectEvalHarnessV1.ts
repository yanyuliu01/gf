import {
  createAffectTraceV1,
  selectWorkingMemoriesV1,
  shapeAttentionV1,
  shapeRetrievalV1,
  type AffectTraceV1,
  type ShapedAttentionCandidateV1,
  type ShapedMemoryCandidateV1,
} from "./affectTraceV1.js";
import type { AffectEvalCaseV1 } from "./affectEvalCasesV1.js";

export type AffectEvalModeV1 = "off" | "shadow" | "active";

export interface AffectWorkingContextV1 {
  currentActivity: string;
  currentInput: string;
  noticedObservations: string[];
  relevantMemories: string[];
  userMessage?: string;
}

export interface AffectPreparedCaseV1 {
  trace: AffectTraceV1;
  baselineAttention: ShapedAttentionCandidateV1[];
  shapedAttention: ShapedAttentionCandidateV1[];
  baselineRetrieval: ShapedMemoryCandidateV1[];
  shapedRetrieval: ShapedMemoryCandidateV1[];
}

export interface AffectModeViewV1 {
  mode: AffectEvalModeV1;
  workingContext: AffectWorkingContextV1;
  attentionRanking: ShapedAttentionCandidateV1[];
  retrievalRanking: ShapedMemoryCandidateV1[];
  affectApplied: boolean;
}

const ATTENTION_LIMIT = 2;
const MEMORY_LIMIT = 4;

export function prepareAffectCaseV1(
  evalCase: AffectEvalCaseV1,
  now = "2026-08-11T00:00:00+08:00",
): AffectPreparedCaseV1 {
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

export function buildAffectModeViewV1(
  evalCase: AffectEvalCaseV1,
  prepared: AffectPreparedCaseV1,
  mode: AffectEvalModeV1,
): AffectModeViewV1 {
  const affectApplied = mode === "active";
  const attentionRanking = affectApplied
    ? prepared.shapedAttention
    : prepared.baselineAttention;
  const retrievalRanking = affectApplied
    ? prepared.shapedRetrieval
    : prepared.baselineRetrieval;

  const noticedObservations = attentionRanking
    .slice(0, ATTENTION_LIMIT)
    .map((item) => item.text);
  const relevantMemories = selectWorkingMemoriesV1(retrievalRanking, MEMORY_LIMIT).map(
    (item) => item.text,
  );

  return {
    mode,
    affectApplied,
    attentionRanking,
    retrievalRanking,
    workingContext: {
      currentActivity: evalCase.currentActivity,
      currentInput: evalCase.currentInput,
      noticedObservations,
      relevantMemories,
      userMessage: evalCase.userMessage,
    },
  };
}

export function rankingChangedV1(
  baseline: Array<{ id: string }>,
  shaped: Array<{ id: string }>,
  topK: number,
): boolean {
  const left = baseline.slice(0, topK).map((item) => item.id).join("|");
  const right = shaped.slice(0, topK).map((item) => item.id).join("|");
  return left !== right;
}
