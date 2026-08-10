import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BEHAVIOR_EVAL_CASES } from "../vertical-slices/behaviorEvalCases.js";
import { DIALOGUE_EVAL_CASES } from "../vertical-slices/dialogueEvalCases.js";
import { writeSimpleXlsx } from "../vertical-slices/simpleXlsx.js";

test("character cognition probe catalog contains 20 behavior and 30 dialogue cases", () => {
  const cases = [...BEHAVIOR_EVAL_CASES, ...DIALOGUE_EVAL_CASES];
  assert.equal(BEHAVIOR_EVAL_CASES.length, 20);
  assert.equal(DIALOGUE_EVAL_CASES.length, 30);
  assert.equal(cases.length, 50);
  assert.equal(new Set(cases.map((item) => item.id)).size, 50);

  for (const item of cases) {
    assert.ok(item.title.trim());
    assert.ok(item.currentActivity.trim());
    assert.ok(item.knownContext.trim());
    assert.ok(item.focus.trim());
    assert.ok(item.expectedDivergence.trim());
    assert.ok(item.complexity >= 1 && item.complexity <= 5);
  }
});

test("dependency-free xlsx writer emits a zip-based OOXML workbook", () => {
  const path = join(tmpdir(), `gf-eval-${Date.now()}.xlsx`);
  try {
    writeSimpleXlsx(path, [
      {
        name: "Results",
        rows: [
          ["case_id", "reply"],
          ["D01", "你好"],
        ],
        widths: [12, 30],
        frozenRows: 1,
        autoFilter: true,
      },
    ]);

    const bytes = readFileSync(path);
    assert.equal(bytes.subarray(0, 2).toString("utf8"), "PK");
    assert.ok(bytes.includes(Buffer.from("[Content_Types].xml")));
    assert.ok(bytes.includes(Buffer.from("xl/workbook.xml")));
    assert.ok(bytes.includes(Buffer.from("xl/worksheets/sheet1.xml")));
  } finally {
    rmSync(path, { force: true });
  }
});
