import assert from "node:assert/strict";
import test from "node:test";

import { WorkingSelfBuilderV1 } from "../cognition/workingSelf.js";

test("Working Self keeps only source-linked admitted evidence and mandatory message", () => {
  const builder = new WorkingSelfBuilderV1();
  const workingSelf = builder.build({
    now: "2026-08-26T14:20:00+08:00",
    location: " 中央生态园 ",
    currentActivity: "复核 S-4 数据",
    evidence: [
      {
        source: "perception",
        sourceRef: "evt_world_obs",
        text: "第二组读数仍在处理中。",
      },
      {
        source: "memory",
        sourceRef: "mem_s4_yesterday",
        text: "昨天同一批次也出现过一次延迟。",
      },
      {
        source: "memory",
        sourceRef: "mem_s4_yesterday",
        text: "昨天同一批次也出现过一次延迟。",
      },
    ],
    mandatoryMessage: {
      sourceRef: "evt_user_1",
      text: "你在干什么？",
    },
  });

  assert.equal(workingSelf.location, "中央生态园");
  assert.equal(workingSelf.userMessage, "你在干什么？");
  assert.equal(workingSelf.evidence.length, 3);
  assert.deepEqual(
    workingSelf.evidence.map((item) => item.source),
    ["perception", "memory", "message"],
  );
  assert.ok(
    workingSelf.evidence.every(
      (item) => typeof item.sourceRef === "string" && item.sourceRef.length > 0,
    ),
  );
});

test("Working Self fails closed when lived evidence has no source", () => {
  const builder = new WorkingSelfBuilderV1();
  assert.throws(
    () =>
      builder.build({
        now: "2026-08-26T14:20:00+08:00",
        evidence: [
          {
            source: "belief",
            sourceRef: "   ",
            text: "一个没有来源的判断。",
          },
        ],
      }),
    /requires sourceRef/,
  );
});
