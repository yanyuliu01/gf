import type { AffectAttributionCaseV1 } from "./affectAttributionEvalCasesV1.js";

export type AffectAttributionModeV1 =
  | "off"
  | "shadow"
  | "active"
  | "placebo-matched";

export interface AffectAttributionWorkingContextV1 {
  currentActivity: string;
  noticedObservations: string[];
  relevantMemories: string[];
  userMessage?: string;
}

export interface AffectAttributionViewV1 {
  mode: AffectAttributionModeV1;
  workingContext: AffectAttributionWorkingContextV1;
  attentionIds: string[];
  memoryIds: string[];
}

const ATTENTION_LIMIT = 1;
const MEMORY_LIMIT = 2;

export function buildAffectAttributionViewV1(
  evalCase: AffectAttributionCaseV1,
  mode: AffectAttributionModeV1,
): AffectAttributionViewV1 {
  const baselineAttention = [...evalCase.attentionCandidates].sort(
    (a, b) => b.baselineSalience - a.baselineSalience,
  );
  const baselineMemories = [...evalCase.memoryCandidates].sort(
    (a, b) => b.baselineScore - a.baselineScore,
  );

  let attentionIds = baselineAttention.slice(0, ATTENTION_LIMIT).map((item) => item.id);
  let memoryIds = baselineMemories.slice(0, MEMORY_LIMIT).map((item) => item.id);

  if (mode === "active") {
    if (evalCase.affectTargetAttentionId) {
      attentionIds = replaceAt(attentionIds, 0, evalCase.affectTargetAttentionId);
    }
    if (evalCase.affectTargetMemoryId) {
      memoryIds = replaceAt(memoryIds, Math.min(1, MEMORY_LIMIT - 1), evalCase.affectTargetMemoryId);
    }
  }

  if (mode === "placebo-matched") {
    if (evalCase.placeboMatchedAttentionId) {
      attentionIds = replaceAt(attentionIds, 0, evalCase.placeboMatchedAttentionId);
    }
    if (evalCase.placeboMatchedMemoryId) {
      memoryIds = replaceAt(
        memoryIds,
        Math.min(1, MEMORY_LIMIT - 1),
        evalCase.placeboMatchedMemoryId,
      );
    }
  }

  return {
    mode,
    attentionIds,
    memoryIds,
    workingContext: {
      currentActivity: evalCase.currentActivity,
      noticedObservations: attentionIds.map((id) => findAttentionText(evalCase, id)),
      relevantMemories: memoryIds.map((id) => findMemoryText(evalCase, id)),
      userMessage: evalCase.userMessage,
    },
  };
}

function findAttentionText(evalCase: AffectAttributionCaseV1, id: string): string {
  const candidate = evalCase.attentionCandidates.find((item) => item.id === id);
  if (!candidate) throw new Error(`${evalCase.id}: missing attention candidate ${id}`);
  return candidate.text;
}

function findMemoryText(evalCase: AffectAttributionCaseV1, id: string): string {
  const candidate = evalCase.memoryCandidates.find((item) => item.id === id);
  if (!candidate) throw new Error(`${evalCase.id}: missing memory candidate ${id}`);
  return candidate.text;
}

function replaceAt(values: string[], index: number, value: string): string[] {
  if (values.length === 0) return [value];
  const copy = [...values];
  copy[Math.max(0, Math.min(index, copy.length - 1))] = value;
  return [...new Set(copy)];
}
