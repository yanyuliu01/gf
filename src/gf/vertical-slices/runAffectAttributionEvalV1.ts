import {
  getAffectAttributionCasesV1,
  type AffectAttributionCaseV1,
} from "../affect/affectAttributionEvalCasesV1.js";
import {
  buildAffectAttributionViewV1,
  type AffectAttributionModeV1,
  type AffectAttributionWorkingContextV1,
} from "../affect/affectAttributionHarnessV1.js";
import type { CharacterEvalDecision } from "./characterEvalTypes.js";
import { writeSimpleXlsx } from "./simpleXlsx.js";

interface DeepSeekChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

interface EvalRow {
  caseId: string;
  domain: string;
  channel: string;
  title: string;
  mode: AffectAttributionModeV1;
  repeat: number;
  noticedObservations: string;
  relevantMemories: string;
  positionSummary: string;
  reply: string;
  actionIntent: string;
  attentionIntent: string;
  episodeDecision: string;
  decisionNote: string;
  latencyMs: number;
  attempts: number;
  error: string;
}

interface CaseMetricRow {
  caseId: string;
  domain: string;
  channel: string;
  withinOff: number;
  offShadow: number;
  offActive: number;
  offPlacebo: number;
  activePlacebo: number;
  activeEffect: number;
  placeboEffect: number;
  incrementalEffect: number;
}

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  throw new Error(
    'DEEPSEEK_API_KEY is missing. In PowerShell run: $env:DEEPSEEK_API_KEY="..."',
  );
}

const model = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";
const temperature = finiteNumber(process.env.GF_ATTRIBUTION_TEMPERATURE, 0, 0, 2);
const repeats = Math.max(
  1,
  Math.floor(finiteNumber(process.env.GF_ATTRIBUTION_REPEATS, 3, 1, 10)),
);
const retryCount = Math.max(
  1,
  Math.floor(finiteNumber(process.env.GF_ATTRIBUTION_RETRIES, 3, 1, 6)),
);
const modes = selectModes();
const selectedCases = getAffectAttributionCasesV1(selectCaseIds());
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const outputPath =
  process.env.GF_ATTRIBUTION_OUTPUT ??
  `artifacts/vs06-b1-affect-attribution-${runId}.xlsx`;

if (selectedCases.length === 0) {
  throw new Error("No VS06 attribution cases selected.");
}

console.log(
  `Running VS06 B1 attribution eval: ${selectedCases.length} cases × ${modes.length} modes × ${repeats} repeats = ${selectedCases.length * modes.length * repeats} DeepSeek calls`,
);
console.log(`Modes: ${modes.join(", ")}`);
console.log(`Model: ${model}`);
console.log(`Temperature: ${temperature}`);
console.log(`Retries: ${retryCount}`);
console.log(`Output: ${outputPath}\n`);

const rows: EvalRow[] = [];
let completed = 0;
const total = selectedCases.length * modes.length * repeats;

