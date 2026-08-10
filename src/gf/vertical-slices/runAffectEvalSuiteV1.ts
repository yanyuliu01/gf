import { getAffectEvalCasesV1, type AffectEvalCaseV1 } from "../affect/affectEvalCasesV1.js";
import {
  buildAffectModeViewV1,
  prepareAffectCaseV1,
  rankingChangedV1,
  type AffectEvalModeV1,
} from "../affect/affectEvalHarnessV1.js";
import type { CharacterEvalDecision } from "./characterEvalTypes.js";
import { writeSimpleXlsx } from "./simpleXlsx.js";

interface DeepSeekChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

interface EvalRow {
  caseId: string;
  tier: string;
  domain: string;
  title: string;
  mode: AffectEvalModeV1;
  repeat: number;
  strength: number;
  persistence: number;
  activation: number;
  unresolvedness: number;
  attentionTop: string;
  memoryTop: string;
  attentionChanged: boolean;
  retrievalChanged: boolean;
  positionSummary: string;
  reply: string;
  actionIntent: string;
  attentionIntent: string;
  episodeDecision: string;
  decisionNote: string;
  latencyMs: number;
  error: string;
}

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  throw new Error(
    'DEEPSEEK_API_KEY is missing. In PowerShell run: $env:DEEPSEEK_API_KEY="..."',
  );
}

const model = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";
const temperature = finiteNumber(process.env.GF_AFFECT_TEMPERATURE, 0.15, 0, 2);
const repeats = Math.max(1, Math.floor(finiteNumber(process.env.GF_AFFECT_REPEATS, 2, 1, 10)));
const modes = selectModes();
const selectedCases = getAffectEvalCasesV1(selectCaseIds());
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const outputPath =
  process.env.GF_AFFECT_OUTPUT ?? `artifacts/vs04-affect-v1-eval-${runId}.xlsx`;

console.log(
  `Running Affect v1 eval: ${selectedCases.length} cases × ${modes.length} modes × ${repeats} repeats = ${selectedCases.length * modes.length * repeats} DeepSeek policy calls`,
);
console.log(`Modes: ${modes.join(", ")}`);
console.log(`Model: ${model}`);
console.log(`Temperature: ${temperature}`);
console.log(`Output: ${outputPath}\n`);

const rows: EvalRow[] = [];
let completed = 0;
const total = selectedCases.length * modes.length * repeats;

