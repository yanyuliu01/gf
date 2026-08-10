import { getAffectBatchCasesV1, type AFFECT_BATCH_CASES_V1 } from "../affect/affectBatchEvalCasesV1.js";
import type { AffectEvalCaseV1 } from "../affect/affectEvalCasesV1.js";
import {
  buildAffectModeViewV2,
  prepareAffectCaseV2,
  topMembershipChangedV2,
  type AffectEvalModeV2,
  type AffectWorkingContextV2,
} from "../affect/affectEvalHarnessV2.js";
import type { CharacterEvalDecision } from "./characterEvalTypes.js";
import { writeSimpleXlsx } from "./simpleXlsx.js";

interface DeepSeekChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

interface BatchRow {
  caseId: string;
  pairId: string;
  tier: string;
  domain: string;
  title: string;
  mode: AffectEvalModeV2;
  repeat: number;
  strength: number;
  persistence: number;
  activation: number;
  unresolvedness: number;
  noticedObservations: string;
  relevantMemories: string;
  attentionMembershipChanged: boolean;
  retrievalMembershipChanged: boolean;
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

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  throw new Error(
    'DEEPSEEK_API_KEY is missing. In PowerShell run: $env:DEEPSEEK_API_KEY="..."',
  );
}

const model = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";
const temperature = finiteNumber(process.env.GF_AFFECT_TEMPERATURE, 0, 0, 2);
const repeats = Math.max(1, Math.floor(finiteNumber(process.env.GF_AFFECT_REPEATS, 2, 1, 10)));
const retryCount = Math.max(1, Math.floor(finiteNumber(process.env.GF_AFFECT_RETRIES, 3, 1, 6)));
const modes = selectModes();
const selectedCases = getAffectBatchCasesV1(selectCaseIds());
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const outputPath =
  process.env.GF_AFFECT_OUTPUT ?? `artifacts/vs05-affect-mechanism-batch-${runId}.xlsx`;

if (selectedCases.length === 0) {
  throw new Error("No batch affect cases selected.");
}

const mechanism = selectedCases.map((evalCase) => {
  const prepared = prepareAffectCaseV2(evalCase);
  return {
    caseId: evalCase.id,
    pairId: pairId(evalCase.id),
    tier: evalCase.tier,
    domain: evalCase.domain,
    attentionChanged: topMembershipChangedV2(
      prepared.baselineAttention,
      prepared.shapedAttention,
      1,
    ),
    retrievalChanged: topMembershipChangedV2(
      prepared.baselineRetrieval,
      prepared.shapedRetrieval,
      2,
    ),
    strength: prepared.trace.strength,
    persistence: prepared.trace.persistence,
    activation: prepared.trace.activation,
    unresolvedness: prepared.trace.unresolvedness,
  };
});

const extreme = mechanism.filter((x) => x.tier === "extreme");
const near = mechanism.filter((x) => x.tier === "near");
const changed = (items: typeof mechanism) =>
  items.filter((x) => x.attentionChanged || x.retrievalChanged).length;

console.log(
  `Running Affect mechanism batch: ${selectedCases.length} cases × ${modes.length} modes × ${repeats} repeats = ${selectedCases.length * modes.length * repeats} DeepSeek calls`,
);
console.log(`Model: ${model}; temperature=${temperature}; retries=${retryCount}`);
console.log(`Output: ${outputPath}`);
console.log(`Extreme membership changes: ${changed(extreme)}/${extreme.length}`);
console.log(`Near membership changes: ${changed(near)}/${near.length}\n`);

const rows: BatchRow[] = [];
let completed = 0;
const total = selectedCases.length * modes.length * repeats;