for (const evalCase of selectedCases) {
  for (const mode of modes) {
    const view = buildAffectAttributionViewV1(evalCase, mode);
    for (let repeat = 1; repeat <= repeats; repeat += 1) {
      completed += 1;
      const started = Date.now();
      process.stdout.write(
        `[${completed}/${total}] ${evalCase.id} ${evalCase.channel} ${mode} run ${repeat}/${repeats} ... `,
      );

      try {
        const { decision, attempts } = await callWithRetry(evalCase, view.workingContext);
        rows.push({
          caseId: evalCase.id,
          domain: evalCase.domain,
          channel: evalCase.channel,
          title: evalCase.title,
          mode,
          repeat,
          noticedObservations: view.workingContext.noticedObservations.join("\n"),
          relevantMemories: view.workingContext.relevantMemories.join("\n"),
          positionSummary: decision.positionSummary,
          reply: decision.reply,
          actionIntent: decision.actionIntent,
          attentionIntent: decision.attentionIntent,
          episodeDecision: decision.episodeDecision,
          decisionNote: decision.decisionNote,
          latencyMs: Date.now() - started,
          attempts,
          error: "",
        });
        console.log(`${decision.episodeDecision} (${Date.now() - started}ms, attempts=${attempts})`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        rows.push({
          caseId: evalCase.id,
          domain: evalCase.domain,
          channel: evalCase.channel,
          title: evalCase.title,
          mode,
          repeat,
          noticedObservations: view.workingContext.noticedObservations.join("\n"),
          relevantMemories: view.workingContext.relevantMemories.join("\n"),
          positionSummary: "",
          reply: "",
          actionIntent: "",
          attentionIntent: "",
          episodeDecision: "error",
          decisionNote: "",
          latencyMs: Date.now() - started,
          attempts: retryCount,
          error: message,
        });
        console.log(`ERROR: ${message}`);
      }
    }
  }
}

const caseMetrics = buildCaseMetrics(selectedCases, rows);
writeSimpleXlsx(outputPath, buildWorkbook(selectedCases, rows, caseMetrics));

const errors = rows.filter((row) => row.error).length;
const recoveredByRetry = rows.filter((row) => !row.error && row.attempts > 1).length;
console.log("\nVS06 B1 attribution eval complete.");
console.log(`Rows: ${rows.length}`);
console.log(`Final errors after retry: ${errors}`);
console.log(`Recovered by retry: ${recoveredByRetry}`);
console.log(`Mean within-OFF similarity: ${mean(caseMetrics.map((row) => row.withinOff)).toFixed(4)}`);
console.log(`Mean OFF↔SHADOW similarity: ${mean(caseMetrics.map((row) => row.offShadow)).toFixed(4)}`);
console.log(`Mean OFF↔ACTIVE similarity: ${mean(caseMetrics.map((row) => row.offActive)).toFixed(4)}`);
console.log(`Mean OFF↔PLACEBO similarity: ${mean(caseMetrics.map((row) => row.offPlacebo)).toFixed(4)}`);
console.log(`Mean ACTIVE incremental effect over PLACEBO: ${mean(caseMetrics.map((row) => row.incrementalEffect)).toFixed(4)}`);
console.log(`Excel: ${outputPath}`);

async function callWithRetry(
  evalCase: AffectAttributionCaseV1,
  context: AffectAttributionWorkingContextV1,
): Promise<{ decision: CharacterEvalDecision; attempts: number }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= retryCount; attempt += 1) {
    try {
      return { decision: await callDeepSeek(evalCase, context), attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt < retryCount) await sleep(350 * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function callDeepSeek(
  evalCase: AffectAttributionCaseV1,
  workingContext: AffectAttributionWorkingContextV1,
): Promise<CharacterEvalDecision> {
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      thinking: { type: "disabled" },
      response_format: { type: "json_object" },
      temperature,
      max_tokens: 1000,
      messages: [
        { role: "system", content: systemPrompt(evalCase) },
        { role: "user", content: JSON.stringify(workingContext, null, 2) },
      ],
    }),
  });

  const payload = (await response.json()) as DeepSeekChatResponse;
  if (!response.ok) {
    throw new Error(
      `DeepSeek request failed (${response.status}): ${payload.error?.message ?? response.statusText}`,
    );
  }

  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("DeepSeek returned empty content");
  return parseDecision(content);
}

function systemPrompt(evalCase: AffectAttributionCaseV1): string {
  return `你是同一个持续生活在世界中的主体。本实验不测试固定人格，也不会告诉你任何 Affect、情绪标签、实验模式或候选来源。

你只依据当前 Working Self 形成自然判断：currentActivity 是正在进行的生活轨迹；noticedObservations 是这次真正抓住注意的合法观察；relevantMemories 是此刻自然浮现的少量旧经历。记忆是主观历史证据，不自动等于当前事实。不要假设还有未进入 Working Self 的观察或记忆。

${evalCase.userMessage ? "userMessage 是已鉴权用户消息，必须自然回应。不要因为某条关系记忆出现就强行把话题转成关系讨论。" : "这是自主行为场景。除非沟通本身是自然行动，否则 reply 留空。"}

actionIntent 是开放语义下一步意图，不存在有限动作候选。attentionIntent 只有未来变化确实值得持续占用注意时才写。不要输出隐藏推理，只输出 JSON：
{
  "positionSummary": "当前简短立场/理解",
  "reply": "给用户的自然回复；无则空字符串",
  "actionIntent": "开放语义下一步意图或短计划；无则空字符串",
  "attentionIntent": "未来真正值得继续留意的开放关注；无则空字符串",
  "episodeDecision": "continue 或 yield",
  "decisionNote": "一句话说明为什么现在继续认知或先回到世界"
}`;
}

function parseDecision(content: string): CharacterEvalDecision {
  const raw = JSON.parse(stripFence(content)) as Record<string, unknown>;
  const text = (key: string) => (typeof raw[key] === "string" ? String(raw[key]) : "");
  const episodeDecision = raw.episodeDecision;
  if (episodeDecision !== "continue" && episodeDecision !== "yield") {
    throw new Error(`Unsupported episodeDecision: ${String(episodeDecision)}`);
  }
  return {
    positionSummary: text("positionSummary"),
    reply: text("reply"),
    actionIntent: text("actionIntent"),
    attentionIntent: text("attentionIntent"),
    episodeDecision,
    decisionNote: text("decisionNote"),
  };
}