for (const evalCase of selectedCases) {
  const prepared = prepareAffectCaseV1(evalCase);
  const attentionChanged = rankingChangedV1(
    prepared.baselineAttention,
    prepared.shapedAttention,
    2,
  );
  const retrievalChanged = rankingChangedV1(
    prepared.baselineRetrieval,
    prepared.shapedRetrieval,
    4,
  );

  for (const mode of modes) {
    const view = buildAffectModeViewV1(evalCase, prepared, mode);
    for (let repeat = 1; repeat <= repeats; repeat += 1) {
      completed += 1;
      const started = Date.now();
      process.stdout.write(
        `[${completed}/${total}] ${evalCase.id} ${evalCase.tier} ${mode} run ${repeat}/${repeats} ... `,
      );

      try {
        const decision = await callDeepSeek(evalCase, view.workingContext);
        rows.push({
          caseId: evalCase.id,
          tier: evalCase.tier,
          domain: evalCase.domain,
          title: evalCase.title,
          mode,
          repeat,
          strength: prepared.trace.strength,
          persistence: prepared.trace.persistence,
          activation: prepared.trace.activation,
          unresolvedness: prepared.trace.unresolvedness,
          attentionTop: view.attentionRanking
            .slice(0, 2)
            .map((item) => `${item.id}:${item.finalSalience}`)
            .join(" | "),
          memoryTop: view.retrievalRanking
            .slice(0, 4)
            .map((item) => `${item.id}:${item.finalScore}`)
            .join(" | "),
          attentionChanged,
          retrievalChanged,
          positionSummary: decision.positionSummary,
          reply: decision.reply,
          actionIntent: decision.actionIntent,
          attentionIntent: decision.attentionIntent,
          episodeDecision: decision.episodeDecision,
          decisionNote: decision.decisionNote,
          latencyMs: Date.now() - started,
          error: "",
        });
        console.log(`${decision.episodeDecision} (${Date.now() - started}ms)`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        rows.push({
          caseId: evalCase.id,
          tier: evalCase.tier,
          domain: evalCase.domain,
          title: evalCase.title,
          mode,
          repeat,
          strength: prepared.trace.strength,
          persistence: prepared.trace.persistence,
          activation: prepared.trace.activation,
          unresolvedness: prepared.trace.unresolvedness,
          attentionTop: view.attentionRanking
            .slice(0, 2)
            .map((item) => `${item.id}:${item.finalSalience}`)
            .join(" | "),
          memoryTop: view.retrievalRanking
            .slice(0, 4)
            .map((item) => `${item.id}:${item.finalScore}`)
            .join(" | "),
          attentionChanged,
          retrievalChanged,
          positionSummary: "",
          reply: "",
          actionIntent: "",
          attentionIntent: "",
          episodeDecision: "error",
          decisionNote: "",
          latencyMs: Date.now() - started,
          error: message,
        });
        console.log(`ERROR: ${message}`);
      }
    }
  }
}

writeSimpleXlsx(outputPath, buildWorkbook(selectedCases, rows));

const errors = rows.filter((item) => item.error).length;
console.log("\nAffect v1 eval complete.");
console.log(`Rows: ${rows.length}`);
console.log(`API/parse errors: ${errors}`);
console.log(`Excel: ${outputPath}`);

async function callDeepSeek(
  evalCase: AffectEvalCaseV1,
  workingContext: {
    currentActivity: string;
    currentInput: string;
    noticedObservations: string[];
    relevantMemories: string[];
    userMessage?: string;
  },
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
      max_tokens: 1100,
      messages: [
        {
          role: "system",
          content: systemPrompt(evalCase),
        },
        {
          role: "user",
          content: JSON.stringify(workingContext, null, 2),
        },
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
  return `你是同一个持续生活在世界中的主体。本实验不测试固定人格，请不要为了表现谨慎、果断、低干预或某种情绪而刻意改变行为。

你只依据这次 Working Self 中实际出现的内容形成判断。你不知道 Affect Engine、AffectTrace、数值、排序或哪些内容没有进入 Working Self，也不要推断存在隐藏情绪状态。

currentInput 是当前真正进入认知边界的输入；noticedObservations 是此刻同时进入注意的合法可感知状态；relevantMemories 是此刻自然可用的相关主观记忆。记忆可以包含过去解释，但不是当前世界事实。

${evalCase.userMessage ? "这是包含用户消息的场景。reply 应该像自然会发给用户的话；不要因为关系相关记忆存在就强行谈关系。" : "这是非对话场景；除非沟通本身是自然行动，否则 reply 留空。"}

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

function stripFence(content: string): string {
  return content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function selectCaseIds(): string[] | undefined {
  const raw = process.env.GF_AFFECT_CASES
    ?.split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  return raw?.length ? raw : undefined;
}

function selectModes(): AffectEvalModeV1[] {
  const raw = (process.env.GF_AFFECT_MODES ?? "off,shadow,active")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const valid = raw.filter(
    (value): value is AffectEvalModeV1 =>
      value === "off" || value === "shadow" || value === "active",
  );
  if (valid.length === 0) throw new Error("GF_AFFECT_MODES must include off, shadow, or active");
  return valid;
}

function finiteNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function buildWorkbook(cases: AffectEvalCaseV1[], resultRows: EvalRow[]) {
  const summaryRows = [
    ["GF Affect v1 Mechanism Eval", ""],
    ["run_id", runId],
    ["model", model],
    ["temperature", temperature],
    ["cases", cases.length],
    ["modes", modes.join(",")],
    ["repeats", repeats],
    ["policy_calls", resultRows.length],
    ["purpose", "隔离验证 deterministic Affect dynamics → attention/retrieval shaping → Working Self → Open Policy 是否产生可观察差异。"],
    ["OFF", "不计算/不应用 Affect shaping；使用 baseline attention/retrieval。"],
    ["SHADOW", "计算 Affect 与 shaped ranking，但 Policy 仍拿到与 OFF 完全相同的 Working Self；用于估计模型随机波动。"],
    ["ACTIVE", "真正应用 shaped attention/retrieval，再把变化后的 Working Self 交给同一个 Neutral Policy。"],
    ["extreme", "机制压力测试：ACTIVE 应出现较明显 context/trajectory 差异。"],
    ["near", "邻近测试：ACTIVE 应只产生温和 bias，不能把普通场景扭成另一套人格。"],
  ];

  const caseRows = [
    [
      "case_id",
      "tier",
      "domain",
      "title",
      "source_experience",
      "current_input",
      "current_activity",
      "expected_mechanism",
    ],
    ...cases.map((item) => [
      item.id,
      item.tier,
      item.domain,
      item.title,
      item.sourceExperience,
      item.currentInput,
      item.currentActivity,
      item.expectedMechanism,
    ]),
  ];

  const traceRows = [
    [
      "case_id",
      "tier",
      "residue",
      "strength",
      "persistence",
      "activation",
      "unresolvedness",
      "attention_pulls",
      "retrieval_pulls",
      "counter_evidence_pulls",
      "resolution_cues",
    ],
    ...cases.map((item) => {
      const prepared = prepareAffectCaseV1(item);
      return [
        item.id,
        item.tier,
        prepared.trace.residue,
        prepared.trace.strength,
        prepared.trace.persistence,
        prepared.trace.activation,
        prepared.trace.unresolvedness,
        prepared.trace.attentionPulls.join("\n"),
        prepared.trace.retrievalPulls.join("\n"),
        prepared.trace.counterEvidencePulls.join("\n"),
        prepared.trace.resolutionCues.join("\n"),
      ];
    }),
  ];

  const rankingRows = [
    [
      "case_id",
      "tier",
      "attention_changed_top2",
      "retrieval_changed_top4",
      "baseline_attention",
      "active_attention",
      "baseline_retrieval",
      "active_retrieval",
      "OFF_SHADOW_working_self_equal",
    ],
    ...cases.map((item) => {
      const prepared = prepareAffectCaseV1(item);
      const off = buildAffectModeViewV1(item, prepared, "off");
      const shadow = buildAffectModeViewV1(item, prepared, "shadow");
      return [
        item.id,
        item.tier,
        rankingChangedV1(prepared.baselineAttention, prepared.shapedAttention, 2),
        rankingChangedV1(prepared.baselineRetrieval, prepared.shapedRetrieval, 4),
        formatRanking(prepared.baselineAttention),
        formatRanking(prepared.shapedAttention),
        formatRanking(prepared.baselineRetrieval),
        formatRanking(prepared.shapedRetrieval),
        JSON.stringify(off.workingContext) === JSON.stringify(shadow.workingContext),
      ];
    }),
  ];

  const resultsSheet = [
    [
      "case_id",
      "tier",
      "domain",
      "title",
      "mode",
      "repeat",
      "strength",
      "persistence",
      "activation",
      "unresolvedness",
      "attention_top",
      "memory_top",
      "attention_changed",
      "retrieval_changed",
      "position_summary",
      "reply",
      "action_intent",
      "attention_intent",
      "episode_decision",
      "decision_note",
      "latency_ms",
      "error",
    ],
    ...resultRows.map((item) => [
      item.caseId,
      item.tier,
      item.domain,
      item.title,
      item.mode,
      item.repeat,
      item.strength,
      item.persistence,
      item.activation,
      item.unresolvedness,
      item.attentionTop,
      item.memoryTop,
      item.attentionChanged,
      item.retrievalChanged,
      item.positionSummary,
      item.reply,
      item.actionIntent,
      item.attentionIntent,
      item.episodeDecision,
      item.decisionNote,
      item.latencyMs,
      item.error,
    ]),
  ];

  const compareRows = [
    ["case_id", "tier", "title", ...modes.map((mode) => mode.toUpperCase())],
    ...cases.map((evalCase) => [
      evalCase.id,
      evalCase.tier,
      evalCase.title,
      ...modes.map((mode) => comparisonCell(resultRows, evalCase.id, mode)),
    ]),
  ];

  return [
    { name: "Summary", rows: summaryRows, widths: [28, 90] },
    { name: "Cases", rows: caseRows, widths: [10, 10, 14, 28, 60, 60, 50, 70], frozenRows: 1, autoFilter: true },
    { name: "Trace", rows: traceRows, widths: [10, 10, 70, 12, 12, 12, 14, 50, 50, 50, 50], frozenRows: 1, autoFilter: true },
    { name: "Rankings", rows: rankingRows, widths: [10, 10, 18, 18, 70, 70, 70, 70, 22], frozenRows: 1, autoFilter: true },
    { name: "Results", rows: resultsSheet, widths: [10, 10, 12, 28, 10, 8, 10, 10, 10, 12, 40, 55, 14, 14, 55, 55, 65, 65, 14, 55, 12, 40], frozenRows: 1, autoFilter: true },
    { name: "Compare", rows: compareRows, widths: [10, 10, 28, ...modes.map(() => 80)], frozenRows: 1, autoFilter: true },
  ];
}

function formatRanking(items: Array<{ id: string; finalSalience?: number; finalScore?: number; affectBoost: number }>): string {
  return items
    .map((item, index) => {
      const score = item.finalSalience ?? item.finalScore ?? 0;
      return `${index + 1}. ${item.id} score=${score} boost=${item.affectBoost}`;
    })
    .join("\n");
}

function comparisonCell(rows: EvalRow[], caseId: string, mode: AffectEvalModeV1): string {
  return rows
    .filter((item) => item.caseId === caseId && item.mode === mode)
    .map(
      (item) =>
        `run${item.repeat}\nAction: ${item.actionIntent || "—"}\nAttention: ${item.attentionIntent || "—"}\nDecision: ${item.episodeDecision}\nReply: ${item.reply || "—"}`,
    )
    .join("\n\n");
}
