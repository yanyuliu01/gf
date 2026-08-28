import assert from "node:assert/strict";
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const generator = join(ROOT, "scripts", "generate-schema-types.mjs");

function copy(relativePath: string, targetRoot: string): void {
  const target = join(targetRoot, relativePath);
  mkdirSync(join(target, ".."), { recursive: true });
  copyFileSync(join(ROOT, relativePath), target);
}

test("schema generation check fails closed when a generated type drifts", () => {
  const targetRoot = mkdtempSync(join(tmpdir(), "gf-schema-generation-"));
  try {
    for (const relativePath of [
      "schemas/common.schema.json",
      "schemas/cognitive-runtime.schema.json",
      "schemas/agent-pipeline.schema.json",
      "src/gf/generated/cognitiveRuntimeTypes.ts",
      "src/gf/generated/agentPipelineTypes.ts",
    ]) {
      copy(relativePath, targetRoot);
    }

    const clean = spawnSync(
      process.execPath,
      [generator, "--check", "--root", targetRoot],
      { encoding: "utf8" },
    );
    assert.equal(clean.status, 0, clean.stderr);

    appendFileSync(
      join(targetRoot, "src", "gf", "generated", "agentPipelineTypes.ts"),
      "// drift\n",
      "utf8",
    );
    const drifted = spawnSync(
      process.execPath,
      [generator, "--check", "--root", targetRoot],
      { encoding: "utf8" },
    );
    assert.equal(drifted.status, 1);
    assert.match(drifted.stderr, /agent-pipeline\.schema\.json.*stale/);
  } finally {
    rmSync(targetRoot, { recursive: true, force: true });
  }
});