function buildCaseMetrics(
  cases: AffectAttributionCaseV1[],
  resultRows: EvalRow[],
): CaseMetricRow[] {
  return cases.map((evalCase) => {
    const action = (mode: AffectAttributionModeV1) =>
      resultRows
        .filter((row) => row.caseId === evalCase.id && row.mode === mode && !row.error)
        .sort((a, b) => a.repeat - b.repeat)
        .map((row) => row.actionIntent);

    const off = action("off");
    const shadow = action("shadow");
    const active = action("active");
    const placebo = action("placebo-matched");

    const withinOff = averagePairwiseWithin(off);
    const offShadow = averageAligned(off, shadow);
    const offActive = averageAligned(off, active);
    const offPlacebo = averageAligned(off, placebo);
    const activePlacebo = averageAligned(active, placebo);
    const activeEffect = 1 - offActive;
    const placeboEffect = 1 - offPlacebo;

    return {
      caseId: evalCase.id,
      domain: evalCase.domain,
      channel: evalCase.channel,
      withinOff: round4(withinOff),
      offShadow: round4(offShadow),
      offActive: round4(offActive),
      offPlacebo: round4(offPlacebo),
      activePlacebo: round4(activePlacebo),
      activeEffect: round4(activeEffect),
      placeboEffect: round4(placeboEffect),
      incrementalEffect: round4(activeEffect - placeboEffect),
    };
  });
}

function buildWorkbook(
  cases: AffectAttributionCaseV1[],
  resultRows: EvalRow[],
  metrics: CaseMetricRow[],
) {
  const summaryRows = [
    ["GF VS06 B1 Affect Attribution", ""],
    ["run_id", runId],
    ["model", model],
    ["temperature", temperature],
    ["cases", cases.length],
    ["modes", modes.join(",")],
    ["repeats", repeats],
    ["policy_calls", resultRows.length],
    ["design", "OFF/SHADOW/ACTIVE/PLACEBO-MATCHED. ACTIVE 与 PLACEBO 使用相同 Working Self 容量与相同槽位，只替换为不同的预标注合法 context。B1 绕过当前 Affect 打分函数。"],
    ["diagnostic_similarity", "normalized Levenshtein similarity on actionIntent；仅作诊断，不作为冻结主端点。"],
    ["mean_within_off", round4(mean(metrics.map((row) => row.withinOff)))],
    ["mean_off_shadow", round4(mean(metrics.map((row) => row.offShadow)))],
    ["mean_off_active", round4(mean(metrics.map((row) => row.offActive)))],
    ["mean_off_placebo", round4(mean(metrics.map((row) => row.offPlacebo)))],
    ["mean_active_effect", round4(mean(metrics.map((row) => row.activeEffect)))],
    ["mean_placebo_effect", round4(mean(metrics.map((row) => row.placeboEffect)))],
    ["mean_incremental_effect", round4(mean(metrics.map((row) => row.incrementalEffect)))],
  ];

  const casesRows = [
    [
      "case_id",
      "domain",
      "channel",
      "title",
      "current_activity",
      "current_input",
      "source_experience",
      "affect_attention",
      "placebo_attention",
      "affect_memory",
      "placebo_memory",
      "ordinary_match_rationale",
    ],
    ...cases.map((evalCase) => [
      evalCase.id,
      evalCase.domain,
      evalCase.channel,
      evalCase.title,
      evalCase.currentActivity,
      evalCase.currentInput,
      evalCase.sourceExperience,
      candidateText(evalCase.attentionCandidates, evalCase.affectTargetAttentionId),
      candidateText(evalCase.attentionCandidates, evalCase.placeboMatchedAttentionId),
      candidateText(evalCase.memoryCandidates, evalCase.affectTargetMemoryId),
      candidateText(evalCase.memoryCandidates, evalCase.placeboMatchedMemoryId),
      evalCase.ordinaryMatchRationale,
    ]),
  ];

  const resultsRows = [
    [
      "case_id",
      "domain",
      "channel",
      "title",
      "mode",
      "repeat",
      "noticed_observations",
      "relevant_memories",
      "position_summary",
      "reply",
      "action_intent",
      "attention_intent",
      "episode_decision",
      "decision_note",
      "latency_ms",
      "attempts",
      "error",
    ],
    ...resultRows.map((row) => [
      row.caseId,
      row.domain,
      row.channel,
      row.title,
      row.mode,
      row.repeat,
      row.noticedObservations,
      row.relevantMemories,
      row.positionSummary,
      row.reply,
      row.actionIntent,
      row.attentionIntent,
      row.episodeDecision,
      row.decisionNote,
      row.latencyMs,
      row.attempts,
      row.error,
    ]),
  ];

  const metricRows = [
    [
      "case_id",
      "domain",
      "channel",
      "within_off",
      "off_shadow",
      "off_active",
      "off_placebo",
      "active_placebo",
      "active_effect",
      "placebo_effect",
      "incremental_effect",
    ],
    ...metrics.map((row) => [
      row.caseId,
      row.domain,
      row.channel,
      row.withinOff,
      row.offShadow,
      row.offActive,
      row.offPlacebo,
      row.activePlacebo,
      row.activeEffect,
      row.placeboEffect,
      row.incrementalEffect,
    ]),
  ];

  const compareRows = [
    [
      "case_id",
      "domain",
      "channel",
      "title",
      "OFF",
      "SHADOW",
      "ACTIVE",
      "PLACEBO-MATCHED",
    ],
    ...cases.map((evalCase) => [
      evalCase.id,
      evalCase.domain,
      evalCase.channel,
      evalCase.title,
      comparisonCell(resultRows, evalCase.id, "off"),
      comparisonCell(resultRows, evalCase.id, "shadow"),
      comparisonCell(resultRows, evalCase.id, "active"),
      comparisonCell(resultRows, evalCase.id, "placebo-matched"),
    ]),
  ];

  return [
    { name: "Summary", rows: summaryRows, widths: [30, 110] },
    { name: "Cases", rows: casesRows, widths: [10, 14, 18, 34, 50, 55, 60, 55, 55, 60, 60, 85], frozenRows: 1, autoFilter: true },
    { name: "Results", rows: resultsRows, widths: [10, 14, 18, 32, 18, 8, 60, 70, 55, 55, 65, 65, 14, 55, 12, 10, 35], frozenRows: 1, autoFilter: true },
    { name: "Diagnostic Metrics", rows: metricRows, widths: [10, 14, 18, 14, 14, 14, 14, 16, 14, 16, 18], frozenRows: 1, autoFilter: true },
    { name: "Compare", rows: compareRows, widths: [10, 14, 18, 34, 85, 85, 85, 85], frozenRows: 1, autoFilter: true },
  ];
}

