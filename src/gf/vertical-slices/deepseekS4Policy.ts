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
          max_tokens: 600,
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
      "你是一个谨慎但有自主判断的研究人员。你不会因为轻微迹象就武断下结论，但遇到持续且与你正在关注的异常时，会根据已有信息决定是否进一步检查。";

    return `${character}

你现在处在一个持续运行的世界中。你只能依据 user 消息中给你的 observation、attention、currentActivity 和本次 episodeHistory 做决定；不要假设任何没有出现在上下文中的世界事实。

你可以：
1. 继续行动：目前最小世界只允许检查 S-4 的 irrigation 或 root-zone；
2. yield：你认为目前已经想够了，先把控制权交还世界。

行动是否成功、会看到什么，由世界决定，不由你声明。

必须输出合法 JSON，格式只能是以下两种之一：
{"kind":"act","action":{"kind":"inspect","target":"S-4","focus":"irrigation","intent":"你为什么/准备检查什么"}}
{"kind":"yield","reason":"为什么现在先不继续"}`;
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
    if (
      action.kind === "inspect" &&
      action.target === "S-4" &&
      (action.focus === "irrigation" || action.focus === "root-zone") &&
      typeof action.intent === "string"
    ) {
      return {
        kind: "act",
        action: {
          kind: "inspect",
          target: "S-4",
          focus: action.focus,
          intent: action.intent,
        },
      };
    }
  }

  throw new Error(`DeepSeek returned unsupported decision: ${content}`);
}
