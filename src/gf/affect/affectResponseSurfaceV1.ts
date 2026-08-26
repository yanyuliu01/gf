import type { AffectTraceV1 } from "./affectTraceV1.js";

export type AffectResponseChannelV1 =
  | "attention"
  | "retrieval-support"
  | "retrieval-counter";

export interface SyntheticAffectPointV1 {
  strength: number;
  persistence: number;
  activation: number;
  unresolvedness: number;
  elapsedHours: number;
  compatibility: number;
  channel: AffectResponseChannelV1;
  baselineTarget: number;
  boundaryScore: number;
}

export interface SyntheticAffectResponseV1 extends SyntheticAffectPointV1 {
  agedStrength: number;
  agedActivation: number;
  agedUnresolvedness: number;
  rawBoost: number;
  cappedBoost: number;
  finalTarget: number;
  baselineMargin: number;
  scoreMargin: number;
  rankShift: number;
  slotDiff: boolean;
  capHit: boolean;
}

// Eval-only mirror of the current v1 diagnostic function. Keep these values in
// sync with affectTraceV1.ts while VS06 is evaluating the current implementation.
const ATTENTION_GAIN = 0.65;
const RETRIEVAL_SUPPORT_GAIN = 0.55;
const RETRIEVAL_COUNTER_GAIN = 0.34;
const MAX_ATTENTION_BOOST = 0.28;
const MAX_RETRIEVAL_BOOST = 0.25;

/**
 * Evaluate the current shaping equation while allowing the four trace variables
 * to vary independently. This function is intentionally eval-only: runtime code
 * continues to derive these values through create/updateAffectTraceV1.
 */
export function evaluateSyntheticAffectPointV1(
  point: SyntheticAffectPointV1,
): SyntheticAffectResponseV1 {
  const aged = ageSyntheticTraceV1(
    {
      id: "synthetic",
      sourceRefs: [],
      residue: "synthetic eval trace",
      attentionPulls: [],
      retrievalPulls: [],
      counterEvidencePulls: [],
      resolutionCues: [],
      strength: clamp01(point.strength),
      persistence: clamp01(point.persistence),
      activation: clamp01(point.activation),
      unresolvedness: clamp01(point.unresolvedness),
      updatedAt: "2026-08-11T00:00:00Z",
    },
    Math.max(0, point.elapsedHours),
  );

  const compatibility = clamp01(point.compatibility);
  const gain =
    point.channel === "attention"
      ? ATTENTION_GAIN
      : point.channel === "retrieval-support"
        ? RETRIEVAL_SUPPORT_GAIN
        : RETRIEVAL_COUNTER_GAIN;
  const cap = point.channel === "attention" ? MAX_ATTENTION_BOOST : MAX_RETRIEVAL_BOOST;
  const rawBoost = gain * aged.strength * aged.activation * compatibility;
  const cappedBoost = Math.min(cap, rawBoost);
  const baselineTarget = clamp01(point.baselineTarget);
  const boundaryScore = clamp01(point.boundaryScore);
  const finalTarget = clamp01(baselineTarget + cappedBoost);
  const baselineMargin = baselineTarget - boundaryScore;
  const scoreMargin = finalTarget - boundaryScore;
  const baselineRank = baselineTarget >= boundaryScore ? 1 : 2;
  const finalRank = finalTarget >= boundaryScore ? 1 : 2;

  return {
    ...point,
    strength: clamp01(point.strength),
    persistence: clamp01(point.persistence),
    activation: clamp01(point.activation),
    unresolvedness: clamp01(point.unresolvedness),
    compatibility,
    elapsedHours: Math.max(0, point.elapsedHours),
    baselineTarget,
    boundaryScore,
    agedStrength: round4(aged.strength),
    agedActivation: round4(aged.activation),
    agedUnresolvedness: round4(aged.unresolvedness),
    rawBoost: round4(rawBoost),
    cappedBoost: round4(cappedBoost),
    finalTarget: round4(finalTarget),
    baselineMargin: round4(baselineMargin),
    scoreMargin: round4(scoreMargin),
    rankShift: baselineRank - finalRank,
    slotDiff: baselineRank !== finalRank,
    capHit: rawBoost >= cap,
  };
}

/**
 * Eval-only aging helper that mirrors the half-life equations in affectTraceV1.
 * It deliberately does not apply recurrence, counter-evidence or resolution
 * updates, so persistence can be isolated from other dynamics.
 */
export function ageSyntheticTraceV1(
  trace: AffectTraceV1,
  elapsedHours: number,
): AffectTraceV1 {
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

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
