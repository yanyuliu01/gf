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
      assert.deepEqual(context.inputSources, [
        {
          source_type: "message",
          source_id: `msg_${fixture.label.toLowerCase()}`,
        },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("fast-reply context records only source-bearing inputs actually rendered", () => {
  const manifest = new Manifest(join(ROOT, "prompts", "manifest.yaml"));
  const assembler = new FastReplyAssembler(
    manifest,
    join(ROOT, "prompts", "10-fast-reply.md"),
    {
      worldState: {},
      recentEvents: [
        {
          event_id: "evt_recent",
          payload_json: JSON.stringify({ text: "最近发生的事" }),
        },
        {
          event_id: "evt_not_rendered",
          payload_json: JSON.stringify({ unrelated: true }),
        },
      ],
      canonHits: [
        {
          id: "cs_0123456789abcdef",
          label: "canon_self",
          text: "一段往事",
        },
      ],
      memories: [
        {
          content: "一段带来源的记忆",
          source_refs: [{ source_type: "claim", source_id: "clm_memory" }],
        },
      ],
    },
  );

  const context = assembler.assemble([], [
    { message_id: "msg_current", content: "当前消息" },
  ]);

  assert.deepEqual(context.inputSources, [
    { source_type: "event", source_id: "evt_recent" },
    { source_type: "canon", source_id: "cs_0123456789abcdef" },
    { source_type: "claim", source_id: "clm_memory" },
    { source_type: "message", source_id: "msg_current" },
  ]);
});
