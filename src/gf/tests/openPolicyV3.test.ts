import assert from "node:assert/strict";
import test from "node:test";

import {
  DeepSeekOpenPolicyV3,
  parseOpenPolicyDecisionV3,
} from "../inference/openPolicyV3.js";
import { composePolicyPromptV3 } from "../prompts/policyComposerV3.js";

test("Open Policy V3 parses only the open decision contract", () => {
  const parsed = parseOpenPolicyDecisionV3(`\n\`\`\`json\n{
    "speech": "我去看一眼。",
    "actionIntent": "检查 S-4 终端",
    "attentionIntent": "留意第二组读数什么时候完成",
    "control": "continue"
  }\n\`\`\`\n`);

  assert.equal(parsed.speech, "我去看一眼。");
  assert.equal(parsed.actionIntent, "检查 S-4 终端");
  assert.equal(parsed.control, "continue");
});

test("Open Policy V3 fails closed on malformed model output", () => {
  assert.throws(
    () =>
      parseOpenPolicyDecisionV3(
        JSON.stringify({
          speech: "",
          actionIntent: "",
          attentionIntent: "",
          control: "maybe",
        }),
      ),
    /control must be continue or yield/,
  );
});

test("DeepSeek Open Policy adapter sends V3 prompt and returns validated decision", async () => {
  let body: Record<string, unknown> | null = null;
  const fetchImpl: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              speech: "还没出，我再等等。",
              actionIntent: "",
              attentionIntent: "等第二组读数完成时再注意",
              control: "yield",
            }),
          },
        },
      ],
    });
  };

  const client = new DeepSeekOpenPolicyV3({
    apiKey: "test-key",
    model: "test-model",
    fetchImpl,
  });
  const prompt = composePolicyPromptV3({
    mode: "autonomous",
    identity: { facts: ["她是缪尔赛思。"] },
    workingSelf: {
      now: "2026-08-26T14:20:00+08:00",
      evidence: [
        {
          source: "perception",
          sourceRef: "evt_obs",
          text: "第二组读数仍在处理中。",
        },
      ],
    },
  });

  const result = await client.decide(prompt);
  assert.equal(result.control, "yield");
  assert.equal(result.speech, "还没出，我再等等。");
  assert.ok(body);
  assert.equal(body.model, "test-model");
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.deepEqual(body.messages, prompt.messages);
});
