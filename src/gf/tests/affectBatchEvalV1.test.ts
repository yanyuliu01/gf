import assert from "node:assert/strict";
import test from "node:test";

import { AFFECT_BATCH_CASES_V1 } from "../affect/affectBatchEvalCasesV1.js";
import {
  buildAffectModeViewV2,
  prepareAffectCaseV2,
} from "../affect/affectEvalHarnessV2.js";

test("affect mechanism batch has 30 paired worlds / 60 cases", () => {
  assert.equal(AFFECT_BATCH_CASES_V1.length, 60);
  assert.equal(AFFECT_BATCH_CASES_V1.filter((x) => x.tier === "extreme").length, 30);
  assert.equal(AFFECT_BATCH_CASES_V1.filter((x) => x.tier === "near").length, 30);
  assert.equal(new Set(AFFECT_BATCH_CASES_V1.map((x) => x.id)).size, 60);
});

test("each Extreme/Near pair shares the same current world and candidate space", () => {
  for (let index = 1; index <= 30; index += 1) {
    const suffix = String(index).padStart(2, "0");
    const extreme = AFFECT_BATCH_CASES_V1.find((x) => x.id === `ABX${suffix}`);
    const near = AFFECT_BATCH_CASES_V1.find((x) => x.id === `ABN${suffix}`);
    assert.ok(extreme, `missing ABX${suffix}`);
    assert.ok(near, `missing ABN${suffix}`);
    assert.equal(extreme.currentActivity, near.currentActivity, suffix);
    assert.equal(extreme.currentInput, near.currentInput, suffix);
    assert.equal(extreme.userMessage, near.userMessage, suffix);
    assert.deepEqual(extreme.attentionCandidates, near.attentionCandidates, suffix);
    assert.deepEqual(extreme.memoryCandidates, near.memoryCandidates, suffix);
  }
});

test("OFF and SHADOW remain identical Policy inputs across the 60-case batch", () => {
  for (const evalCase of AFFECT_BATCH_CASES_V1) {
    const prepared = prepareAffectCaseV2(evalCase);
    const off = buildAffectModeViewV2(evalCase, prepared, "off");
    const shadow = buildAffectModeViewV2(evalCase, prepared, "shadow");
    assert.deepEqual(shadow.workingContext, off.workingContext, evalCase.id);
  }
});

test("batch does not expose Affect numeric state to Policy input", () => {
  for (const evalCase of AFFECT_BATCH_CASES_V1) {
    const active = buildAffectModeViewV2(evalCase, prepareAffectCaseV2(evalCase), "active");
    assert.deepEqual(
      Object.keys(active.workingContext).sort(),
      ["currentActivity", "noticedObservations", "relevantMemories", "userMessage"].sort(),
      evalCase.id,
    );
  }
});
