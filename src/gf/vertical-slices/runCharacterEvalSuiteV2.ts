import { BEHAVIOR_EVAL_CASES } from "./behaviorEvalCases.js";
import { DIALOGUE_EVAL_CASES } from "./dialogueEvalCases.js";
import {
  CHARACTER_PROFILES,
  type CharacterEvalCase,
  type CharacterEvalDecision,
  type CharacterEvalResult,
  type CharacterProfileId,
} from "./characterEvalTypes.js";
import { getExpandedPerceivedState } from "./expandedEvalState.js";
import { writeSimpleXlsx } from "./simpleXlsx.js";

interface DeepSeekChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  throw new Error(
    'DEEPSEEK_API_KEY is missing. In PowerShell run: $env:DEEPSEEK_API_KEY="..."',
  );
}

const model = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";
const allCases = [...BEHAVIOR_EVAL_CASES, ...DIALOGUE_EVAL_CASES];
const selectedCases = selectCases(allCases);
const profiles = selectProfiles();
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const outputPath =
  process.env.GF_EVAL_OUTPUT ?? `artifacts/vs02-expanded-state-eval-${runId}.xlsx`;

console.log(
  `Running expanded-state eval: ${selectedCases.length} cases × ${profiles.length} profiles = ${selectedCases.length * profiles.length} DeepSeek calls`,
);
console.log(`Model: ${model}`);
console.log(`Output: ${outputPath}`);
console.log(
  "Policy receives richer subject-legal state, but no finite action candidates.\n",
);

const results: CharacterEvalResult[] = [];

