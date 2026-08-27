import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FastReplyAssembler } from "../prompts/assembler.js";
import { Manifest } from "../prompts/manifest.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const FAST_REPLY_TEMPLATE = readFileSync(
  join(ROOT, "prompts", "10-fast-reply.md"),
  "utf-8",
).replaceAll("\r\n", "\n");

for (const fixture of [
  { label: "LF", eol: "\n" },
  { label: "CRLF", eol: "\r\n" },
]) {
  test(`fast-reply template parsing accepts ${fixture.label} without normalizing user text`, () => {
    const dir = mkdtempSync(join(tmpdir(), "gf-prompt-eol-"));
    try {
      const templatePath = join(dir, "fast-reply.md");
      writeFileSync(
        templatePath,
        FAST_REPLY_TEMPLATE.replaceAll("\n", fixture.eol),
        "utf-8",
      );
      const assembler = new FastReplyAssembler(
        new Manifest(join(ROOT, "prompts", "manifest.yaml")),
        templatePath,
      );
      const userText = "第一行\r\n第二行\n第三行";

      const context = assembler.assemble([], [
        { message_id: `msg_${fixture.label.toLowerCase()}`, content: userText },
      ]);

      assert.equal(context.messages[0].role, "system");
      assert.match(context.messages[0].content, /你在扮演一个真实存在的人/);
      assert.match(context.messages[0].content, /现在，写她准备打出去的字/);
      assert.doesNotMatch(context.messages[0].content, /Role-based 输入槽位/);
      assert.doesNotMatch(context.messages[0].content, /\{\{S3_dialogue_samples\}\}/);
      assert.equal(context.messages.at(-1)?.role, "user");
      assert.equal(context.messages.at(-1)?.content, userText);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