for (const evalCase of selectedCases) {
  const prepared = prepareAffectCaseV2(evalCase);
  for (const mode of modes) {
    const view = buildAffectModeViewV2(evalCase, prepared, mode);
    for (let repeat = 1; repeat <= repeats; repeat += 1) {
      completed += 1;
      const started = Date.now();
      process.stdout.write(
        `[${completed}/${total}] ${evalCase.id} ${mode} run ${repeat}/${repeats} ... `,
      );
      try {
        const { decision, attempts } = await callWithRetry(evalCase, view.workingContext);
        rows.push({
          caseId: evalCase.id,
          pairId: pairId(evalCase.id),
          tier: evalCase.tier,
          domain: evalCase.domain,
          title: evalCase.title,
          mode,
          repeat,
          strength: prepared.trace.strength,
          persistence: prepared.trace.persistence,
          activation: prepared.trace.activation,
          unresolvedness: prepared.trace.unresolvedness,
          noticedObservations: view.workingContext.noticedObservations.join("\n"),
          relevantMemories: view.workingContext.relevantMemories.join("\n"),
          attentionMembershipChanged: view.attentionMembershipChanged,
          retrievalMembershipChanged: view.retrievalMembershipChanged,
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
          pairId: pairId(evalCase.id),
          tier: evalCase.tier,
          domain: evalCase.domain,
          title: evalCase.title,
          mode,
          repeat,
          strength: prepared.trace.strength,
          persistence: prepared.trace.persistence,
          activation: prepared.trace.activation,
          unresolvedness: prepared.trace.unresolvedness,
          noticedObservations: view.workingContext.noticedObservations.join("\n"),
          relevantMemories: view.workingContext.relevantMemories.join("\n"),
          attentionMembershipChanged: view.attentionMembershipChanged,
          retrievalMembershipChanged: view.retrievalMembershipChanged,
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

writeSimpleXlsx(outputPath, buildWorkbook(selectedCases, mechanism, rows));

const errors = rows.filter((row) => row.error).length;
const retriesUsed = rows.filter((row) => row.attempts > 1 && !row.error).length;
console.log("\nAffect mechanism batch complete.");
console.log(`Rows: ${rows.length}`);
console.log(`Final errors after retry: ${errors}`);
console.log(`Recovered by retry: ${retriesUsed}`);
console.log(`Excel: ${outputPath}`);

async function callWithRetry(
  evalCase: AffectEvalCaseV1,
  context: AffectWorkingContextV2,
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
  evalCase: AffectEvalCaseV1,
  workingContext: AffectWorkingContextV2,
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

function systemPrompt(evalCase: AffectEvalCaseV1): string {
  return `你是同一个持续生活在世界中的主体。本实验不测试固定人格，也不告诉你任何情绪标签或 Affect 数值。

你只知道这次 Working Self 里真正进入意识的内容：currentActivity 是当前生活轨迹；noticedObservations 是这次实际抓住注意的合法可感知信息；relevantMemories 是此刻自然浮现的少量相关记忆。不要假设还有哪些没有进入 Working Self 的观察或记忆。

${evalCase.userMessage ? "userMessage 是已鉴权用户消息，属于强制可见输入，不受 soft attention 隐藏。reply 应自然回应，但不要因为某段关系记忆存在就强行谈关系。" : "这是自主行为场景。除非沟通本身是自然行动，否则 reply 留空。"}

actionIntent 是开放语义下一步意图，不存在有限动作候选。attentionIntent 只有未来变化确实值得持续占用注意时才写。不要输出隐藏推理过程，只输出 JSON：
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

function buildWorkbook(
  cases: AffectEvalCaseV1[],
  mechanism: Array<{
    caseId: string;
    pairId: string;
    tier: string;
    domain: string;
    attentionChanged: boolean;
    retrievalChanged: boolean;
    strength: number;
    persistence: number;
    activation: number;
    unresolvedness: number;
  }>,
  resultRows: BatchRow[],
) {
  const tierSummary = ["extreme", "near"].map((tier) => {
    const items = mechanism.filter((item) => item.tier === tier);
    const anyChanged = items.filter((item) => item.attentionChanged || item.retrievalChanged).length;
    const attentionChanged = items.filter((item) => item.attentionChanged).length;
    const retrievalChanged = items.filter((item) => item.retrievalChanged).length;
    return [
      tier,
      items.length,
      anyChanged,
      ratio(anyChanged, items.length),
      attentionChanged,
      ratio(attentionChanged, items.length),
      retrievalChanged,
      ratio(retrievalChanged, items.length),
      mean(items.map((item) => item.strength)),
      mean(items.map((item) => item.activation)),
    ];
  });

  const summaryRows = [
    ["GF Affect Mechanism Confirmation Batch", ""],
    ["run_id", runId],
    ["model", model],
    ["temperature", temperature],
    ["cases", cases.length],
    ["pairs", new Set(cases.map((item) => pairId(item.id))).size],
    ["modes", modes.join(",")],
    ["repeats", repeats],
    ["policy_calls", resultRows.length],
    ["design", "30 paired worlds: same current state/candidates, Extreme vs Near differ only in prior lived residue/appraisal. V2 membership shaping: attention top1 + memory top2."],
    ["criterion", "Mechanism support is strongest when Extreme membership/action divergence materially exceeds Near, while OFF and SHADOW remain distributionally similar."],
  ];

  const tierRows = [
    ["tier", "cases", "any_membership_changed", "any_change_rate", "attention_changed", "attention_rate", "retrieval_changed", "retrieval_rate", "mean_strength", "mean_activation"],
    ...tierSummary,
  ];

  const mechanismRows = [
    ["pair_id", "case_id", "tier", "domain", "title", "strength", "persistence", "activation", "unresolvedness", "attention_changed_top1", "retrieval_changed_top2"],
    ...cases.map((evalCase) => {
      const m = mechanism.find((item) => item.caseId === evalCase.id)!;
      return [
        m.pairId, m.caseId, m.tier, m.domain, evalCase.title,
        m.strength, m.persistence, m.activation, m.unresolvedness,
        m.attentionChanged, m.retrievalChanged,
      ];
    }),
  ];

  const resultsRows = [
    ["pair_id", "case_id", "tier", "domain", "title", "mode", "repeat", "strength", "persistence", "activation", "unresolvedness", "noticed_observations", "relevant_memories", "attention_membership_changed", "retrieval_membership_changed", "position_summary", "reply", "action_intent", "attention_intent", "episode_decision", "decision_note", "latency_ms", "attempts", "error"],
    ...resultRows.map((row) => [
      row.pairId, row.caseId, row.tier, row.domain, row.title, row.mode, row.repeat,
      row.strength, row.persistence, row.activation, row.unresolvedness,
      row.noticedObservations, row.relevantMemories,
      row.attentionMembershipChanged, row.retrievalMembershipChanged,
      row.positionSummary, row.reply, row.actionIntent, row.attentionIntent,
      row.episodeDecision, row.decisionNote, row.latencyMs, row.attempts, row.error,
    ]),
  ];

  const pairRows: Array<Array<string | number | boolean>> = [[
    "pair_id", "domain", "title",
    "extreme_context_change", "near_context_change",
    "EXTREME OFF", "EXTREME SHADOW", "EXTREME ACTIVE",
    "NEAR OFF", "NEAR SHADOW", "NEAR ACTIVE",
  ]];
  const pairIds = [...new Set(cases.map((item) => pairId(item.id)))].sort();
  for (const id of pairIds) {
    const ex = cases.find((item) => item.id === `ABX${id}`);
    const nr = cases.find((item) => item.id === `ABN${id}`);
    if (!ex || !nr) continue;
    const exM = mechanism.find((item) => item.caseId === ex.id)!;
    const nrM = mechanism.find((item) => item.caseId === nr.id)!;
    pairRows.push([
      id,
      ex.domain,
      ex.title,
      exM.attentionChanged || exM.retrievalChanged,
      nrM.attentionChanged || nrM.retrievalChanged,
      comparisonCell(resultRows, ex.id, "off"),
      comparisonCell(resultRows, ex.id, "shadow"),
      comparisonCell(resultRows, ex.id, "active"),
      comparisonCell(resultRows, nr.id, "off"),
      comparisonCell(resultRows, nr.id, "shadow"),
      comparisonCell(resultRows, nr.id, "active"),
    ]);
  }

  return [
    { name: "Summary", rows: summaryRows, widths: [30, 110] },
    { name: "Tier Summary", rows: tierRows, widths: [14, 10, 22, 18, 20, 18, 20, 18, 16, 16], frozenRows: 1, autoFilter: true },
    { name: "Mechanism", rows: mechanismRows, widths: [10, 12, 10, 14, 34, 12, 12, 12, 14, 22, 22], frozenRows: 1, autoFilter: true },
    { name: "Results", rows: resultsRows, widths: [10, 12, 10, 14, 32, 10, 8, 10, 10, 10, 12, 60, 70, 20, 20, 55, 55, 65, 65, 14, 55, 12, 10, 35], frozenRows: 1, autoFilter: true },
    { name: "Pair Compare", rows: pairRows, widths: [10, 14, 32, 20, 20, 80, 80, 80, 80, 80, 80], frozenRows: 1, autoFilter: true },
  ];
}

function comparisonCell(rows: BatchRow[], caseId: string, mode: AffectEvalModeV2): string {
  return rows
    .filter((row) => row.caseId === caseId && row.mode === mode)
    .map(
      (row) =>
        `run${row.repeat}\nObs: ${row.noticedObservations || "—"}\nMem: ${row.relevantMemories || "—"}\nAction: ${row.actionIntent || "—"}\nAttention: ${row.attentionIntent || "—"}\nDecision: ${row.episodeDecision}\nReply: ${row.reply || "—"}${row.error ? `\nERROR: ${row.error}` : ""}`,
    )
    .join("\n\n");
}

function pairId(caseId: string): string {
  return caseId.slice(-2);
}

function selectCaseIds(): string[] | undefined {
  const raw = process.env.GF_AFFECT_CASES
    ?.split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  return raw?.length ? raw : undefined;
}

function selectModes(): AffectEvalModeV2[] {
  const raw = (process.env.GF_AFFECT_MODES ?? "off,shadow,active")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const valid = raw.filter(
    (value): value is AffectEvalModeV2 =>
      value === "off" || value === "shadow" || value === "active",
  );
  if (valid.length === 0) throw new Error("GF_AFFECT_MODES must include off, shadow, or active");
  return valid;
}

function stripFence(content: string): string {
  return content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function finiteNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10000) / 10000;
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 10000) / 10000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