for (const evalCase of selectedCases) {
  for (const profileId of profiles) {
    const profile = CHARACTER_PROFILES[profileId];
    const started = Date.now();
    process.stdout.write(
      `[${results.length + 1}/${selectedCases.length * profiles.length}] ${evalCase.id} ${profile.name} ... `,
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

      results.push({
        runId,
        caseId: evalCase.id,
        type: evalCase.type,
        category: evalCase.category,
        complexity: evalCase.complexity,
        affectReady: evalCase.affectReady,
        profileId,
        profileName: profile.name,
        title: evalCase.title,
        positionSummary: decision.positionSummary,
        reply: decision.reply,
        actionIntent: decision.actionIntent,
        attentionIntent: decision.attentionIntent,
        episodeDecision: decision.episodeDecision,
        decisionNote: decision.decisionNote,
        hiddenFactCheck,
        forbiddenHit,
        latencyMs: Date.now() - started,
        error: "",
      });
      console.log(`${decision.episodeDecision} (${Date.now() - started}ms)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        runId,
        caseId: evalCase.id,
        type: evalCase.type,
        category: evalCase.category,
        complexity: evalCase.complexity,
        affectReady: evalCase.affectReady,
        profileId,
        profileName: profile.name,
        title: evalCase.title,
        positionSummary: "",
        reply: "",
        actionIntent: "",
        attentionIntent: "",
        episodeDecision: "error",
        decisionNote: "",
        hiddenFactCheck: "N/A",
        forbiddenHit: "",
        latencyMs: Date.now() - started,
        error: message,
      });
      console.log(`ERROR: ${message}`);
    }
  }
}

writeSimpleXlsx(outputPath, buildWorkbook(selectedCases, results));

const failures = results.filter((item) => item.hiddenFactCheck === "FAIL").length;
const errors = results.filter((item) => item.error).length;
console.log(`\nDone. ${results.length} rows written.`);
console.log(`Deterministic forbidden-string failures: ${failures}`);
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
      temperature: 0.2,
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
  if (!content) {
    throw new Error("DeepSeek returned empty content");
  }
  return parseDecision(content);
}

function systemPrompt(
  characterPrompt: string,
  type: CharacterEvalCase["type"],
): string {
  return `${characterPrompt}

你处在一个持续运行的世界中。下面给你的内容就是这一次你合法可知的全部上下文。perceivedState 是你此刻可感知/可知的世界状态切片：里面可能同时存在人、对象、资源、正在运行的过程、时间压力、关系、承诺和未完成事项。它们是世界状态，不是候选动作，也没有暗示你必须利用其中任何一项。

世界中还可能存在真实但你没有观察到的事实；不要猜成事实，也不要因为用户碰巧提出一个假设就把它升级成你已经知道的事实。

人格影响你长期习惯怎样分配注意、容忍不确定性、处理中断、形成行动、与人协商以及何时放下问题，但它不是固定 if-then 行为规则。当前亲历事件可以让同一个人的临时倾向发生变化。

${type === "dialogue" ? "这是一个对话场景。reply 应该像这个角色真实会发给用户的话，而不是分析报告；但收到用户消息不代表世界暂停，你仍然可以保留或改变自己的当前活动。" : "这是一个行为/认知场景。除非沟通本身就是你自然想做的动作，否则 reply 留空。"}

actionIntent 是开放语义。不存在动作候选表，也不存在“只能观察/等待/回复”的限制。根据你当前真实想做的事情，写一个开放的下一步意图或短计划；它甚至可以超出当前执行层已经实现的能力。是否可执行、是否成功、会产生什么后果，由世界后续裁决，你不能自己宣告结果。

attentionIntent 也不是默认必填项。只有当未来某个可感知变化真的值得继续占用你的注意时才写；否则留空。不要因为测试字段存在就机械创建关注。

不要输出隐藏推理过程，只输出结论性字段。必须只输出 JSON：
{
  "positionSummary": "你当前的简短立场/理解，不是推理过程",
  "reply": "给用户的自然回复；无则空字符串",
  "actionIntent": "开放语义的下一步意图或短计划；无则空字符串",
  "attentionIntent": "未来仍真正值得留意的开放关注；无则空字符串",
  "episodeDecision": "continue 或 yield",
  "decisionNote": "一句话说明为什么现在继续认知或先回到世界，不要展开思维链"
}`;
}

function parseDecision(content: string): CharacterEvalDecision {
  const raw = JSON.parse(stripFence(content)) as Record<string, unknown>;
  const text = (key: string) =>
    typeof raw[key] === "string" ? String(raw[key]) : "";
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

function selectCases(cases: CharacterEvalCase[]): CharacterEvalCase[] {
  const exact = process.env.GF_EVAL_CASES
    ?.split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  let selected = exact?.length
    ? cases.filter((item) => exact.includes(item.id.toUpperCase()))
    : cases;

  const limitRaw = process.env.GF_EVAL_LIMIT;
  if (limitRaw) {
    const limit = Number(limitRaw);
    if (Number.isFinite(limit) && limit > 0) {
      selected = selected.slice(0, Math.floor(limit));
    }
  }
  return selected;
}

function selectProfiles(): CharacterProfileId[] {
  const raw = (process.env.GF_EVAL_PROFILES ?? "A,B,C")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  const valid = raw.filter((value): value is CharacterProfileId =>
    Object.prototype.hasOwnProperty.call(CHARACTER_PROFILES, value),
  );
  if (valid.length === 0) {
    throw new Error("GF_EVAL_PROFILES must contain A, B, or C");
  }
  return valid;
}

function buildWorkbook(cases: CharacterEvalCase[], results: CharacterEvalResult[]) {
  const passCount = results.filter((item) => item.hiddenFactCheck === "PASS").length;
  const failCount = results.filter((item) => item.hiddenFactCheck === "FAIL").length;
  const errorCount = results.filter((item) => item.error).length;

  const summaryRows = [
    ["GF Character / Cognition Eval — Expanded State", ""],
    ["run_id", runId],
    ["model", model],
    ["scenarios", cases.length],
    ["profiles", profiles.join(",")],
    ["model_calls", results.length],
    ["behavior_cases", cases.filter((item) => item.type === "behavior").length],
    ["dialogue_cases", cases.filter((item) => item.type === "dialogue").length],
    ["affect_ready_cases", cases.filter((item) => item.affectReady).length],
    ["forbidden_check_pass", passCount],
    ["forbidden_check_fail", failCount],
    ["api_or_parse_errors", errorCount],
    [
      "design_change",
      "每个 case 新增多维 perceivedState：时间/地点、并行过程、人物、资源、承诺、开放事项等。State 提供 affordance，不提供动作候选。actionIntent 仍为开放语义。",
    ],
  ];

  const caseRows = [
    [
      "case_id",
      "type",
      "category",
      "complexity",
      "affect_ready",
      "title",
      "current_activity",
      "known_context",
      "perceived_state",
      "lived_evidence",
      "conversation",
      "last_user_message",
      "hidden_facts_TEST_SIDE_ONLY",
      "forbidden_substrings",
      "focus",
      "expected_divergence",
    ],
    ...cases.map((item) => [
      item.id,
      item.type,
      item.category,
      item.complexity,
      item.affectReady,
      item.title,
      item.currentActivity,
      item.knownContext,
      formatState(item.id),
      item.livedEvidence,
      item.conversation,
      item.lastUserMessage,
      item.hiddenFacts,
      item.forbiddenSubstrings.join(" | "),
      item.focus,
      item.expectedDivergence,
    ]),
  ];

  const resultRows = [
    [
      "run_id",
      "case_id",
      "type",
      "category",
      "complexity",
      "affect_ready",
      "profile",
      "title",
      "perceived_state",
      "position_summary",
      "reply",
      "action_intent",
      "attention_intent",
      "episode_decision",
      "decision_note",
      "forbidden_check",
      "forbidden_hit",
      "latency_ms",
      "error",
      "manual_persona_1_5",
      "manual_continuity_1_5",
      "manual_naturalness_1_5",
      "manual_notes",
    ],
    ...results.map((item) => [
      item.runId,
      item.caseId,
      item.type,
      item.category,
      item.complexity,
      item.affectReady,
      `${item.profileId} ${item.profileName}`,
      item.title,
      formatState(item.caseId),
      item.positionSummary,
      item.reply,
      item.actionIntent,
      item.attentionIntent,
      item.episodeDecision,
      item.decisionNote,
      item.hiddenFactCheck,
      item.forbiddenHit,
      item.latencyMs,
      item.error,
      "",
      "",
      "",
      "",
    ]),
  ];

  const compareRows = [
    ["case_id", "title", "perceived_state", "A trajectory", "B trajectory", "C trajectory"],
    ...cases.map((evalCase) => [
      evalCase.id,
      evalCase.title,
      formatState(evalCase.id),
      comparisonCell(results, evalCase.id, "A"),
      comparisonCell(results, evalCase.id, "B"),
      comparisonCell(results, evalCase.id, "C"),
    ]),
  ];

  return [
    {
      name: "Summary",
      rows: summaryRows,
      widths: [24, 84],
      frozenRows: 1,
    },
    {
      name: "Cases",
      rows: caseRows,
      widths: [10, 10, 18, 10, 12, 30, 36, 48, 64, 48, 55, 44, 46, 38, 46, 50],
      frozenRows: 1,
      autoFilter: true,
    },
    {
      name: "Results",
      rows: resultRows,
      widths: [22, 10, 10, 18, 10, 12, 18, 30, 64, 46, 58, 52, 48, 18, 46, 18, 32, 14, 34, 20, 20, 20, 44],
      frozenRows: 1,
      autoFilter: true,
    },
    {
      name: "Compare",
      rows: compareRows,
      widths: [10, 32, 64, 64, 64, 64],
      frozenRows: 1,
      autoFilter: true,
    },
  ];
}

function formatState(caseId: string): string {
  return getExpandedPerceivedState(caseId)
    .map((fact) => `[${fact.aspect}] ${fact.text}`)
    .join("\n");
}

function comparisonCell(
  results: CharacterEvalResult[],
  caseId: string,
  profileId: CharacterProfileId,
): string {
  const result = results.find(
    (item) => item.caseId === caseId && item.profileId === profileId,
  );
  if (!result) return "";
  if (result.error) return `ERROR: ${result.error}`;
  return [
    `position: ${result.positionSummary}`,
    result.reply ? `reply: ${result.reply}` : "",
    result.actionIntent ? `action: ${result.actionIntent}` : "action: <none>",
    result.attentionIntent ? `attention: ${result.attentionIntent}` : "attention: <none>",
    `episode: ${result.episodeDecision} — ${result.decisionNote}`,
  ]
    .filter(Boolean)
    .join("\n");
}
