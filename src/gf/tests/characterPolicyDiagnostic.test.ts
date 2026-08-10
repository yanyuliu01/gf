import { test } from "node:test";
import assert from "node:assert/strict";
import { BEHAVIOR_EVAL_CASES } from "../vertical-slices/behaviorEvalCases.js";
import { DIALOGUE_EVAL_CASES } from "../vertical-slices/dialogueEvalCases.js";
import {
  DIAGNOSTIC_CASE_IDS,
  DIAGNOSTIC_PROFILES,
} from "../vertical-slices/characterPolicyDiagnostic.js";
import { getExpandedPerceivedState } from "../vertical-slices/expandedEvalState.js";

test("diagnostic suite uses ten high-tradeoff expanded-state cases", () => {
  assert.equal(DIAGNOSTIC_CASE_IDS.length, 10);
  assert.equal(new Set(DIAGNOSTIC_CASE_IDS).size, 10);

  const cases = [...BEHAVIOR_EVAL_CASES, ...DIALOGUE_EVAL_CASES];
  const known = new Set(cases.map((item) => item.id));

  for (const caseId of DIAGNOSTIC_CASE_IDS) {
    assert.equal(known.has(caseId), true, `missing diagnostic case ${caseId}`);
    assert.ok(
      getExpandedPerceivedState(caseId).length >= 5,
      `${caseId} must use expanded perceived state`,
    );
  }
});

test("diagnostic profiles include neutral, three realistic, and three extreme controls", () => {
  assert.deepEqual(Object.keys(DIAGNOSTIC_PROFILES), ["N", "A", "B", "C", "X", "Y", "Z"]);
  assert.equal(DIAGNOSTIC_PROFILES.N.kind, "neutral");
  assert.equal(DIAGNOSTIC_PROFILES.A.kind, "realistic");
  assert.equal(DIAGNOSTIC_PROFILES.B.kind, "realistic");
  assert.equal(DIAGNOSTIC_PROFILES.C.kind, "realistic");
  assert.equal(DIAGNOSTIC_PROFILES.X.kind, "extreme");
  assert.equal(DIAGNOSTIC_PROFILES.Y.kind, "extreme");
  assert.equal(DIAGNOSTIC_PROFILES.Z.kind, "extreme");
});
