import { createHash } from "node:crypto";
import type { WorkingSelfV1 } from "../../generated/agentPipelineTypes.js";
import type { LifeCommandV1, LifeCompilationV2 } from "../../generated/lifeRuntimeTypes.js";
import type {
  InferenceUsageReceiptV1,
  OpenPolicyDraftV1,
} from "../../generated/cognitiveRuntimeTypes.js";
import {
  OpenGenerativePolicy,
  type OpenPolicyResultV1,
} from "../../cognition/policy/openGenerativePolicy.js";
import {
  DeepSeekResponsesClient,
  DeepSeekInferenceError,
  DEEPSEEK_V4_FLASH_MODEL_ID,
} from "../../inference/deepseekResponses.js";
import type {
  PromptRunFinished,
  PromptRunStarted,
} from "../../inference/base.js";
import type { StateManager } from "../../state/stateManager.js";
import type { SchemaRegistry } from "../../validation/schemas.js";
import type { PromptContext } from "../../prompts/assembler.js";
import { LIFE_POLICY_SYSTEM_INSTRUCTION, LIFE_POLICY_PROMPT_VERSION,
  LIFE_COMPILER_SYSTEM_INSTRUCTION, LIFE_COMPILER_PROMPT_VERSION } from "./prompts.js";
import { groundLifeCompilation } from "./compilation.js";
import { appendLifeConversation, type LifeConversationItem } from "./conversation.js";
export const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
export interface LifeModel {
  modelId: string;
  policy(
    ws: WorkingSelfV1,
    runId: string,
    maxTokens: number,
    conversation?: readonly LifeConversationItem[],
  ): Promise<{
    policy: OpenPolicyResultV1;
    receipt: InferenceUsageReceiptV1;
    finished: PromptRunFinished;
  }>;
  compile(
    policy: OpenPolicyResultV1,
    ws: WorkingSelfV1,
    conversation?: readonly LifeConversationItem[],
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
  async policy(ws: WorkingSelfV1, runId: string, maxTokens: number, conversation: readonly LifeConversationItem[] = []) {
    let receipt: InferenceUsageReceiptV1 | undefined,
      finished: PromptRunFinished | undefined;
    const context = this.context(
      LIFE_POLICY_SYSTEM_INSTRUCTION,
      ws,
      LIFE_POLICY_PROMPT_VERSION,
      ws,
      conversation,
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
        this.failure(e),
        e instanceof DeepSeekInferenceError ? e.code : "policy_failed",
        new Date().toISOString(),
      );
      throw e;
    }
  }
  async compile(
    policy: OpenPolicyResultV1,
    ws: WorkingSelfV1,
    conversation: readonly LifeConversationItem[] = [],
  ): Promise<LifeCommandV1> {
    const system = LIFE_COMPILER_SYSTEM_INSTRUCTION;
    const context = this.context(
      system,
      { action: policy.action, workingSelf: ws },
      LIFE_COMPILER_PROMPT_VERSION,
      ws,
      conversation,
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
      const draft = (await provider.structured(
        context,
        "life-compilation-v2.schema.json",
      )) as unknown as LifeCompilationV2;
      const result = groundLifeCompilation(draft, policy);
      this.state.recordLifeAttempt(
        "compiler",
        context,
        { draft, command: result },
        null,
        new Date().toISOString(),
      );
      return result;
    } catch (e) {
      this.state.recordLifeAttempt(
        "compiler",
        context,
        this.failure(e),
        e instanceof DeepSeekInferenceError ? e.code : "compiler_failed",
        new Date().toISOString(),
      );
      throw e;
    }
  }
  private failure(error: unknown): unknown {
    if (!(error instanceof DeepSeekInferenceError)) return undefined;
    return { failure: { code: error.code, status: error.status ?? null,
      outputHash: error.outputHash ?? null, diagnostic: error.diagnostic ?? null } };
  }
  private context(
    system: string,
    data: unknown,
    version: string,
    ws: WorkingSelfV1,
    conversation: readonly LifeConversationItem[],
  ): PromptContext {
    const renderedIds = new Set(conversation.map(item => item.eventId));
    const renderedSelf = { ...ws, evidence: ws.evidence.map(e => ({ ...e,
      narrative: e.source_refs.some(s => s.source_type === "event" && renderedIds.has(s.source_id))
        ? `对话原文见后续对应角色消息；原时间 ${e.as_of ?? "未知"}；来源 ${e.source_refs.map(s => s.source_id).join(",")}`
        : e.narrative,
    })) };
    const renderedData = data === ws ? renderedSelf : { ...(data as object), workingSelf: renderedSelf };
    const messages: PromptContext["messages"] = [
      { role: "system", content: `${system}\n本轮当前时刻：${ws.assembled_at}。${ws.evidence.some((e) => e.role === "current_input")
        ? "本轮输入快照包含正在处理的博士消息，原发送时间见【本次触发】。"
        : "本轮输入快照没有正在处理的博士消息；唤醒来自【本次触发】中的世界事件。"}` },
      { role: "user", content: JSON.stringify(renderedData) },
    ];
    appendLifeConversation(messages, conversation, ws);
    messages.push({ role: "system", content: version === LIFE_POLICY_PROMPT_VERSION
      ? '【本次调用的输出任务】上面是供理解的对话记录。本次执行内部 Policy：只返回符合 open-policy-draft 的单个 JSON 对象，首字符为 {，末字符为 }。必填结构为 {"action":{"intent":"本轮打算做的事","source_refs":[实际引用的来源对象]}}。source_refs 从 Working Self.input_closure 原样选取。若想说话，将想表达的内容写入 action.intent；对话原文不是本次输出格式示例。不要直接续写聊天，不要 Markdown 代码块或 JSON 外的文字。可选字段仍遵守请求中的 schema。'
      : '【本次调用的输出任务】本次执行内部行动编译：只返回符合 life-compilation-v2 的单个 JSON 对象，包含 command、action_quote、target_quote。command 包含 primitive、target、detail、text，遵守请求 schema 和首项意图约束。只有 communicate 的 text 承载给博士的聊天文字。对话记录仅为背景，编译目标仍是数据包内 action；不要直接续写聊天，不要 Markdown 代码块或 JSON 外的文字。'
    });
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
