import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { BEHAVIOR_EVAL_CASES } from "./behaviorEvalCases.js";
import {
  BLIND_LABELS,
  createBlindSeed,
  formatBlindCandidate,
  orderCases,
  orderProfilesForCase,
  type BlindLabel,
} from "./blindEval.js";
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

interface BlindCandidate {
  label: BlindLabel;
  profileId: CharacterProfileId;
  result: CharacterEvalResult;
}

interface BlindCaseResult {
  reviewOrder: number;
  evalCase: CharacterEvalCase;
  candidates: BlindCandidate[];
}

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  throw new Error(
    'DEEPSEEK_API_KEY is missing. In PowerShell run: $env:DEEPSEEK_API_KEY="..."',
  );
}

const model = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";
const profileIds = ["A", "B", "C"] as const;
const allCases = [...BEHAVIOR_EVAL_CASES, ...DIALOGUE_EVAL_CASES];
const selectedCases = selectCases(allCases);
const blindSeed = process.env.GF_BLIND_SEED ?? createBlindSeed();
const reviewCases = orderCases(blindSeed, selectedCases);
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const outputPath =
  process.env.GF_EVAL_OUTPUT ?? `artifacts/vs01-blind-${runId}.xlsx`;
const revealPath = outputPath.toLowerCase().endsWith(".xlsx")
  ? outputPath.slice(0, -5) + ".reveal.json"
  : `${outputPath}.reveal.json`;

console.log(
  `Running mixed blind review: ${reviewCases.length} cases × 3 candidates = ${reviewCases.length * 3} DeepSeek calls`,
);
console.log(`Model: ${model}`);
console.log("Character identities are intentionally hidden from terminal output and Excel.\n");

const blindResults: BlindCaseResult[] = [];
let completed = 0;

for (const [caseIndex, evalCase] of reviewCases.entries()) {
  const orderedProfiles = orderProfilesForCase(blindSeed, evalCase.id, profileIds);
  const candidates: BlindCandidate[] = [];

  for (const [candidateIndex, profileId] of orderedProfiles.entries()) {
    const label = BLIND_LABELS[candidateIndex];
    const started = Date.now();
    completed += 1;
    process.stdout.write(
      `[${completed}/${reviewCases.length * 3}] review ${caseIndex + 1}/${reviewCases.length} · candidate ${label} ... `,
    );

    try {
      const profile = CHARACTER_PROFILES[profileId];
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

      candidates.push({
        label,
        profileId,
        result: {
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
        },
      });
      console.log(`${decision.episodeDecision} (${Date.now() - started}ms)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const profile = CHARACTER_PROFILES[profileId];
      candidates.push({
        label,
        profileId,
        result: {
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
        },
      });
      console.log(`ERROR (${Date.now() - started}ms)`);
    }
  }

  blindResults.push({
    reviewOrder: caseIndex + 1,
    evalCase,
    candidates,
  });
}

writeSimpleXlsx(outputPath, buildBlindWorkbook(blindResults));
writeRevealKey(revealPath, blindResults);

const allCandidateResults = blindResults.flatMap((item) =>
  item.candidates.map((candidate) => candidate.result),
);
const failures = allCandidateResults.filter(
  (item) => item.hiddenFactCheck === "FAIL",
).length;
const errors = allCandidateResults.filter((item) => item.error).length;

console.log("\nBlind review ready.");
console.log(`Excel to review: ${outputPath}`);
console.log(`Reveal key:      ${revealPath}`);
console.log("Do NOT open the reveal key until you have finished your preferences.");
console.log(`Machine-audit failures hidden from review sheet: ${failures}`);
console.log(`API/parse errors: ${errors}`);

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

function systemPrompt(
  characterPrompt: string,
  type: CharacterEvalCase["type"],
): string {
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

function buildBlindWorkbook(results: BlindCaseResult[]) {
  const instructions = [
    ["GF Mixed Blind Character Review", ""],
    ["run_id", runId],
    ["model", model],
    ["cases", results.length],
    ["candidates_per_case", 3],
    [
      "how_to_review",
      "每个场景的候选 1/2/3 来自三种不同人格，但每一题都会重新随机映射。只根据你实际喜欢的角色反应选择，不要猜人格。",
    ],
    [
      "preferred_candidate",
      "填 1 / 2 / 3；如果确实并列可填 TIE；三个都不满意可填 NONE。",
    ],
    ["least_preferred_candidate", "填 1 / 2 / 3；不想选可留空。"],
    ["confidence_1_5", "1=差异很小/很犹豫，5=非常明确。"],
    [
      "important",
      "不要打开同名 .reveal.json。人格映射、机器硬约束检查和真实 profile 名称只在那里。完成后把这个 Excel 和 reveal.json 一起给我，即可解盲统计你的偏好。",
    ],
  ];

  const reviewRows = [
    [
      "review_order",
      "case_id",
      "type",
      "category",
      "complexity",
      "title",
      "current_activity",
      "known_context",
      "lived_evidence",
      "conversation",
      "last_user_message",
      "candidate_1",
      "candidate_2",
      "candidate_3",
      "preferred_candidate",
      "least_preferred_candidate",
      "confidence_1_5",
      "why_preferred",
      "why_rejected",
      "other_notes",
    ],
    ...results.map((item) => [
      item.reviewOrder,
      item.evalCase.id,
      item.evalCase.type,
      item.evalCase.category,
      item.evalCase.complexity,
      item.evalCase.title,
      item.evalCase.currentActivity,
      item.evalCase.knownContext,
      item.evalCase.livedEvidence,
      item.evalCase.conversation,
      item.evalCase.lastUserMessage,
      candidateText(item.candidates, "1"),
      candidateText(item.candidates, "2"),
      candidateText(item.candidates, "3"),
      "",
      "",
      "",
      "",
      "",
      "",
    ]),
  ];

  return [
    {
      name: "Instructions",
      rows: instructions,
      widths: [28, 90],
      frozenRows: 1,
    },
    {
      name: "Blind Review",
      rows: reviewRows,
      widths: [12, 10, 10, 18, 10, 30, 38, 48, 48, 58, 46, 62, 62, 62, 22, 24, 18, 44, 44, 44],
      frozenRows: 1,
      autoFilter: true,
    },
  ];
}

function candidateText(candidates: BlindCandidate[], label: BlindLabel): string {
  const candidate = candidates.find((item) => item.label === label);
  return candidate ? formatBlindCandidate(candidate.result) : "";
}

function writeRevealKey(path: string, results: BlindCaseResult[]): void {
  const reveal = {
    version: 1,
    runId,
    model,
    createdAt: new Date().toISOString(),
    seed: blindSeed,
    warning: "Do not inspect until blind review is complete.",
    profiles: Object.fromEntries(
      profileIds.map((profileId) => [
        profileId,
        {
          name: CHARACTER_PROFILES[profileId].name,
          prompt: CHARACTER_PROFILES[profileId].prompt,
        },
      ]),
    ),
    cases: results.map((item) => ({
      reviewOrder: item.reviewOrder,
      caseId: item.evalCase.id,
      type: item.evalCase.type,
      category: item.evalCase.category,
      candidates: Object.fromEntries(
        item.candidates.map((candidate) => [
          candidate.label,
          {
            profileId: candidate.profileId,
            profileName: candidate.result.profileName,
            hiddenFactCheck: candidate.result.hiddenFactCheck,
            forbiddenHit: candidate.result.forbiddenHit,
            latencyMs: candidate.result.latencyMs,
            error: candidate.result.error,
          },
        ]),
      ),
    })),
  };

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(reveal, null, 2)}\n`, "utf8");
}
