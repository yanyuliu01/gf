import type {
  S4PolicyClient,
  S4PolicyDecision,
  S4PolicyInput,
} from "./s4AttentionLoop.js";

interface DeepSeekChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
}

export class DeepSeekS4PolicyClient implements S4PolicyClient {
  constructor(
    private readonly options: {
      apiKey: string;
      model?: string;
      baseUrl?: string;
      agentPrompt?: string;
      temperature?: number;
    },
  ) {}

  async decide(input: S4PolicyInput): Promise<S4PolicyDecision> {
    const response = await fetch(
      `${this.options.baseUrl ?? "https://api.deepseek.com"}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.options.model ?? "deepseek-v4-flash",
          thinking: { type: "disabled" },
          response_format: { type: "json_object" },
          temperature: this.options.temperature ?? 0.2,
          max_tokens: 700,
          messages: [
            {
              role: "system",
              content: this.systemPrompt(),
            },
            {
              role: "user",
              content: [
                "根据下面这份角色当前合法可知的上下文做一次认知决策。",
                "只输出 JSON，不要输出额外文字。",
                JSON.stringify(input, null, 2),
              ].join("\n\n"),
            },
          ],
        }),
      },
    );

    const payload = (await response.json()) as DeepSeekChatResponse;
    if (!response.ok) {
      throw new Error(
        `DeepSeek request failed (${response.status}): ${payload.error?.message ?? response.statusText}`,
      );
    }

    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("DeepSeek returned empty content; retry the VS01 run.");
    }

    return parseDecision(content);
  }

  private systemPrompt(): string {
    const character =
      this.options.agentPrompt?.trim() ||
      "你有稳定、连贯的个人判断方式。不要为了迎合测试而机械地多检查或少检查；像这个人物自己一样，根据此刻真实掌握的证据决定下一步。";

    return `${character}

你处在一个持续运行的世界中。你只能依据 user 消息中给你的 observations、attention、currentActivity 和本次 episodeHistory 做决定；不要假设任何没有出现在上下文中的世界事实。

一次 cognition 开始后，是否继续由你决定：
- 如果还想获取信息或推进事情，输出 act。action.intent 是开放的自然语言语义意图，不要把它缩成预设动作分类。
- action.execution 只是把这次意图落到一个低层执行接口。目前原型暴露 observe(target, aspect)。target 与 aspect 是字符串；执行能否成功以及观察结果由世界裁定。
- 这个 S-4 最小世界目前可以实际返回 irrigation-pressure 与 root-zone-moisture 两个观察面；这只是执行能力，不代表你必须观察它们，也不代表需要按固定顺序观察。
- 如果以你的判断目前已经没有继续认知的必要，输出 yield。不要为了填满步骤而继续检查。

行动不能自己宣告成功，也不能把没有观察到的内容写进 intent 当作已知事实。

必须输出合法 JSON，格式只能是以下两种结构之一：
{"kind":"act","action":{"intent":"开放的自然语言意图","execution":{"primitive":"observe","target":"S-4","aspect":"irrigation-pressure"}}}
{"kind":"yield","reason":"为什么这个人物此刻决定先结束这次认知"}`;
  }
}

function parseDecision(content: string): S4PolicyDecision {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new Error(`DeepSeek returned invalid JSON: ${content}`);
  }

  if (!raw || typeof raw !== "object") {
    throw new Error("DeepSeek decision must be a JSON object.");
  }

  const decision = raw as Record<string, unknown>;
  if (decision.kind === "yield" && typeof decision.reason === "string") {
    return { kind: "yield", reason: decision.reason };
  }

  if (decision.kind === "act" && decision.action && typeof decision.action === "object") {
    const action = decision.action as Record<string, unknown>;
    const execution = action.execution;
    if (
      typeof action.intent === "string" &&
      execution &&
      typeof execution === "object"
    ) {
      const request = execution as Record<string, unknown>;
      if (
        request.primitive === "observe" &&
        typeof request.target === "string" &&
        typeof request.aspect === "string"
      ) {
        return {
          kind: "act",
          action: {
            intent: action.intent,
            execution: {
              primitive: "observe",
              target: request.target,
              aspect: request.aspect,
            },
          },
        };
      }
    }
  }

  throw new Error(`DeepSeek returned unsupported decision: ${content}`);
}
