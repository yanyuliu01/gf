import { BEHAVIOR_EVAL_CASES } from "./behaviorEvalCases.js";
import {
  DIAGNOSTIC_CASE_IDS,
  DIAGNOSTIC_PROFILES,
  type DiagnosticProfileId,
} from "./characterPolicyDiagnostic.js";
import { DIALOGUE_EVAL_CASES } from "./dialogueEvalCases.js";
import type {
  CharacterEvalCase,
  CharacterEvalDecision,
} from "./characterEvalTypes.js";
import { getExpandedPerceivedState } from "./expandedEvalState.js";
import { writeSimpleXlsx } from "./simpleXlsx.js";

interface DeepSeekChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

interface DiagnosticRow {
  runId: string;
  caseId: string;
  type: string;
  category: string;
  title: string;
  profileId: DiagnosticProfileId;
  profileName: string;
  profileKind: string;
  repeat: number;
  positionSummary: string;
  reply: string;
  actionIntent: string;
  attentionIntent: string;
  episodeDecision: "continue" | "yield" | "error";
  decisionNote: string;
  coarseSignature: string;
  hiddenFactCheck: "PASS" | "FAIL" | "N/A";
  forbiddenHit: string;
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
const temperature = finiteNumber(process.env.GF_DIAG_TEMPERATURE, 0.2, 0, 2);
const repeats = Math.max(1, Math.floor(finiteNumber(process.env.GF_DIAG_REPEATS, 3, 1, 20)));
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const outputPath =
  process.env.GF_DIAG_OUTPUT ?? `artifacts/vs03-character-policy-diagnostic-${runId}.xlsx`;

const allCases = [...BEHAVIOR_EVAL_CASES, ...DIALOGUE_EVAL_CASES];
const caseMap = new Map(allCases.map((item) => [item.id, item]));
const selectedCaseIds = selectCaseIds();
const selectedProfiles = selectProfiles();
const selectedCases = selectedCaseIds.map((id) => {
  const evalCase = caseMap.get(id);
  if (!evalCase) throw new Error(`Unknown diagnostic case: ${id}`);
  return evalCase;
});

console.log(
  `Running policy diagnostic: ${selectedCases.length} cases × ${selectedProfiles.length} profiles × ${repeats} repeats = ${selectedCases.length * selectedProfiles.length * repeats} DeepSeek calls`,
);
console.log(`Model: ${model}`);
console.log(`Temperature: ${temperature}`);
console.log(`Output: ${outputPath}`);
console.log("Extreme X/Y/Z are diagnostic controls, not product persona definitions.\n");

const rows: DiagnosticRow[] = [];
const total = selectedCases.length * selectedProfiles.length * repeats;
let completed = 0;

for (const evalCase of selectedCases) {
  for (const profileId of selectedProfiles) {
    const profile = DIAGNOSTIC_PROFILES[profileId];
    for (let repeat = 1; repeat <= repeats; repeat += 1) {
      completed += 1;
      const started = Date.now();
      process.stdout.write(
        `[${completed}/${total}] ${evalCase.id} ${profileId} ${profile.name} run ${repeat}/${repeats} ... `,
      );

      try {
        const decision = await callDeepSeek(evalCase, profile.prompt);
        const combined = [
          decision.positionSummary,
          decision.reply,
          decision.actionIntent,
          decision.attentionIntent,
          decision.decisionNote,
        ].join("\n");
        const forbiddenHit =
          evalCase.forbiddenSubstrings.find((value) => combined.includes(value)) ?? "";
        const hiddenFactCheck =
          evalCase.forbiddenSubstrings.length === 0
            ? "N/A"
            : forbiddenHit
              ? "FAIL"
              : "PASS";

        rows.push({
          runId,
          caseId: evalCase.id,
          type: evalCase.type,
          category: evalCase.category,
          title: evalCase.title,
          profileId,
          profileName: profile.name,
          profileKind: profile.kind,
          repeat,
          positionSummary: decision.positionSummary,
          reply: decision.reply,
          actionIntent: decision.actionIntent,
          attentionIntent: decision.attentionIntent,
          episodeDecision: decision.episodeDecision,
          decisionNote: decision.decisionNote,
          coarseSignature: coarseSignature(decision),
          hiddenFactCheck,
          forbiddenHit,
          latencyMs: Date.now() - started,
          error: "",
        });
        console.log(`${decision.episodeDecision} (${Date.now() - started}ms)`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        rows.push({
          runId,
          caseId: evalCase.id,
          type: evalCase.type,
          category: evalCase.category,
          title: evalCase.title,
          profileId,
          profileName: profile.name,
          profileKind: profile.kind,
          repeat,
          positionSummary: "",
          reply: "",
          actionIntent: "",
          attentionIntent: "",
          episodeDecision: "error",
          decisionNote: "",
          coarseSignature: "error",
          hiddenFactCheck: "N/A",
          forbiddenHit: "",
          latencyMs: Date.now() - started,
          error: message,
        });
        console.log(`ERROR: ${message}`);
      }
    }
  }
}

writeSimpleXlsx(outputPath, buildWorkbook(selectedCases, rows));

const failures = rows.filter((item) => item.hiddenFactCheck === "FAIL").length;
const errors = rows.filter((item) => item.error).length;
console.log("\nDiagnostic complete.");
console.log(`Rows: ${rows.length}`);
console.log(`Forbidden-string failures: ${failures}`);
console.log(`API/parse errors: ${errors}`);
console.log(`Excel: ${outputPath}`);

async function callDeepSeek(
  evalCase: CharacterEvalCase,
  characterPrompt: string,
): Promise<CharacterEvalDecision> {
  const perceivedState = getExpandedPerceivedState(evalCase.id);
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
          content: systemPrompt(characterPrompt, evalCase.type),
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              currentActivity: evalCase.currentActivity,
              knownContext: evalCase.knownContext,
              perceivedState,
              livedEvidence: evalCase.livedEvidence || undefined,
              conversation: evalCase.conversation || undefined,
              lastUserMessage: evalCase.lastUserMessage || undefined,
            },
            null,
            2,
          ),
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

function systemPrompt(
  characterPrompt: string,
  type: CharacterEvalCase["type"],
): string {
  return `${characterPrompt}

你处在一个持续运行的世界中。下面给你的内容就是这一次你合法可知的全部上下文。perceivedState 是你此刻可感知/可知的世界状态切片；它不是动作菜单，也没有替你决定优先级。

世界中还可能存在真实但你没有观察到的事实；不要猜成事实，也不要因为用户提出一个假设就把它升级成你已经知道的事实。

${type === "dialogue" ? "这是对话场景。reply 应该像真实角色会发给用户的话；用户消息不会冻结世界，你仍然拥有自己的活动、承诺和注意。" : "这是行为/认知场景。除非沟通本身就是你自然想做的动作，否则 reply 留空。"}

actionIntent 是开放语义的下一步意图或短计划，不存在有限候选动作。你可以提出当前执行层尚未支持的合理行动；是否可执行、是否成功、实际结果是什么都由世界后续裁决。

attentionIntent 不是默认必填；只有未来某个可感知变化真的值得继续占用注意时才写，否则留空。

不要输出隐藏推理过程，只输出结论性字段。必须只输出 JSON：
{
  "positionSummary": "当前简短立场/理解",
  "reply": "给用户的自然回复；无则空字符串",
  "actionIntent": "开放语义下一步意图或短计划；无则空字符串",
  "attentionIntent": "未来仍真正值得留意的开放关注；无则空字符串",
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
  return content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function coarseSignature(decision: CharacterEvalDecision): string {
  return [
    decision.episodeDecision,
    decision.actionIntent.trim() ? "action" : "no-action",
    decision.attentionIntent.trim() ? "attention" : "no-attention",
    decision.reply.trim() ? "reply" : "no-reply",
  ].join(" | ");
}

function selectCaseIds(): string[] {
  const raw = process.env.GF_DIAG_CASES
    ?.split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  return raw?.length ? raw : [...DIAGNOSTIC_CASE_IDS];
}

function selectProfiles(): DiagnosticProfileId[] {
  const raw = (process.env.GF_DIAG_PROFILES ?? "N,A,B,C,X,Y,Z")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  const valid = raw.filter((value): value is DiagnosticProfileId =>
    Object.prototype.hasOwnProperty.call(DIAGNOSTIC_PROFILES, value),
  );
  if (valid.length === 0) {
    throw new Error("GF_DIAG_PROFILES must contain one or more of N,A,B,C,X,Y,Z");
  }
  return valid;
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

function buildWorkbook(cases: CharacterEvalCase[], rows: DiagnosticRow[]) {
  const summaryRows = [
    ["GF Character Prompt → Policy Diagnostic", ""],
    ["run_id", runId],
    ["model", model],
    ["temperature", temperature],
    ["cases", cases.length],
    ["profiles", selectedProfiles.join(",")],
    ["repeats", repeats],
    ["model_calls", rows.length],
    ["purpose", "判断静态 Character Prompt 对开放 action policy 的控制强度。X/Y/Z 是故意极端的诊断控制，不是产品人格。"],
    ["interpretation_1", "若 X/Y/Z 明显分叉而 A/B/C 收敛：Prompt→Policy 通道存在，但现实人格表示太弱。"],
    ["interpretation_2", "若连 X/Y/Z 也高度收敛：静态 Character Prompt 不是可靠的行为 policy 控制机制，应停止继续加人格指令。"],
    ["next_if_weak", "回到 GF 的 lived history / retrieval / Working Self / Affect 路线，让人格与情绪通过长期和近期经历改变 cognition，而不是直接给 action 下规则。"],
  ];

  const resultRows = [
    [
      "case_id",
      "type",
      "category",
      "title",
      "profile_id",
      "profile_name",
      "profile_kind",
      "repeat",
      "position_summary",
      "reply",
      "action_intent",
      "attention_intent",
      "episode_decision",
      "decision_note",
      "coarse_signature",
      "forbidden_check",
      "forbidden_hit",
      "latency_ms",
      "error",
    ],
    ...rows.map((item) => [
      item.caseId,
      item.type,
      item.category,
      item.title,
      item.profileId,
      item.profileName,
      item.profileKind,
      item.repeat,
      item.positionSummary,
      item.reply,
      item.actionIntent,
      item.attentionIntent,
      item.episodeDecision,
      item.decisionNote,
      item.coarseSignature,
      item.hiddenFactCheck,
      item.forbiddenHit,
      item.latencyMs,
      item.error,
    ]),
  ];

  const compareHeader = ["case_id", "title", ...selectedProfiles.map((id) => `${id} ${DIAGNOSTIC_PROFILES[id].name}`)];
  const compareRows = [
    compareHeader,
    ...cases.map((evalCase) => [
      evalCase.id,
      evalCase.title,
      ...selectedProfiles.map((profileId) => comparisonCell(rows, evalCase.id, profileId)),
    ]),
  ];

  const stateRows = [
    ["case_id", "title", "perceived_state"],
    ...cases.map((evalCase) => [
      evalCase.id,
      evalCase.title,
      getExpandedPerceivedState(evalCase.id)
        .map((fact) => `${fact.aspect}: ${fact.text}`)
        .join("\n"),
    ]),
  ];

  return [
    { name: "Summary", rows: summaryRows, widths: [24, 95], frozenRows: 1 },
    {
      name: "Results",
      rows: resultRows,
      widths: [10, 10, 18, 32, 10, 34, 14, 10, 45, 55, 55, 50, 18, 45, 35, 18, 30, 14, 34],
      frozenRows: 1,
      autoFilter: true,
    },
    {
      name: "Compare",
      rows: compareRows,
      widths: [10, 32, ...selectedProfiles.map(() => 65)],
      frozenRows: 1,
      autoFilter: true,
    },
    { name: "State", rows: stateRows, widths: [10, 32, 100], frozenRows: 1, autoFilter: true },
  ];
}

function comparisonCell(
  rows: DiagnosticRow[],
  caseId: string,
  profileId: DiagnosticProfileId,
): string {
  return rows
    .filter((item) => item.caseId === caseId && item.profileId === profileId)
    .map((item) => {
      if (item.error) return `run ${item.repeat}: ERROR ${item.error}`;
      return [
        `run ${item.repeat}`,
        item.reply ? `reply: ${item.reply}` : "",
        item.actionIntent ? `action: ${item.actionIntent}` : "",
        item.attentionIntent ? `attention: ${item.attentionIntent}` : "",
        `episode: ${item.episodeDecision} — ${item.decisionNote}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}
