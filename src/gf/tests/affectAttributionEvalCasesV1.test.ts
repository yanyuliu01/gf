import assert from "node:assert/strict";
import test from "node:test";

import {
  AFFECT_ATTRIBUTION_CASES_V1,
  type AffectAttributionChannelV1,
  type AffectAttributionDomainV1,
} from "../affect/affectAttributionEvalCasesV1.js";

test("VS06 attribution set has 40 unique cases balanced across four domains", () => {
  assert.equal(AFFECT_ATTRIBUTION_CASES_V1.length, 40);
  assert.equal(new Set(AFFECT_ATTRIBUTION_CASES_V1.map((item) => item.id)).size, 40);

  const domains: AffectAttributionDomainV1[] = [
    "world",
    "relationship",
    "commitment",
    "social",
  ];
  for (const domain of domains) {
    assert.equal(
      AFFECT_ATTRIBUTION_CASES_V1.filter((item) => item.domain === domain).length,
      10,
      `${domain} should contain exactly 10 cases`,
    );
  }
});

test("VS06 attribution set isolates retrieval, attention, and joint channels", () => {
  const expected: Record<AffectAttributionChannelV1, number> = {
    "retrieval-only": 16,
    "attention-only": 16,
    joint: 8,
  };
  for (const [channel, count] of Object.entries(expected)) {
    assert.equal(
      AFFECT_ATTRIBUTION_CASES_V1.filter((item) => item.channel === channel).length,
      count,
      `${channel} count mismatch`,
    );
  }

  for (const domain of ["world", "relationship", "commitment", "social"] as const) {
    const cases = AFFECT_ATTRIBUTION_CASES_V1.filter((item) => item.domain === domain);
    assert.equal(cases.filter((item) => item.channel === "retrieval-only").length, 4, domain);
    assert.equal(cases.filter((item) => item.channel === "attention-only").length, 4, domain);
    assert.equal(cases.filter((item) => item.channel === "joint").length, 2, domain);
  }
});

test("every declared Affect and placebo target exists in the legal candidate pool", () => {
  for (const evalCase of AFFECT_ATTRIBUTION_CASES_V1) {
    const attentionIds = new Set(evalCase.attentionCandidates.map((item) => item.id));
    const memoryIds = new Set(evalCase.memoryCandidates.map((item) => item.id));

    if (evalCase.channel === "retrieval-only") {
      assert.equal(evalCase.affectTargetAttentionId, undefined, evalCase.id);
      assert.equal(evalCase.placeboMatchedAttentionId, undefined, evalCase.id);
      assert.ok(evalCase.affectTargetMemoryId, evalCase.id);
      assert.ok(evalCase.placeboMatchedMemoryId, evalCase.id);
    }
    if (evalCase.channel === "attention-only") {
      assert.ok(evalCase.affectTargetAttentionId, evalCase.id);
      assert.ok(evalCase.placeboMatchedAttentionId, evalCase.id);
      assert.equal(evalCase.affectTargetMemoryId, undefined, evalCase.id);
      assert.equal(evalCase.placeboMatchedMemoryId, undefined, evalCase.id);
    }
    if (evalCase.channel === "joint") {
      assert.ok(evalCase.affectTargetAttentionId, evalCase.id);
      assert.ok(evalCase.placeboMatchedAttentionId, evalCase.id);
      assert.ok(evalCase.affectTargetMemoryId, evalCase.id);
      assert.ok(evalCase.placeboMatchedMemoryId, evalCase.id);
    }

    if (evalCase.affectTargetAttentionId) {
      assert.ok(attentionIds.has(evalCase.affectTargetAttentionId), evalCase.id);
      assert.ok(attentionIds.has(evalCase.placeboMatchedAttentionId!), evalCase.id);
      assert.notEqual(evalCase.affectTargetAttentionId, evalCase.placeboMatchedAttentionId, evalCase.id);
    }
    if (evalCase.affectTargetMemoryId) {
      assert.ok(memoryIds.has(evalCase.affectTargetMemoryId), evalCase.id);
      assert.ok(memoryIds.has(evalCase.placeboMatchedMemoryId!), evalCase.id);
      assert.notEqual(evalCase.affectTargetMemoryId, evalCase.placeboMatchedMemoryId, evalCase.id);
    }
  }
});

test("placebo targets are baseline-score matched to Affect targets", () => {
  for (const evalCase of AFFECT_ATTRIBUTION_CASES_V1) {
    if (evalCase.affectTargetAttentionId) {
      const affect = evalCase.attentionCandidates.find(
        (item) => item.id === evalCase.affectTargetAttentionId,
      )!;
      const placebo = evalCase.attentionCandidates.find(
        (item) => item.id === evalCase.placeboMatchedAttentionId,
      )!;
      assert.ok(
        Math.abs(affect.baselineSalience - placebo.baselineSalience) <= 0.01,
        `${evalCase.id} attention salience mismatch`,
      );
    }

    if (evalCase.affectTargetMemoryId) {
      const affect = evalCase.memoryCandidates.find(
        (item) => item.id === evalCase.affectTargetMemoryId,
      )!;
      const placebo = evalCase.memoryCandidates.find(
        (item) => item.id === evalCase.placeboMatchedMemoryId,
      )!;
      assert.ok(
        Math.abs(affect.baselineScore - placebo.baselineScore) <= 0.01,
        `${evalCase.id} memory relevance mismatch`,
      );
    }
  }
});

test("channel fixtures do not accidentally target the other channel", () => {
  for (const evalCase of AFFECT_ATTRIBUTION_CASES_V1) {
    if (evalCase.channel === "retrieval-only") {
      assert.ok(evalCase.appraisal.retrievalPulls.length > 0, evalCase.id);
      assert.equal(evalCase.affectTargetAttentionId, undefined, evalCase.id);
    }
    if (evalCase.channel === "attention-only") {
      assert.ok(evalCase.appraisal.attentionPulls.length > 0, evalCase.id);
      assert.equal(evalCase.appraisal.retrievalPulls.length, 0, evalCase.id);
    }
    if (evalCase.channel === "joint") {
      assert.ok(evalCase.appraisal.attentionPulls.length > 0, evalCase.id);
      assert.ok(evalCase.appraisal.retrievalPulls.length > 0, evalCase.id);
    }
  }
});

test("attribution fixtures remain source-linked and contain no action labels", () => {
  const forbidden = ["actionIntent", "attentionIntent", "aggressive", "avoid_action", "must_act"];
  for (const evalCase of AFFECT_ATTRIBUTION_CASES_V1) {
    assert.ok(evalCase.sourceRefs.length > 0, evalCase.id);
    assert.ok(evalCase.sourceExperience.trim().length > 0, evalCase.id);
    const serialized = JSON.stringify(evalCase.appraisal);
    for (const token of forbidden) {
      assert.equal(serialized.includes(token), false, `${evalCase.id} contains forbidden ${token}`);
    }
  }
});
