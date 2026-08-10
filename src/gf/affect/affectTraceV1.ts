export interface AffectAppraisalV1 {
  residue: string;
  attentionPulls: string[];
  retrievalPulls: string[];
  counterEvidencePulls: string[];
  resolutionCues: string[];
  flags: {
    unresolved: boolean;
    repeatedPattern: boolean;
    meaningfulConsequence: boolean;
    directPersonalRelevance: boolean;
  };
}

export interface AffectTraceV1 {
  id: string;
  sourceRefs: string[];
  residue: string;
  attentionPulls: string[];
  retrievalPulls: string[];
  counterEvidencePulls: string[];
  resolutionCues: string[];
  strength: number;
  persistence: number;
  activation: number;
  unresolvedness: number;
  updatedAt: string;
}

export interface AttentionCandidateV1 {
  id: string;
  text: string;
  baselineSalience: number;
}

export interface ShapedAttentionCandidateV1 extends AttentionCandidateV1 {
  affectBoost: number;
  finalSalience: number;
  matchedTraceIds: string[];
}

export interface MemoryCandidateV1 {
  id: string;
  text: string;
  baselineScore: number;
}

export interface ShapedMemoryCandidateV1 extends MemoryCandidateV1 {
  affectBoost: number;
  finalScore: number;
  affectRole: "supporting" | "counter" | "none";
  matchedTraceIds: string[];
}

const MAX_ATTENTION_BOOST = 0.28;
const MAX_RETRIEVAL_BOOST = 0.25;

export function createAffectTraceV1(input: {
  id: string;
  sourceRefs: string[];
  appraisal: AffectAppraisalV1;
  currentCue: string;
  now: string;
}): AffectTraceV1 {
  const { appraisal } = input;
  const sourceBonus = Math.min(0.16, Math.max(0, input.sourceRefs.length - 1) * 0.08);

  const strength = clamp01(
    0.28 +
      sourceBonus +
      (appraisal.flags.meaningfulConsequence ? 0.24 : 0) +
      (appraisal.flags.repeatedPattern ? 0.12 : 0) +
      (appraisal.flags.directPersonalRelevance ? 0.1 : 0),
  );

  const persistence = clamp01(
    0.18 +
      (appraisal.flags.unresolved ? 0.24 : 0) +
      (appraisal.flags.repeatedPattern ? 0.2 : 0) +
      (appraisal.flags.meaningfulConsequence ? 0.16 : 0) +
      (appraisal.flags.directPersonalRelevance ? 0.08 : 0),
  );

  const unresolvedness = appraisal.flags.unresolved ? 0.72 : 0.18;
  const cueCompatibility = semanticCompatibility(input.currentCue, [
    ...appraisal.attentionPulls,
    ...appraisal.retrievalPulls,
  ]);
  const activation = clamp01(cueCompatibility * (0.35 + 0.65 * strength));

  return {
    id: input.id,
    sourceRefs: [...input.sourceRefs],
    residue: appraisal.residue,
    attentionPulls: [...appraisal.attentionPulls],
    retrievalPulls: [...appraisal.retrievalPulls],
    counterEvidencePulls: [...appraisal.counterEvidencePulls],
    resolutionCues: [...appraisal.resolutionCues],
    strength,
    persistence,
    activation,
    unresolvedness,
    updatedAt: input.now,
  };
}

export function updateAffectTraceV1(input: {
  trace: AffectTraceV1;
  cue: string;
  now: string;
}): AffectTraceV1 {
  const elapsedHours = Math.max(
    0,
    (Date.parse(input.now) - Date.parse(input.trace.updatedAt)) / (60 * 60 * 1000),
  );
  const aged = ageTrace(input.trace, elapsedHours);

  const attentionMatch = semanticCompatibility(input.cue, aged.attentionPulls);
  const retrievalMatch = semanticCompatibility(input.cue, aged.retrievalPulls);
  const counterMatch = semanticCompatibility(input.cue, aged.counterEvidencePulls);
  const resolutionMatch = semanticCompatibility(input.cue, aged.resolutionCues);
  const recurrenceMatch = Math.max(attentionMatch, retrievalMatch);

  const strength = clamp01(
    aged.strength +
      0.08 * recurrenceMatch * (1 - aged.strength) -
      0.2 * resolutionMatch * aged.strength,
  );
  const unresolvedness = clamp01(
    aged.unresolvedness +
      0.12 * recurrenceMatch * (1 - aged.unresolvedness) -
      0.62 * resolutionMatch * aged.unresolvedness,
  );
  const activation = clamp01(
    0.18 * aged.activation +
      recurrenceMatch * (0.35 + 0.5 * strength) -
      0.22 * counterMatch -
      0.58 * resolutionMatch,
  );

  return {
    ...aged,
    strength,
    unresolvedness,
    activation,
    updatedAt: input.now,
  };
}

