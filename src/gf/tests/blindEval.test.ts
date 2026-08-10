import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BLIND_LABELS,
  formatBlindCandidate,
  orderProfilesForCase,
} from "../vertical-slices/blindEval.js";
import type { CharacterEvalResult } from "../vertical-slices/characterEvalTypes.js";

test("blind profile assignment is deterministic and remains a permutation", () => {
  const profiles = ["A", "B", "C"] as const;
  const first = orderProfilesForCase("fixed-seed", "D01", profiles);
  const second = orderProfilesForCase("fixed-seed", "D01", profiles);

  assert.deepEqual(first, second);
  assert.deepEqual([...first].sort(), ["A", "B", "C"]);
  assert.equal(BLIND_LABELS.length, first.length);
});

test("blind candidate text exposes behavior but not profile identity", () => {
  const result: CharacterEvalResult = {
    runId: "run",
    caseId: "D01",
    type: "dialogue",
    category: "test",
    complexity: 3,
    affectReady: false,
    profileId: "A",
    profileName: "谨慎研究型",
    title: "case",
    positionSummary: "证据不足。",
    reply: "我还不能确定。",
    actionIntent: "再确认来源。",
    attentionIntent: "后续的新证据。",
    episodeDecision: "yield",
    decisionNote: "先不继续扩大判断。",
    hiddenFactCheck: "PASS",
    forbiddenHit: "",
    latencyMs: 10,
    error: "",
  };

  const text = formatBlindCandidate(result);
  assert.match(text, /我还不能确定/);
  assert.match(text, /再确认来源/);
  assert.equal(text.includes("谨慎研究型"), false);
  assert.equal(text.includes("profile"), false);
});
