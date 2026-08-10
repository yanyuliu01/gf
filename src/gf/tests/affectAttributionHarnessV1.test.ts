import assert from "node:assert/strict";
import test from "node:test";

import { AFFECT_ATTRIBUTION_CASES_V1 } from "../affect/affectAttributionEvalCasesV1.js";
import { buildAffectAttributionViewV1 } from "../affect/affectAttributionHarnessV1.js";

test("OFF and SHADOW are byte-identical Working Self inputs", () => {
  for (const evalCase of AFFECT_ATTRIBUTION_CASES_V1) {
    const off = buildAffectAttributionViewV1(evalCase, "off");
    const shadow = buildAffectAttributionViewV1(evalCase, "shadow");
    assert.deepEqual(shadow.workingContext, off.workingContext, evalCase.id);
    assert.deepEqual(shadow.attentionIds, off.attentionIds, evalCase.id);
    assert.deepEqual(shadow.memoryIds, off.memoryIds, evalCase.id);
  }
});

test("ACTIVE and PLACEBO use the same slot capacity", () => {
  for (const evalCase of AFFECT_ATTRIBUTION_CASES_V1) {
    const active = buildAffectAttributionViewV1(evalCase, "active");
    const placebo = buildAffectAttributionViewV1(evalCase, "placebo-matched");
    assert.equal(active.attentionIds.length, placebo.attentionIds.length, evalCase.id);
    assert.equal(active.memoryIds.length, placebo.memoryIds.length, evalCase.id);
    assert.equal(active.workingContext.noticedObservations.length, 1, evalCase.id);
    assert.equal(active.workingContext.relevantMemories.length, 2, evalCase.id);
  }
});

test("ACTIVE inserts only the declared Affect target channels", () => {
  for (const evalCase of AFFECT_ATTRIBUTION_CASES_V1) {
    const off = buildAffectAttributionViewV1(evalCase, "off");
    const active = buildAffectAttributionViewV1(evalCase, "active");

    if (evalCase.affectTargetAttentionId) {
      assert.equal(active.attentionIds[0], evalCase.affectTargetAttentionId, evalCase.id);
      assert.notDeepEqual(active.attentionIds, off.attentionIds, evalCase.id);
    } else {
      assert.deepEqual(active.attentionIds, off.attentionIds, evalCase.id);
    }

    if (evalCase.affectTargetMemoryId) {
      assert.ok(active.memoryIds.includes(evalCase.affectTargetMemoryId), evalCase.id);
      assert.notDeepEqual(active.memoryIds, off.memoryIds, evalCase.id);
    } else {
      assert.deepEqual(active.memoryIds, off.memoryIds, evalCase.id);
    }
  }
});

test("PLACEBO inserts only the declared matched control channels", () => {
  for (const evalCase of AFFECT_ATTRIBUTION_CASES_V1) {
    const off = buildAffectAttributionViewV1(evalCase, "off");
    const placebo = buildAffectAttributionViewV1(evalCase, "placebo-matched");

    if (evalCase.placeboMatchedAttentionId) {
      assert.equal(placebo.attentionIds[0], evalCase.placeboMatchedAttentionId, evalCase.id);
      assert.notDeepEqual(placebo.attentionIds, off.attentionIds, evalCase.id);
    } else {
      assert.deepEqual(placebo.attentionIds, off.attentionIds, evalCase.id);
    }

    if (evalCase.placeboMatchedMemoryId) {
      assert.ok(placebo.memoryIds.includes(evalCase.placeboMatchedMemoryId), evalCase.id);
      assert.notDeepEqual(placebo.memoryIds, off.memoryIds, evalCase.id);
    } else {
      assert.deepEqual(placebo.memoryIds, off.memoryIds, evalCase.id);
    }
  }
});

test("Policy input never contains Affect labels, scores, target ids, or mode", () => {
  for (const evalCase of AFFECT_ATTRIBUTION_CASES_V1) {
    for (const mode of ["off", "shadow", "active", "placebo-matched"] as const) {
      const view = buildAffectAttributionViewV1(evalCase, mode);
      assert.deepEqual(
        Object.keys(view.workingContext).sort(),
        ["currentActivity", "noticedObservations", "relevantMemories", "userMessage"].sort(),
        `${evalCase.id}/${mode}`,
      );
      const serialized = JSON.stringify(view.workingContext);
      for (const forbidden of [
        "AffectTrace",
        "strength",
        "persistence",
        "activation",
        "unresolvedness",
        "placebo-matched",
        "attention-affect",
        "memory-affect",
      ]) {
        assert.equal(
          serialized.includes(forbidden),
          false,
          `${evalCase.id}/${mode} leaked ${forbidden}`,
        );
      }
    }
  }
});
