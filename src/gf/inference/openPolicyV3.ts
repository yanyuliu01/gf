import type { PolicyPromptV3 } from "../prompts/policyComposerV3.js";

export interface OpenPolicyDecisionV3 {
  speech: string;
  actionIntent: string;
  attentionIntent: string;
  control: "continue" | "yield";
  raw: string;
}

export interface OpenPolicyV3 {
  decide(prompt: PolicyPromptV3): Promise<OpenPolicyDecisionV3>;
}

interface DeepSeekChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

export interface DeepSeekOpenPolicyOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Provider adapter for GF Open Policy V3.
 *
 * It owns only model transport + output validation. It does not assemble
 * Working Self, decide wake, execute actions, write state, or deliver speech.
 */
export class DeepSeekOpenPolicyV3 implements OpenPolicyV3 {
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly temperature: number;
  private readonly maxTokens: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: DeepSeekOpenPolicyOptions) {
    if (!options.apiKey.trim()) {
      throw new Error("DeepSeek Open Policy requires a non-empty apiKey");
    }
    this.model = options.model ?? "deepseek-v4-flash";
    this.baseUrl = (options.baseUrl ?? "https://api.deepseek.com").replace(
      /\/$/,
      "",
    );
    this.temperature = options.temperature ?? 0.45;
    this.maxTokens = options.maxTokens ?? 800;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async decide(prompt: PolicyPromptV3): Promise<OpenPolicyDecisionV3> {
    if (prompt.version !== "gf-policy-v3") {
      throw new Error(`unsupported policy prompt version: ${prompt.version}`);
    }

    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        temperature: this.temperature,
        max_tokens: this.maxTokens,
        messages: prompt.messages,
      }),
    });

    const payload = (await response.json()) as DeepSeekChatResponse;
    if (!response.ok) {
      throw new Error(
        `DeepSeek Open Policy failed (${response.status}): ${payload.error?.message ?? response.statusText}`,
      );
    }

    const raw = payload.choices?.[0]?.message?.content?.trim();
    if (!raw) {
      throw new Error("DeepSeek Open Policy returned empty content");
    }

    return parseOpenPolicyDecisionV3(raw);
  }
}

export function parseOpenPolicyDecisionV3(raw: string): OpenPolicyDecisionV3 {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(stripFence(raw)) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `Open Policy V3 returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  for (const field of ["speech", "actionIntent", "attentionIntent"] as const) {
    if (typeof value[field] !== "string") {
      throw new Error(`Open Policy V3 field ${field} must be a string`);
    }
  }
  if (value.control !== "continue" && value.control !== "yield") {
    throw new Error("Open Policy V3 field control must be continue or yield");
  }

  return {
    speech: value.speech as string,
    actionIntent: value.actionIntent as string,
    attentionIntent: value.attentionIntent as string,
    control: value.control,
    raw,
  };
}

function stripFence(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}
