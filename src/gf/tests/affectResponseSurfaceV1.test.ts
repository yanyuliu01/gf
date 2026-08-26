import assert from "node:assert/strict";
import test from "node:test";

import { evaluateSyntheticAffectPointV1 } from "../affect/affectResponseSurfaceV1.js";

const base = {
  strength: 0.8,
  persistence: 0.5,
  activation: 0.8,
  unresolvedness: 0.5,
  elapsedHours: 0,
  compatibility: 0.5,
  channel: "attention" as const,
  baselineTarget: 0.4,
  boundaryScore: 0.6,
};

test("synthetic response surface exposes continuous score margin before slot crossing", () => {
  const low = evaluateSyntheticAffectPointV1({ ...base, compatibility: 0.15 });
  const high = evaluateSyntheticAffectPointV1({ ...base, compatibility: 0.85 });

  assert.ok(high.rawBoost > low.rawBoost, `expected high compatibility boost > low; ${high.rawBoost} vs ${low.rawBoost}`);
  assert.ok(high.scoreMargin > low.scoreMargin, `expected high compatibility margin > low; ${high.scoreMargin} vs ${low.scoreMargin}`);
});

test("persistence is inert at elapsed=0 when synthetic trace variables are independently injected", () => {
  const low = evaluateSyntheticAffectPointV1({ ...base, persistence: 0.1 });
  const high = evaluateSyntheticAffectPointV1({ ...base, persistence: 0.9 });

  assert.equal(low.rawBoost, high.rawBoost);
  assert.equal(low.scoreMargin, high.scoreMargin);
});

test("persistence changes retention after elapsed time", () => {
  const low = evaluateSyntheticAffectPointV1({ ...base, persistence: 0.1, elapsedHours: 72 });
  const high = evaluateSyntheticAffectPointV1({ ...base, persistence: 0.9, elapsedHours: 72 });

  assert.ok(high.agedStrength > low.agedStrength, `expected high persistence strength retention; ${high.agedStrength} vs ${low.agedStrength}`);
  assert.ok(high.agedActivation > low.agedActivation, `expected high persistence activation retention; ${high.agedActivation} vs ${low.agedActivation}`);
  assert.ok(high.scoreMargin > low.scoreMargin, `expected high persistence margin > low; ${high.scoreMargin} vs ${low.scoreMargin}`);
});

test("unresolvedness has no direct shaping path once activation is independently fixed", () => {
  const low = evaluateSyntheticAffectPointV1({ ...base, unresolvedness: 0.05 });
  const high = evaluateSyntheticAffectPointV1({ ...base, unresolvedness: 0.95 });

  assert.equal(low.rawBoost, high.rawBoost);
  assert.equal(low.scoreMargin, high.scoreMargin);
});

test("attention cap only clips points whose raw boost reaches it", () => {
  const low = evaluateSyntheticAffectPointV1({
    ...base,
    strength: 0.85,
    activation: 0.45,
    compatibility: 0.2,
  });
  const high = evaluateSyntheticAffectPointV1({
    ...base,
    strength: 0.95,
    activation: 0.95,
    compatibility: 0.95,
  });

  assert.equal(low.capHit, false);
  assert.equal(high.capHit, true);
  assert.ok(low.cappedBoost < 0.28);
  assert.equal(high.cappedBoost, 0.28);
});
