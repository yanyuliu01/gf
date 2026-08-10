import assert from "node:assert/strict";
import test from "node:test";

import { AFFECT_EVAL_CASES_V1 } from "../affect/affectEvalCasesV1.js";
import {
  buildAffectModeViewV1,
  prepareAffectCaseV1,
  rankingChangedV1,
} from "../affect/affectEvalHarnessV1.js";
import { updateAffectTraceV1 } from "../affect/affectTraceV1.js";

test("Affect v1 eval has balanced extreme and near cases", () => {
  assert.equal(AFFECT_EVAL_CASES_V1.length, 12);
  assert.equal(AFFECT_EVAL_CASES_V1.filter((item) => item.tier === "extreme").length, 6);
  assert.equal(AFFECT_EVAL_CASES_V1.filter((item) => item.tier === "near").length, 6);
});

test("OFF and SHADOW give Policy exactly the same Working Self", () => {
  for (const evalCase of AFFECT_EVAL_CASES_V1) {
    const prepared = prepareAffectCaseV1(evalCase);
    const off = buildAffectModeViewV1(evalCase, prepared, "off");
    const shadow = buildAffectModeViewV1(evalCase, prepared, "shadow");
    assert.deepEqual(shadow.workingContext, off.workingContext, evalCase.id);
    assert.equal(off.affectApplied, false);
    assert.equal(shadow.affectApplied, false);
  }
});

test("Affect numeric state never appears as a Policy input field", () => {
  for (const evalCase of AFFECT_EVAL_CASES_V1) {
    const active = buildAffectModeViewV1(evalCase, prepareAffectCaseV1(evalCase), "active");
    const keys = Object.keys(active.workingContext);
    assert.deepEqual(
      keys.sort(),
      ["currentActivity", "currentInput", "noticedObservations", "relevantMemories", "userMessage"].sort(),
      evalCase.id,
    );
  }
});

test("extreme cases produce stronger traces than near cases on average", () => {
  const traces = AFFECT_EVAL_CASES_V1.map((evalCase) => ({
    tier: evalCase.tier,
    trace: prepareAffectCaseV1(evalCase).trace,
  }));
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const extremeStrength = mean(
    traces.filter((item) => item.tier === "extreme").map((item) => item.trace.strength),
  );
  const nearStrength = mean(
    traces.filter((item) => item.tier === "near").map((item) => item.trace.strength),
  );
  const extremeActivation = mean(
    traces.filter((item) => item.tier === "extreme").map((item) => item.trace.activation),
  );
  const nearActivation = mean(
    traces.filter((item) => item.tier === "near").map((item) => item.trace.activation),
  );

  assert.ok(
    extremeStrength > nearStrength + 0.15,
    `expected extreme strength > near strength + 0.15; extreme=${extremeStrength}, near=${nearStrength}`,
  );
  assert.ok(
    extremeActivation > nearActivation,
    `expected extreme activation > near activation; extreme=${extremeActivation}, near=${nearActivation}`,
  );
});

test("shaping is bounded and creates some ranking pressure without an action table", () => {
  let changedCases = 0;
  for (const evalCase of AFFECT_EVAL_CASES_V1) {
    const prepared = prepareAffectCaseV1(evalCase);
    assert.ok(prepared.shapedAttention.every((item) => item.affectBoost >= 0 && item.affectBoost <= 0.28));
    assert.ok(prepared.shapedRetrieval.every((item) => item.affectBoost >= 0 && item.affectBoost <= 0.25));
    assert.ok(prepared.shapedAttention.some((item) => item.affectBoost > 0), evalCase.id);
    assert.ok(prepared.shapedRetrieval.some((item) => item.affectBoost > 0), evalCase.id);

    if (
      rankingChangedV1(prepared.baselineAttention, prepared.shapedAttention, 2) ||
      rankingChangedV1(prepared.baselineRetrieval, prepared.shapedRetrieval, 4)
    ) {
      changedCases += 1;
    }
  }
  assert.ok(changedCases >= 1, `expected at least one case ranking to change; changedCases=${changedCases}`);
});

test("resolution evidence can reduce activation and unresolvedness", () => {
  const evalCase = AFFECT_EVAL_CASES_V1.find((item) => item.id === "AX01");
  assert.ok(evalCase);
  const trace = prepareAffectCaseV1(evalCase).trace;
  const updated = updateAffectTraceV1({
    trace,
    cue: "根区正常且卷曲稳定，后续观察确认没有继续扩大。",
    now: "2026-08-11T01:00:00+08:00",
  });
  assert.ok(
    updated.activation < trace.activation,
    `expected activation to fall; before=${trace.activation}, after=${updated.activation}`,
  );
  assert.ok(
    updated.unresolvedness < trace.unresolvedness,
    `expected unresolvedness to fall; before=${trace.unresolvedness}, after=${updated.unresolvedness}`,
  );
});
