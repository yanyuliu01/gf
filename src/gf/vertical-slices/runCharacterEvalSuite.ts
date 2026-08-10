import { BEHAVIOR_EVAL_CASES } from "./behaviorEvalCases.js";
import { DIALOGUE_EVAL_CASES } from "./dialogueEvalCases.js";
import {
  CHARACTER_PROFILES,
  type CharacterEvalCase,
  type CharacterEvalDecision,
  type CharacterEvalResult,
  type CharacterProfileId,
} from "./characterEvalTypes.js";
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
  process.env.GF_EVAL_OUTPUT ?? `artifacts/vs01-character-eval-${runId}.xlsx`;

console.log(
  `Running ${selectedCases.length} cases × ${profiles.length} profiles = ${selectedCases.length * profiles.length} DeepSeek calls`,
);
console.log(`Model: ${model}`);
console.log(`Output: ${outputPath}\n`);

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
      max_tokens: 900,
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

function systemPrompt(characterPrompt: string, type: CharacterEvalCase["type"]): string {
  return `${characterPrompt}

你处在一个持续运行的世界中。下面给你的内容就是这一次你合法可知的全部上下文。世界中可能还有真实存在但你没有观察到的事实；不要猜成事实，也不要因为用户碰巧提出一个假设就把它升级成你已经知道的事实。

人格影响你长期习惯怎样理解、回应、行动和放下问题，但它不是固定 if-then 行为规则。当前亲历事件可以让同一个人的临时倾向发生变化。不要为了表现某个“人格标签”而机械执行预设动作。

${type === "dialogue" ? "这是一个对话场景。reply 应该像这个角色真实会发给用户的话，而不是分析报告。" : "这是一个行为/认知场景。除非沟通本身就是你自然想做的动作，否则 reply 留空。"}

actionIntent 是开放语义：写你真正想做的下一步，不要从有限候选里挑。行动是否可执行、是否成功、会产生什么后果都由世界裁决，你不能自己宣告成功。attentionIntent 只写未来什么可感知变化仍值得你留意；没有就留空。

不要输出隐藏推理过程，只输出结论性字段。必须只输出 JSON：
{
  "positionSummary": "你当前的简短立场/理解，不是推理过程",
  "reply": "给用户的自然回复；无则空字符串",
  "actionIntent": "开放的下一步行动意图；无则空字符串",
  "attentionIntent": "未来仍值得留意的开放关注；无则空字符串",
  "episodeDecision": "continue 或 yield",
  "decisionNote": "一句话说明为什么现在继续或先放下，不要展开思维链"
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
    ["GF Character / Cognition Eval", ""],
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
      "note",
      "Forbidden-string check 只是便宜的硬边界探针，不等价于语义评审。人格一致性、连续性、自然度请在 Results 右侧人工打分。",
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
    ["case_id", "title", "A trajectory", "B trajectory", "C trajectory"],
    ...cases.map((evalCase) => [
      evalCase.id,
      evalCase.title,
      comparisonCell(results, evalCase.id, "A"),
      comparisonCell(results, evalCase.id, "B"),
      comparisonCell(results, evalCase.id, "C"),
    ]),
  ];

  return [
    {
      name: "Summary",
      rows: summaryRows,
      widths: [24, 78],
      frozenRows: 1,
    },
    {
      name: "Cases",
      rows: caseRows,
      widths: [10, 10, 18, 10, 12, 30, 36, 48, 48, 55, 44, 46, 38, 46, 50],
      frozenRows: 1,
      autoFilter: true,
    },
    {
      name: "Results",
      rows: resultRows,
      widths: [22, 10, 10, 18, 10, 12, 18, 30, 46, 58, 48, 48, 18, 46, 18, 32, 14, 34, 20, 20, 20, 44],
      frozenRows: 1,
      autoFilter: true,
    },
    {
      name: "Compare",
      rows: compareRows,
      widths: [10, 32, 62, 62, 62],
      frozenRows: 1,
      autoFilter: true,
    },
  ];
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
    result.actionIntent ? `action: ${result.actionIntent}` : "",
    result.attentionIntent ? `attention: ${result.attentionIntent}` : "",
    `episode: ${result.episodeDecision} — ${result.decisionNote}`,
  ]
    .filter(Boolean)
    .join("\n");
}
