import assert from "node:assert/strict";
import test from "node:test";

import { PROMPT_AB_CASES_V3 } from "../prompts/policyABCasesV3.js";

test("prompt v3 A/B suite covers interaction and autonomous life", () => {
  assert.equal(PROMPT_AB_CASES_V3.length, 12);
  assert.equal(PROMPT_AB_CASES_V3.filter((item) => item.callPoint === "interaction").length, 8);
  assert.equal(PROMPT_AB_CASES_V3.filter((item) => item.callPoint === "autonomous").length, 4);
});

test("interaction cases keep the user message as data while autonomous cases do not invent one", () => {
  for (const evalCase of PROMPT_AB_CASES_V3) {
    if (evalCase.callPoint === "interaction") {
      assert.ok(evalCase.v3.workingSelf.userMessage, evalCase.id);
      assert.ok((evalCase.legacy.newMessages ?? []).length > 0, evalCase.id);
    } else {
      assert.equal(evalCase.v3.workingSelf.userMessage, undefined, evalCase.id);
      assert.ok(evalCase.legacy.event, evalCase.id);
    }
  }
});

test("v3 A/B cases contain no finite action candidates", () => {
  const serialized = JSON.stringify(PROMPT_AB_CASES_V3);
  assert.equal(serialized.includes("availableActions"), false);
  assert.equal(serialized.includes("actionOptions"), false);
  assert.equal(serialized.includes("candidateActions"), false);
});