export function shapeAttentionV1(
  candidates: AttentionCandidateV1[],
  traces: AffectTraceV1[],
): ShapedAttentionCandidateV1[] {
  return candidates
    .map((candidate) => {
      const contributions = traces.map((trace) => {
        const compatibility = semanticCompatibility(candidate.text, trace.attentionPulls);
        const contribution = 0.34 * trace.strength * trace.activation * compatibility;
        return { traceId: trace.id, contribution };
      });
      const affectBoost = Math.min(
        MAX_ATTENTION_BOOST,
        contributions.reduce((sum, item) => sum + item.contribution, 0),
      );
      return {
        ...candidate,
        affectBoost: round4(affectBoost),
        finalSalience: round4(clamp01(candidate.baselineSalience + affectBoost)),
        matchedTraceIds: contributions
          .filter((item) => item.contribution >= 0.015)
          .map((item) => item.traceId),
      };
    })
    .sort((a, b) => b.finalSalience - a.finalSalience);
}

export function shapeRetrievalV1(
  memories: MemoryCandidateV1[],
  traces: AffectTraceV1[],
): ShapedMemoryCandidateV1[] {
  return memories
    .map((memory) => {
      let supportTotal = 0;
      let counterTotal = 0;
      const matchedTraceIds = new Set<string>();

      for (const trace of traces) {
        const support = semanticCompatibility(memory.text, trace.retrievalPulls);
        const counter = semanticCompatibility(memory.text, trace.counterEvidencePulls);
        const traceWeight = trace.strength * trace.activation;
        supportTotal += 0.25 * traceWeight * support;
        counterTotal += 0.16 * traceWeight * counter;
        if (support >= 0.12 || counter >= 0.12) matchedTraceIds.add(trace.id);
      }

      const affectBoost = Math.min(MAX_RETRIEVAL_BOOST, supportTotal + counterTotal);
      const affectRole =
        supportTotal === 0 && counterTotal === 0
          ? "none"
          : counterTotal > supportTotal
            ? "counter"
            : "supporting";

      return {
        ...memory,
        affectBoost: round4(affectBoost),
        finalScore: round4(clamp01(memory.baselineScore + affectBoost)),
        affectRole,
        matchedTraceIds: [...matchedTraceIds],
      } satisfies ShapedMemoryCandidateV1;
    })
    .sort((a, b) => b.finalScore - a.finalScore);
}

export function selectWorkingMemoriesV1(
  ranked: ShapedMemoryCandidateV1[],
  limit = 4,
): ShapedMemoryCandidateV1[] {
  if (limit <= 0) return [];
  const selected = ranked.slice(0, limit);
  const bestCounter = ranked.find((item) => item.affectRole === "counter" && item.affectBoost >= 0.015);
  if (!bestCounter || selected.some((item) => item.id === bestCounter.id)) return selected;
  if (selected.length < limit) return [...selected, bestCounter];
  return [...selected.slice(0, Math.max(0, limit - 1)), bestCounter];
}

export function semanticCompatibility(text: string, cues: string[]): number {
  if (!text.trim() || cues.length === 0) return 0;
  return round4(Math.max(...cues.map((cue) => pairCompatibility(text, cue)), 0));
}

function ageTrace(trace: AffectTraceV1, elapsedHours: number): AffectTraceV1 {
  if (!Number.isFinite(elapsedHours) || elapsedHours <= 0) return { ...trace };
  const strengthHalfLife = 8 + 96 * trace.persistence;
  const activationHalfLife = 1.5 + 12 * trace.persistence;
  const unresolvedHalfLife = 48 + 240 * trace.persistence;

  return {
    ...trace,
    strength: round4(trace.strength * Math.pow(0.5, elapsedHours / strengthHalfLife)),
    activation: round4(trace.activation * Math.pow(0.5, elapsedHours / activationHalfLife)),
    unresolvedness: round4(
      trace.unresolvedness * Math.pow(0.5, elapsedHours / unresolvedHalfLife),
    ),
  };
}

function pairCompatibility(a: string, b: string): number {
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return 0;
  if (left.includes(right) || right.includes(left)) {
    return Math.min(1, 0.72 + 0.28 * Math.min(left.length, right.length) / Math.max(left.length, right.length));
  }

  const leftBigrams = ngrams(left, 2);
  const rightBigrams = ngrams(right, 2);
  const bigramDice = dice(leftBigrams, rightBigrams);
  const leftTokens = tokenSet(a);
  const rightTokens = tokenSet(b);
  const tokenJaccard = jaccard(leftTokens, rightTokens);
  return clamp01(0.7 * bigramDice + 0.3 * tokenJaccard);
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .trim();
}

function ngrams(value: string, n: number): Set<string> {
  const chars = Array.from(value);
  if (chars.length <= n) return new Set(chars.length ? [chars.join("")] : []);
  const out = new Set<string>();
  for (let index = 0; index <= chars.length - n; index += 1) {
    out.add(chars.slice(index, index + n).join(""));
  }
  return out;
}

function tokenSet(value: string): Set<string> {
  const latin = value.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  const han = Array.from(normalize(value)).filter((char) => /\p{Script=Han}/u.test(char));
  return new Set([...latin, ...han]);
}

function dice(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const item of left) if (right.has(item)) overlap += 1;
  return (2 * overlap) / (left.size + right.size);
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const item of left) if (right.has(item)) overlap += 1;
  return overlap / (left.size + right.size - overlap);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
