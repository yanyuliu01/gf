import { getAffectEvalCasesV1, type AffectEvalCaseV1 } from "../affect/affectEvalCasesV1.js";
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

interface EvalRowV2 {
  caseId: string;
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
const modes = selectModes();
const selectedCases = getAffectEvalCasesV1(selectCaseIds());
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const outputPath =
  process.env.GF_AFFECT_OUTPUT ?? `artifacts/vs04-affect-v2-membership-${runId}.xlsx`;

const mechanismSummary = selectedCases.map((evalCase) => {
  const prepared = prepareAffectCaseV2(evalCase);
  return {
    caseId: evalCase.id,
    tier: evalCase.tier,
    attentionMembershipChanged: topMembershipChangedV2(
      prepared.baselineAttention,
      prepared.shapedAttention,
      1,
    ),
    retrievalMembershipChanged: topMembershipChangedV2(
      prepared.baselineRetrieval,
      prepared.shapedRetrieval,
      2,
    ),
  };
});

console.log(
  `Running Affect v2 membership eval: ${selectedCases.length} cases × ${modes.length} modes × ${repeats} repeats = ${selectedCases.length * modes.length * repeats} DeepSeek policy calls`,
);
console.log(`Modes: ${modes.join(", ")}`);
console.log(`Model: ${model}`);
console.log(`Temperature: ${temperature}`);
console.log(`Output: ${outputPath}`);
console.log(
  `Extreme context membership changes: ${mechanismSummary.filter((x) => x.tier === "extreme" && (x.attentionMembershipChanged || x.retrievalMembershipChanged)).length}/${mechanismSummary.filter((x) => x.tier === "extreme").length}`,
);
console.log(
  `Near context membership changes: ${mechanismSummary.filter((x) => x.tier === "near" && (x.attentionMembershipChanged || x.retrievalMembershipChanged)).length}/${mechanismSummary.filter((x) => x.tier === "near").length}\n`,
);

const rows: EvalRowV2[] = [];
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
          error: message,
        });
        console.log(`ERROR: ${message}`);
      }
    }
  }
}

writeSimpleXlsx(outputPath, buildWorkbook(selectedCases, rows));

const errors = rows.filter((item) => item.error).length;
console.log("\nAffect v2 membership eval complete.");
console.log(`Rows: ${rows.length}`);
console.log(`API/parse errors: ${errors}`);
console.log(`Excel: ${outputPath}`);

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
      max_tokens: 1100,
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

function finiteNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function buildWorkbook(cases: AffectEvalCaseV1[], resultRows: EvalRowV2[]) {
  const summaryRows = [
    ["GF Affect v2 Context Membership Eval", ""],
    ["run_id", runId],
    ["model", model],
    ["temperature", temperature],
    ["cases", cases.length],
    ["modes", modes.join(",")],
    ["repeats", repeats],
    ["policy_calls", resultRows.length],
    ["key_change", "V1 只重排了同一组信息。V2 将 Working Self capacity 收紧为 attention top1 + memory top2，并不再把 raw currentInput 直接旁路给 Policy。"],
    ["purpose", "验证 Affect 是否能改变进入 Working Self 的信息成员，而不仅是排序；随后观察这种 context membership change 是否改变开放行为。"],
    ["OFF", "baseline top1 attention + top2 retrieval"],
    ["SHADOW", "计算 Affect，但 Policy 与 OFF 得到完全相同 Working Self"],
    ["ACTIVE", "Affect shaping 真正决定 top1 attention + top2 retrieval"],
  ];

  const rankingRows = [
    ["case_id", "tier", "attention_membership_changed_top1", "retrieval_membership_changed_top2", "baseline_attention", "active_attention", "baseline_retrieval", "active_retrieval"],
    ...cases.map((item) => {
      const prepared = prepareAffectCaseV2(item);
      return [
        item.id,
        item.tier,
        topMembershipChangedV2(prepared.baselineAttention, prepared.shapedAttention, 1),
        topMembershipChangedV2(prepared.baselineRetrieval, prepared.shapedRetrieval, 2),
        formatRanking(prepared.baselineAttention),
        formatRanking(prepared.shapedAttention),
        formatRanking(prepared.baselineRetrieval),
        formatRanking(prepared.shapedRetrieval),
      ];
    }),
  ];

  const resultsSheet = [
    ["case_id", "tier", "domain", "title", "mode", "repeat", "strength", "persistence", "activation", "unresolvedness", "noticed_observations", "relevant_memories", "attention_membership_changed", "retrieval_membership_changed", "position_summary", "reply", "action_intent", "attention_intent", "episode_decision", "decision_note", "latency_ms", "error"],
    ...resultRows.map((item) => [
      item.caseId, item.tier, item.domain, item.title, item.mode, item.repeat,
      item.strength, item.persistence, item.activation, item.unresolvedness,
      item.noticedObservations, item.relevantMemories,
      item.attentionMembershipChanged, item.retrievalMembershipChanged,
      item.positionSummary, item.reply, item.actionIntent, item.attentionIntent,
      item.episodeDecision, item.decisionNote, item.latencyMs, item.error,
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
    { name: "Summary", rows: summaryRows, widths: [30, 100] },
    { name: "Rankings", rows: rankingRows, widths: [10, 10, 24, 24, 70, 70, 70, 70], frozenRows: 1, autoFilter: true },
    { name: "Results", rows: resultsSheet, widths: [10, 10, 12, 30, 10, 8, 10, 10, 10, 12, 60, 70, 20, 20, 55, 55, 65, 65, 14, 55, 12, 40], frozenRows: 1, autoFilter: true },
    { name: "Compare", rows: compareRows, widths: [10, 10, 30, ...modes.map(() => 90)], frozenRows: 1, autoFilter: true },
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

function comparisonCell(rows: EvalRowV2[], caseId: string, mode: AffectEvalModeV2): string {
  return rows
    .filter((item) => item.caseId === caseId && item.mode === mode)
    .map(
      (item) =>
        `run${item.repeat}\nSeen: ${item.noticedObservations || "—"}\nMemory: ${item.relevantMemories || "—"}\nAction: ${item.actionIntent || "—"}\nAttention: ${item.attentionIntent || "—"}\nDecision: ${item.episodeDecision}\nReply: ${item.reply || "—"}`,
    )
    .join("\n\n");
}
