/**
 * DeepSeek Responses API adapter.
 *
 * Provider protocol details stay here. The API key is never included in
 * request hashes, prompt audit, errors, or model-visible input.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { newId, utcnowIso } from "../domain/ids.js";
import type { InferenceUsageReceiptV1 } from "../generated/cognitiveRuntimeTypes.js";
import type { PromptContext } from "../prompts/assembler.js";
import type { SchemaRegistry } from "../validation/schemas.js";
import type {
  FastReplyOutput,
  InferenceClient,
  InferenceUsageReceiptSink,
  PromptRunAuditSink,
} from "./base.js";

export const DEEPSEEK_V4_FLASH_MODEL_ID = "deepseek-v4-flash";
export const DEEPSEEK_API_BASE_URL = "https://api.deepseek.com";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface DeepSeekResponsesClientOptions {
  apiKey: string;
  schemas: SchemaRegistry;
  audit: PromptRunAuditSink;
  usage: InferenceUsageReceiptSink;
  fetchImpl?: FetchLike;
  sleep?: (milliseconds: number) => Promise<void>;
  baseUrl?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  maxOutputTokens?: number;
  reasoningEffort?: DeepSeekReasoningEffort;
}

export type DeepSeekReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export interface DeepSeekApiKeyOptions {
  env?: NodeJS.ProcessEnv;
  keyFile?: string;
}

export class DeepSeekInferenceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
    readonly outputHash?: string,
  ) {
    super(message);
    this.name = "DeepSeekInferenceError";
  }
}

interface ResponseEnvelope {
  id?: unknown;
  model?: unknown;
  output_text?: unknown;
  output?: unknown;
  usage?: unknown;
}

interface InvocationSpec<T> {
  schemaName?: string;
  responseFormatName?: string;
  parse(text: string): T;
}

export function loadDeepSeekApiKey(
  options: DeepSeekApiKeyOptions = {},
): string | null {
  const env = options.env ?? process.env;
  const fromEnvironment = env.DEEPSEEK_API_KEY?.trim();
  if (fromEnvironment) {
    return fromEnvironment;
  }
  const keyFile =
    options.keyFile
    ?? env.GF_DEEPSEEK_KEY_FILE
    ?? "api key.txt";
  if (!existsSync(keyFile)) {
    return null;
  }
  const raw = readFileSync(keyFile, "utf-8").trim();
  if (!raw) {
    return null;
  }
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const candidate = parsed.DEEPSEEK_API_KEY ?? parsed.apiKey;
      return typeof candidate === "string" && candidate.trim()
        ? candidate.trim()
        : null;
    } catch {
      return null;
    }
  }
  const assignment = raw.match(
    /^(?:export\s+)?DEEPSEEK_API_KEY\s*=\s*(.+)$/m,
  );
  if (assignment) {
    const value = stripOptionalQuotes(assignment[1].trim());
    return value || null;
  }
  return raw.includes("\n") || raw.includes("\r") ? null : raw;
}

function stripOptionalQuotes(value: string): string {
  if (
    value.length >= 2
    && (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    )
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function estimatedTokens(value: string): number {
  return value.length === 0 ? 0 : Math.ceil(value.length / 4);
}

function usageCounter(value: unknown): number | null {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    ? value
    : null;
}

function extractOutputText(envelope: ResponseEnvelope): string {
  if (
    typeof envelope.output_text === "string"
    && envelope.output_text.trim()
  ) {
    return envelope.output_text;
  }
  if (!Array.isArray(envelope.output)) {
    throw new DeepSeekInferenceError(
      "empty_output",
      "DeepSeek response contained no output message",
    );
  }
  const parts: string[] = [];
  for (const item of envelope.output) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const part of content) {
      if (
        typeof part === "object"
        && part !== null
        && (part as Record<string, unknown>).type === "output_text"
        && typeof (part as Record<string, unknown>).text === "string"
      ) {
        parts.push((part as Record<string, unknown>).text as string);
      }
    }
  }
  const text = parts.join("");
  if (!text.trim()) {
    throw new DeepSeekInferenceError(
      "empty_output",
      "DeepSeek response contained no output text",
    );
  }
  return text;
}

function errorCode(error: unknown): string {
  return error instanceof DeepSeekInferenceError
    ? error.code
    : "provider_error";
}

function isRejectedOutput(error: unknown): boolean {
  return error instanceof DeepSeekInferenceError
    && [
      "empty_output",
      "invalid_json",
      "schema_invalid",
      "invalid_fast_reply",
    ].includes(error.code);
}

export class DeepSeekResponsesClient implements InferenceClient {
  readonly modelId = DEEPSEEK_V4_FLASH_MODEL_ID;
  private readonly apiKey: string;
  private readonly schemas: SchemaRegistry;
  private readonly audit: PromptRunAuditSink;
  private readonly usage: InferenceUsageReceiptSink;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly maxOutputTokens: number;
  private readonly reasoningEffort: DeepSeekReasoningEffort;

  constructor(options: DeepSeekResponsesClientOptions) {
    if (!options.apiKey.trim()) {
      throw new Error("DeepSeek API key is empty");
    }
    this.apiKey = options.apiKey.trim();
    this.schemas = options.schemas;
    this.audit = options.audit;
    this.usage = options.usage;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep =
      options.sleep
      ?? ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.baseUrl = (options.baseUrl ?? DEEPSEEK_API_BASE_URL)
      .replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.maxOutputTokens = options.maxOutputTokens ?? 2_048;
    this.reasoningEffort = options.reasoningEffort ?? "none";
    if (
      this.timeoutMs <= 0
      || this.maxAttempts < 1
      || this.maxOutputTokens < 1
    ) {
      throw new Error(
        "DeepSeek retry, timeout, and output limits must be positive",
      );
    }
  }

  async fastReply(context: PromptContext): Promise<FastReplyOutput> {
    return await this.invoke(context, {
      parse: (text) => {
        const bubbles = text
          .split(/\r?\n---\r?\n/)
          .map((bubble) => bubble.trim())
          .filter(Boolean);
        if (
          bubbles.length < 1
          || bubbles.length > 3
          || bubbles.some((bubble) => bubble.length > 120)
        ) {
          throw new DeepSeekInferenceError(
            "invalid_fast_reply",
            "DeepSeek fast reply violated the bubble contract",
            undefined,
            sha256(text),
          );
        }
        return { bubbles };
      },
    });
  }

  async tick(context: PromptContext): Promise<Record<string, unknown>> {
    return await this.invoke(context, {
      schemaName: "tick-proposal.schema.json",
      responseFormatName: "tick_proposal",
      parse: (text) =>
        this.parseStructured(text, "tick-proposal.schema.json"),
    });
  }

  async sceneSettle(
    context: PromptContext,
  ): Promise<Record<string, unknown>> {
    return await this.invoke(context, {
      schemaName: "scene-settlement.schema.json",
      responseFormatName: "scene_settlement",
      parse: (text) =>
        this.parseStructured(text, "scene-settlement.schema.json"),
    });
  }

  private parseStructured(
    text: string,
    schemaName: string,
  ): Record<string, unknown> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new DeepSeekInferenceError(
        "invalid_json",
        `DeepSeek output was not valid JSON for ${schemaName}`,
        undefined,
        sha256(text),
      );
    }
    try {
      this.schemas.validate(schemaName, parsed);
    } catch {
      throw new DeepSeekInferenceError(
        "schema_invalid",
        `DeepSeek output failed ${schemaName}`,
        undefined,
        sha256(text),
      );
    }
    return parsed as Record<string, unknown>;
  }

  private async invoke<T>(
    context: PromptContext,
    spec: InvocationSpec<T>,
  ): Promise<T> {
    const promptVersion = context.promptVersion;
    if (!promptVersion) {
      throw new DeepSeekInferenceError(
        "missing_prompt_version",
        `Prompt ${context.callPoint} has no contract version`,
      );
    }
    const body: Record<string, unknown> = {
      model: this.modelId,
      input: context.messages,
      max_output_tokens: this.maxOutputTokens,
      reasoning: { effort: this.reasoningEffort },
      text: spec.schemaName
        ? {
            format: {
              type: "json_schema",
              name: spec.responseFormatName,
              strict: true,
              schema: this.schemas.inlineDocument(spec.schemaName),
            },
          }
        : { format: { type: "text" } },
    };
    const runId = newId("run");
    this.audit.recordPromptRunStarted({
      runId,
      promptName: context.callPoint,
      promptVersion,
      promptManifestHash: context.manifestHash,
      inputHash: sha256(stableJson(body)),
      modelId: this.modelId,
      startedAt: utcnowIso(),
    });

    let rawOutputHash: string | undefined;
    try {
      const envelope = await this.request(body, runId);
      const text = extractOutputText(envelope);
      rawOutputHash = sha256(text);
      const parsed = spec.parse(text);
      this.audit.recordPromptRunFinished({
        runId,
        status: "validated",
        outputHash: rawOutputHash,
        finishedAt: utcnowIso(),
      });
      return parsed;
    } catch (error) {
      const errorOutputHash =
        error instanceof DeepSeekInferenceError
          ? error.outputHash
          : undefined;
      this.audit.recordPromptRunFinished({
        runId,
        status: isRejectedOutput(error) ? "rejected" : "failed",
        outputHash: rawOutputHash ?? errorOutputHash ?? null,
        errorCode: errorCode(error),
        finishedAt: utcnowIso(),
      });
      throw error;
    }
  }

  private async request(
    body: Record<string, unknown>,
    runId: string,
  ): Promise<ResponseEnvelope> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let usageRecorded = false;
      try {
        const response = await this.fetchImpl(
          `${this.baseUrl}/responses`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          const retryable =
            response.status === 408
            || response.status === 429
            || response.status >= 500;
          this.recordUsage(this.transportReceipt(
            runId,
            attempt,
            "transport_error",
          ));
          usageRecorded = true;
          if (retryable && attempt < this.maxAttempts) {
            await this.sleep(100 * 2 ** (attempt - 1));
            continue;
          }
          throw new DeepSeekInferenceError(
            retryable ? "retry_exhausted" : "http_rejected",
            `DeepSeek request failed with HTTP ${response.status}`,
            response.status,
          );
        }
        let parsed: unknown;
        try {
          parsed = await response.json();
        } catch {
          this.recordUsage(this.estimatedCompletedReceipt(
            runId,
            attempt,
            body,
          ));
          usageRecorded = true;
          throw new DeepSeekInferenceError(
            "invalid_response_json",
            "DeepSeek response envelope was not valid JSON",
            response.status,
          );
        }
        if (typeof parsed !== "object" || parsed === null) {
          this.recordUsage(this.estimatedCompletedReceipt(
            runId,
            attempt,
            body,
          ));
          usageRecorded = true;
          throw new DeepSeekInferenceError(
            "invalid_response_json",
            "DeepSeek response envelope was not an object",
            response.status,
          );
        }
        const envelope = parsed as ResponseEnvelope;
        this.recordUsage(this.completedReceipt(
          envelope,
          runId,
          attempt,
          body,
        ));
        usageRecorded = true;
        return envelope;
      } catch (error) {
        const aborted = controller.signal.aborted;
        const retryableTransport =
          aborted
          || !(error instanceof DeepSeekInferenceError);
        if (!usageRecorded && retryableTransport) {
          this.recordUsage(this.transportReceipt(
            runId,
            attempt,
            aborted ? "cancelled" : "transport_error",
          ));
          usageRecorded = true;
        }
        if (retryableTransport && attempt < this.maxAttempts) {
          await this.sleep(100 * 2 ** (attempt - 1));
          continue;
        }
        if (aborted) {
          throw new DeepSeekInferenceError(
            "timeout",
            `DeepSeek request timed out after ${this.timeoutMs}ms`,
          );
        }
        if (error instanceof DeepSeekInferenceError) {
          throw error;
        }
        throw new DeepSeekInferenceError(
          "transport_error",
          "DeepSeek request failed before receiving a response",
        );
      } finally {
        clearTimeout(timer);
      }
    }
    throw new DeepSeekInferenceError(
      "retry_exhausted",
      "DeepSeek retry budget exhausted",
    );
  }

  private recordUsage(receipt: InferenceUsageReceiptV1): void {
    try {
      this.usage.recordInferenceUsageReceipt(receipt);
    } catch {
      throw new DeepSeekInferenceError(
        "usage_audit_failed",
        "DeepSeek usage receipt could not be committed",
      );
    }
  }

  private transportReceipt(
    runId: string,
    attempt: number,
    completionStatus: "transport_error" | "cancelled",
  ): InferenceUsageReceiptV1 {
    return {
      schema_version: "1.0",
      receipt_id: newId("usage"),
      prompt_run_id: runId,
      provider_request_id: `deepseek:${runId}:attempt:${attempt}`,
      model_id: this.modelId,
      tokenizer_version: "gf.no-provider-usage.v1",
      input_tokens: 0,
      cached_input_tokens: 0,
      output_tokens: 0,
      reasoning_tokens: 0,
      attempt_ordinal: attempt,
      completion_status: completionStatus,
      usage_source: "versioned_estimate",
      received_at: utcnowIso(),
    };
  }

  private estimatedCompletedReceipt(
    runId: string,
    attempt: number,
    body: Record<string, unknown>,
    envelope?: ResponseEnvelope,
  ): InferenceUsageReceiptV1 {
    let outputText = "";
    if (envelope) {
      try {
        outputText = extractOutputText(envelope);
      } catch {
        outputText = "";
      }
    }
    return {
      schema_version: "1.0",
      receipt_id: newId("usage"),
      prompt_run_id: runId,
      provider_request_id:
        typeof envelope?.id === "string" && envelope.id.trim()
          ? envelope.id
          : `deepseek:${runId}:attempt:${attempt}`,
      model_id:
        typeof envelope?.model === "string" && envelope.model.trim()
          ? envelope.model
          : this.modelId,
      tokenizer_version: "gf.char-estimate.v1",
      input_tokens: estimatedTokens(stableJson(body)),
      cached_input_tokens: 0,
      output_tokens: estimatedTokens(outputText),
      reasoning_tokens: 0,
      attempt_ordinal: attempt,
      completion_status: "completed",
      usage_source: "versioned_estimate",
      received_at: utcnowIso(),
    };
  }

  private completedReceipt(
    envelope: ResponseEnvelope,
    runId: string,
    attempt: number,
    body: Record<string, unknown>,
  ): InferenceUsageReceiptV1 {
    const usage =
      typeof envelope.usage === "object" && envelope.usage !== null
        ? envelope.usage as Record<string, unknown>
        : null;
    const inputTokens = usageCounter(usage?.input_tokens);
    const outputTokens = usageCounter(usage?.output_tokens);
    const inputDetails =
      typeof usage?.input_tokens_details === "object"
      && usage.input_tokens_details !== null
        ? usage.input_tokens_details as Record<string, unknown>
        : null;
    const outputDetails =
      typeof usage?.output_tokens_details === "object"
      && usage.output_tokens_details !== null
        ? usage.output_tokens_details as Record<string, unknown>
        : null;
    const cachedTokens = usageCounter(inputDetails?.cached_tokens) ?? 0;
    const reasoningTokens = usageCounter(outputDetails?.reasoning_tokens) ?? 0;
    if (
      inputTokens === null
      || outputTokens === null
      || cachedTokens > inputTokens
      || reasoningTokens > outputTokens
    ) {
      return this.estimatedCompletedReceipt(
        runId,
        attempt,
        body,
        envelope,
      );
    }
    return {
      schema_version: "1.0",
      receipt_id: newId("usage"),
      prompt_run_id: runId,
      provider_request_id:
        typeof envelope.id === "string" && envelope.id.trim()
          ? envelope.id
          : `deepseek:${runId}:attempt:${attempt}`,
      model_id:
        typeof envelope.model === "string" && envelope.model.trim()
          ? envelope.model
          : this.modelId,
      tokenizer_version: "deepseek.responses.usage.v1",
      input_tokens: inputTokens,
      cached_input_tokens: cachedTokens,
      output_tokens: outputTokens,
      reasoning_tokens: reasoningTokens,
      attempt_ordinal: attempt,
      completion_status: "completed",
      usage_source: "provider",
      received_at: utcnowIso(),
    };
  }
}
