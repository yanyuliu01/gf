import assert from "node:assert/strict";
import test from "node:test";

import { composePolicyPromptV3 } from "../prompts/policyComposerV3.js";

test("policy v3 keeps lived state as data and does not leak affect internals", () => {
  const prompt = composePolicyPromptV3({
    mode: "interaction",
    identity: {
      facts: ["她是生态科主任。", "她长期生活在特里蒙。"],
      selfDescriptions: ["她知道自己对植物的感知与多数人不同。"],
    },
    workingSelf: {
      now: "2026-08-26T18:00:00+08:00",
      location: "生态园",
      currentActivity: "整理一批植物状态记录",
      evidence: [
        {
          source: "memory",
          sourceRef: "mem-1",
          text: "昨天一处很轻的异常后来扩大了。",
        },
        {
          source: "commitment",
          sourceRef: "commit-1",
          text: "19:00 前答应交一份数据摘要。",
        },
      ],
      userMessage: "在吗？",
    },
  });

  assert.equal(prompt.version, "gf-policy-v3");
  assert.equal(prompt.messages.length, 2);
  assert.equal(prompt.messages[0].role, "system");
  assert.equal(prompt.messages[1].role, "user");

  const all = prompt.messages.map((message) => message.content).join("\n");
  assert.ok(all.includes("昨天一处很轻的异常后来扩大了"));
  assert.ok(all.includes("在吗？"));
  assert.ok(!all.includes("affectBoost"));
  assert.ok(!all.includes("activation"));
  assert.ok(!all.includes("strength"));
  assert.ok(!all.includes("availableActions"));
  assert.ok(!all.includes("actionOptions"));
});

test("policy v3 identity seed contains facts rather than an action menu", () => {
  const prompt = composePolicyPromptV3({
    mode: "autonomous",
    identity: { facts: ["她是缪尔赛思。"] },
    workingSelf: {
      now: "2026-08-26T18:00:00+08:00",
      evidence: [],
    },
  });

  const system = prompt.messages[0].content;
  assert.ok(system.includes("她是缪尔赛思"));
  assert.ok(system.includes("任何开放语义行动"));
  assert.ok(!system.includes("候选动作"));
});
