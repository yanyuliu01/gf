/** Frozen plumbing fixture; never selected by the live service. */
import { OpenGenerativePolicy } from "../../cognition/policy/openGenerativePolicy.js";
import type { LifeModel } from "./model.js";
import type { SchemaRegistry } from "../../validation/schemas.js";
export function createLifeFixture(schemas: SchemaRegistry): LifeModel {
  return {
    modelId: "deepseek-v4-flash",
    async policy(ws, runId) {
      const policy = await new OpenGenerativePolicy(
        {
          generate: async () => ({
            policyRunId: runId,
            proposedAt: ws.assembled_at,
            draft: {
              action: {
                intent: "向博士说明刚才看到的生态园记录",
                source_refs: ws.input_closure.source_refs,
              },
            },
          }),
        },
        schemas,
      ).propose(ws);
      return {
        policy,
        receipt: {
          schema_version: "1.0",
          receipt_id: `receipt:${runId}`,
          prompt_run_id: runId,
          provider_request_id: `fixture:${runId}`,
          model_id: "deepseek-v4-flash",
          tokenizer_version: "deepseek.responses.usage.v1",
          input_tokens: 200,
          cached_input_tokens: 0,
          output_tokens: 50,
          reasoning_tokens: 0,
          attempt_ordinal: 1,
          completion_status: "completed",
          usage_source: "versioned_estimate",
          received_at: ws.assembled_at,
        },
        finished: {
          runId,
          status: "validated",
          outputHash: "a".repeat(64),
          finishedAt: ws.assembled_at,
        },
      };
    },
    async compile() {
      return {
        primitive: "communicate",
        target: "doctor",
        detail: "Frozen smoke fixture, not a model decision.",
        text: "[离线测试夹具] 世界事件已经经过感知与认知链路。",
      };
    },
  };
}
