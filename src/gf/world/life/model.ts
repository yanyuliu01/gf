import { createHash } from "node:crypto";
import type { WorkingSelfV1 } from "../../generated/agentPipelineTypes.js";
import type { LifeCommandV1 } from "../../generated/lifeRuntimeTypes.js";
import type {
  InferenceUsageReceiptV1,
  OpenPolicyDraftV1,
} from "../../generated/cognitiveRuntimeTypes.js";
import {
  OpenGenerativePolicy,
  OPEN_POLICY_SYSTEM_INSTRUCTION,
  OPEN_POLICY_PROMPT_VERSION,
  type OpenPolicyResultV1,
} from "../../cognition/policy/openGenerativePolicy.js";
import {
  DeepSeekResponsesClient,
  DEEPSEEK_V4_FLASH_MODEL_ID,
} from "../../inference/deepseekResponses.js";
import type {
  PromptRunFinished,
  PromptRunStarted,
} from "../../inference/base.js";
import type { StateManager } from "../../state/stateManager.js";
import type { SchemaRegistry } from "../../validation/schemas.js";
import type { PromptContext } from "../../prompts/assembler.js";
export const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
export interface LifeModel {
  modelId: string;
  policy(
    ws: WorkingSelfV1,
    runId: string,
    maxTokens: number,
  ): Promise<{
    policy: OpenPolicyResultV1;
    receipt: InferenceUsageReceiptV1;
    finished: PromptRunFinished;
  }>;
  compile(
    policy: OpenPolicyResultV1,
    ws: WorkingSelfV1,
  ): Promise<LifeCommandV1>;
}
export class DeepSeekLifeModel implements LifeModel {
  readonly modelId = DEEPSEEK_V4_FLASH_MODEL_ID;
  constructor(
    private readonly apiKey: string,
    private readonly schemas: SchemaRegistry,
    private readonly state: StateManager,
    private readonly fetchImpl?: typeof fetch,
  ) {}
  async policy(ws: WorkingSelfV1, runId: string, maxTokens: number) {
    let receipt: InferenceUsageReceiptV1 | undefined,
      finished: PromptRunFinished | undefined;
    const context = this.context(
      OPEN_POLICY_SYSTEM_INSTRUCTION,
      ws,
      OPEN_POLICY_PROMPT_VERSION,
      ws,
    );
    const provider = new DeepSeekResponsesClient({
      apiKey: this.apiKey,
      schemas: this.schemas,
      fetchImpl: this.fetchImpl,
      maxOutputTokens: maxTokens,
      audit: {
        recordPromptRunStarted: (_r: PromptRunStarted) => {},
        recordPromptRunFinished: (r) => {
          finished = r;
        },
      },
      usage: {
        recordInferenceUsageReceipt: (r) => {
          this.state.recordInferenceUsageReceipt(r);
          if (r.completion_status === "completed") receipt = r;
        },
      },
    });
    const policy = new OpenGenerativePolicy(
      {
        generate: async () => ({
          policyRunId: runId,
          proposedAt: new Date().toISOString(),
          draft: (await provider.structured(
            context,
            "open-policy-draft.schema.json",
            runId,
            maxTokens,
          )) as unknown as OpenPolicyDraftV1,
        }),
      },
      this.schemas,
    );
    try {
      const value = await policy.propose(ws);
      this.state.recordLifeAttempt(
        "policy",
        context,
        value,
        null,
        new Date().toISOString(),
      );
      if (!receipt || !finished) throw new Error("missing_policy_receipt");
      return { policy: value, receipt, finished };
    } catch (e) {
      this.state.recordLifeAttempt(
        "policy",
        context,
        undefined,
        "policy_failed",
        new Date().toISOString(),
      );
      throw e;
    }
  }
  async compile(
    policy: OpenPolicyResultV1,
    ws: WorkingSelfV1,
  ): Promise<LifeCommandV1> {
    const system = `你是行动编译器，不是角色，也不做新的行动决策。将给定的一个开放意图忠实翻译为下一项底层调用。保留原意；不支持时返回 capability_gap，detail 说明缺口，不替换行为。接口：move target= garden|office|home；observe target=S-4；use_object target=pump（维护）或 S-4（补水）；wait；communicate target=doctor。只有原意明确要向博士表达、回复或联系时才可 communicate；text 是按原意和提供的已知证据拟定的消息，不增加计划外信息。其余 text 必须为空。detail 解释翻译。多步计划只执行第一项可执行步骤。不要把尝试写成已完成，不把拟发送写成已送达。只输出 JSON，包含 primitive,target,detail,text。`;
    const context = this.context(
      system,
      { action: policy.action, workingSelf: ws },
      "life-compiler.v1",
      ws,
    );
    const provider = new DeepSeekResponsesClient({
      apiKey: this.apiKey,
      schemas: this.schemas,
      fetchImpl: this.fetchImpl,
      audit: this.state,
      usage: this.state,
      maxOutputTokens: 1800,
    });
    try {
      const result = (await provider.structured(
        context,
        "life-command.schema.json",
      )) as unknown as LifeCommandV1;
      this.state.recordLifeAttempt(
        "compiler",
        context,
        result,
        null,
        new Date().toISOString(),
      );
      return result;
    } catch (e) {
      this.state.recordLifeAttempt(
        "compiler",
        context,
        undefined,
        "compiler_failed",
        new Date().toISOString(),
      );
      throw e;
    }
  }
  private context(
    system: string,
    data: unknown,
    version: string,
    ws: WorkingSelfV1,
  ): PromptContext {
    const messages: PromptContext["messages"] = [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(data) },
    ];
    return {
      callPoint: version,
      promptVersion: version,
      messages,
      promptHash: hash(messages),
      manifestHash: hash(version),
      slotCharCounts: {},
      modelId: this.modelId,
      inputSources: ws.input_closure.source_refs,
    };
  }
}
