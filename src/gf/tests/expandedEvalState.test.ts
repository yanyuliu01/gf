import { test } from "node:test";
import assert from "node:assert/strict";
import { BEHAVIOR_EVAL_CASES } from "../vertical-slices/behaviorEvalCases.js";
import { DIALOGUE_EVAL_CASES } from "../vertical-slices/dialogueEvalCases.js";
import { getExpandedPerceivedState } from "../vertical-slices/expandedEvalState.js";

test("all 50 character eval cases expose rich perceived state without action candidates", () => {
  const cases = [...BEHAVIOR_EVAL_CASES, ...DIALOGUE_EVAL_CASES];
  assert.equal(cases.length, 50);

  for (const evalCase of cases) {
    const state = getExpandedPerceivedState(evalCase.id);
    assert.ok(state.length >= 5, `${evalCase.id} needs at least five state facts`);
    assert.ok(
      new Set(state.map((fact) => fact.aspect)).size >= 4,
      `${evalCase.id} needs state across several independent aspects`,
    );

    const serialized = JSON.stringify(state).toLowerCase();
    for (const forbiddenShape of [
      "availableactions",
      "actionoptions",
      "allowedactions",
      "候选动作",
      "可选动作",
    ]) {
      assert.equal(
        serialized.includes(forbiddenShape),
        false,
        `${evalCase.id} must not smuggle a finite action menu into perceived state`,
      );
    }
  }
});