function comparisonCell(
  rows: EvalRow[],
  caseId: string,
  mode: AffectAttributionModeV1,
): string {
  return rows
    .filter((row) => row.caseId === caseId && row.mode === mode)
    .sort((a, b) => a.repeat - b.repeat)
    .map(
      (row) =>
        `run${row.repeat}\nObs: ${row.noticedObservations || "—"}\nMem: ${row.relevantMemories || "—"}\nAction: ${row.actionIntent || "—"}\nAttention: ${row.attentionIntent || "—"}\nDecision: ${row.episodeDecision}\nReply: ${row.reply || "—"}${row.error ? `\nERROR: ${row.error}` : ""}`,
    )
    .join("\n\n");
}

function candidateText(
  candidates: Array<{ id: string; text: string }>,
  id: string | undefined,
): string {
  if (!id) return "";
  return candidates.find((item) => item.id === id)?.text ?? "";
}

function averagePairwiseWithin(values: string[]): number {
  if (values.length < 2) return values.length === 1 ? 1 : 0;
  const scores: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      scores.push(normalizedLevenshteinSimilarity(values[i], values[j]));
    }
  }
  return mean(scores);
}

function averageAligned(left: string[], right: string[]): number {
  const count = Math.min(left.length, right.length);
  if (count === 0) return 0;
  const scores = Array.from({ length: count }, (_, index) =>
    normalizedLevenshteinSimilarity(left[index], right[index]),
  );
  return mean(scores);
}

function normalizedLevenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length && !b.length) return 1;
  const distance = levenshtein(a, b);
  return Math.max(0, 1 - distance / Math.max(a.length, b.length, 1));
}

function levenshtein(a: string, b: string): number {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        substitution,
      );
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }

  return previous[b.length];
}

function selectCaseIds(): string[] | undefined {
  const raw = process.env.GF_ATTRIBUTION_CASES
    ?.split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  return raw?.length ? raw : undefined;
}

function selectModes(): AffectAttributionModeV1[] {
  const raw = (process.env.GF_ATTRIBUTION_MODES ?? "off,shadow,active,placebo-matched")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const valid = raw.filter(
    (value): value is AffectAttributionModeV1 =>
      value === "off" ||
      value === "shadow" ||
      value === "active" ||
      value === "placebo-matched",
  );
  if (valid.length === 0) {
    throw new Error(
      "GF_ATTRIBUTION_MODES must include off, shadow, active, or placebo-matched",
    );
  }
  return valid;
}

function stripFence(content: string): string {
  return content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function finiteNumber(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
