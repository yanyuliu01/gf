import assert from "node:assert/strict";
import test from "node:test";

import { AFFECT_ATTRIBUTION_CASES_V1 } from "../affect/affectAttributionEvalCasesV1.js";
import { AFFECT_ATTRIBUTION_CASES_V2 } from "../affect/affectAttributionEvalCasesV2.js";
import { buildAffectAttributionViewV1 } from "../affect/affectAttributionHarnessV1.js";

test("VS06 B1 v2 preserves the same 40-case structure and adds expected trajectories", () => {
  assert.equal(AFFECT_ATTRIBUTION_CASES_V2.length, 40);
  assert.deepEqual(
    AFFECT_ATTRIBUTION_CASES_V2.map((item) => item.id),
    AFFECT_ATTRIBUTION_CASES_V1.map((item) => item.id),
  );
  assert.ok(
    AFFECT_ATTRIBUTION_CASES_V2.every((item) => item.expectedTrajectory.trim().length > 0),
  );
});

test("v2 changes only placebo attention text for attention/joint cases", () => {
  for (const v2 of AFFECT_ATTRIBUTION_CASES_V2) {
    const v1 = AFFECT_ATTRIBUTION_CASES_V1.find((item) => item.id === v2.id);
    assert.ok(v1, v2.id);

    assert.equal(v2.currentActivity, v1.currentActivity, v2.id);
    assert.equal(v2.currentInput, v1.currentInput, v2.id);
    assert.equal(v2.userMessage, v1.userMessage, v2.id);
    assert.deepEqual(v2.memoryCandidates, v1.memoryCandidates, v2.id);

    const v1Attention = new Map(v1.attentionCandidates.map((item) => [item.id, item]));
    for (const candidate of v2.attentionCandidates) {
      const before = v1Attention.get(candidate.id);
      assert.ok(before, `${v2.id}:${candidate.id}`);
      assert.equal(candidate.baselineSalience, before.baselineSalience, v2.id);
      if (candidate.id !== "attention-placebo") {
        assert.equal(candidate.text, before.text, `${v2.id}:${candidate.id}`);
      }
    }
  }
});

test("OFF/SHADOW remain identical and ACTIVE/PLACEBO have equal slot capacity", () => {
  for (const evalCase of AFFECT_ATTRIBUTION_CASES_V2) {
    const off = buildAffectAttributionViewV1(evalCase, "off");
    const shadow = buildAffectAttributionViewV1(evalCase, "shadow");
    const active = buildAffectAttributionViewV1(evalCase, "active");
    const placebo = buildAffectAttributionViewV1(evalCase, "placebo-matched");

    assert.deepEqual(shadow.workingContext, off.workingContext, evalCase.id);
    assert.equal(active.attentionIds.length, placebo.attentionIds.length, evalCase.id);
    assert.equal(active.memoryIds.length, placebo.memoryIds.length, evalCase.id);
  }
});

test("attention placebo lexical relevance is not systematically biased toward ACTIVE", () => {
  const cases = AFFECT_ATTRIBUTION_CASES_V2.filter(
    (item) => item.channel !== "retrieval-only",
  );
  assert.equal(cases.length, 24);

  const signedGaps = cases.map((evalCase) => {
    const affect = evalCase.attentionCandidates.find(
      (item) => item.id === evalCase.affectTargetAttentionId,
    );
    const placebo = evalCase.attentionCandidates.find(
      (item) => item.id === evalCase.placeboMatchedAttentionId,
    );
    assert.ok(affect, `${evalCase.id}: missing affect attention`);
    assert.ok(placebo, `${evalCase.id}: missing placebo attention`);
    return (
      bigramDice(evalCase.currentInput, affect.text) -
      bigramDice(evalCase.currentInput, placebo.text)
    );
  });

  const meanGap = mean(signedGaps);
  const activeCloser = signedGaps.filter((value) => value > 0).length;
  const placeboCloser = signedGaps.filter((value) => value < 0).length;

  assert.ok(
    Math.abs(meanGap) <= 0.03,
    `expected near-zero mean lexical relevance gap; mean=${meanGap}`,
  );
  assert.ok(
    activeCloser >= 8 && activeCloser <= 16,
    `expected no systematic ACTIVE lexical advantage; activeCloser=${activeCloser}, placeboCloser=${placeboCloser}`,
  );
});

function bigramDice(left: string, right: string): number {
  const a = bigrams(normalize(left));
  const b = bigrams(normalize(right));
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const item of a) if (b.has(item)) overlap += 1;
  return (2 * overlap) / (a.size + b.size);
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .trim();
}

function bigrams(value: string): Set<string> {
  const chars = Array.from(value);
  if (chars.length === 0) return new Set();
  if (chars.length === 1) return new Set([chars[0]]);
  const out = new Set<string>();
  for (let index = 0; index < chars.length - 1; index += 1) {
    out.add(`${chars[index]}${chars[index + 1]}`);
  }
  return out;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
