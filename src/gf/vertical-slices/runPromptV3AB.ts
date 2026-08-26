import { FastReplyAssembler, TickAssembler, type PromptContext } from "../prompts/assembler.js";
import { Manifest } from "../prompts/manifest.js";
import { PROMPT_AB_CASES_V3, type PromptABCaseV3 } from "../prompts/policyABCasesV3.js";
import { composePolicyPromptV3 } from "../prompts/policyComposerV3.js";
import { writeSimpleXlsx } from "./simpleXlsx.js";

interface DeepSeekChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

interface RunRow {
  caseId: string;
  title: string;
  callPoint: string;
  focus: string;
  version: "legacy" | "v3";
  repeat: number;
  systemChars: number;
  totalPromptChars: number;
  rawOutput: string;
  speech: string;
  actionIntent: string;
  attentionIntent: string;
  control: string;
  latencyMs: number;
  error: string;
}

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  throw new Error('DEEPSEEK_API_KEY is missing. In PowerShell: $env:DEEPSEEK_API_KEY="..."');
}

const model = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";
const temperature = finiteNumber(process.env.GF_PROMPT_AB_TEMPERATURE, 0.35, 0, 2);
const repeats = Math.max(1, Math.floor(finiteNumber(process.env.GF_PROMPT_AB_REPEATS, 2, 1, 6)));
const selectedIds = new Set(
  (process.env.GF_PROMPT_AB_CASES ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);
const cases = selectedIds.size
  ? PROMPT_AB_CASES_V3.filter((item) => selectedIds.has(item.id))
  : PROMPT_AB_CASES_V3;
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const outputPath = process.env.GF_PROMPT_AB_OUTPUT ?? `artifacts/prompt-v3-ab-${runId}.xlsx`;
const manifest = new Manifest("prompts/manifest.yaml");

console.log(
  `Running Prompt V3 A/B: ${cases.length} cases × 2 versions × ${repeats} repeats = ${cases.length * 2 * repeats} DeepSeek calls`,
);
console.log(`Model: ${model}; temperature=${temperature}; output=${outputPath}`);

const rows: RunRow[] = [];
let completed = 0;
const total = cases.length * 2 * repeats;

for (const evalCase of cases) {
  const prompts = [
    { version: "legacy" as const, messages: legacyMessages(evalCase) },
    { version: "v3" as const, messages: v3Messages(evalCase) },
  ];

  for (const prompt of prompts) {
    for (let repeat = 1; repeat <= repeats; repeat += 1) {
      completed += 1;
      process.stdout.write(`[${completed}/${total}] ${evalCase.id} ${prompt.version} run ${repeat}/${repeats} ... `);
      const started = Date.now();
      try {
        const rawOutput = await callDeepSeek(prompt.messages);
        const parsed = prompt.version === "v3" ? parseV3(rawOutput) : emptyParsed();
        rows.push({
          caseId: evalCase.id,
          title: evalCase.title,
          callPoint: evalCase.callPoint,
          focus: evalCase.focus,
          version: prompt.version,
          repeat,
          systemChars: prompt.messages.filter((m) => m.role === "system").reduce((sum, m) => sum + m.content.length, 0),
          totalPromptChars: prompt.messages.reduce((sum, m) => sum + m.content.length, 0),
          rawOutput,
          ...parsed,
          latencyMs: Date.now() - started,
          error: "",
        });
        console.log(`ok (${Date.now() - started}ms)`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        rows.push({
          caseId: evalCase.id,
          title: evalCase.title,
          callPoint: evalCase.callPoint,
          focus: evalCase.focus,
          version: prompt.version,
          repeat,
          systemChars: prompt.messages.filter((m) => m.role === "system").reduce((sum, m) => sum + m.content.length, 0),
          totalPromptChars: prompt.messages.reduce((sum, m) => sum + m.content.length, 0),
          rawOutput: "",
          ...emptyParsed(),
          latencyMs: Date.now() - started,
          error: message,
        });
        console.log(`ERROR ${message}`);
      }
    }
  }
}

writeSimpleXlsx(outputPath, workbook(rows));
console.log("\nPrompt V3 A/B complete.");
console.log(`Rows: ${rows.length}; errors: ${rows.filter((row) => row.error).length}`);
console.log(`Excel: ${outputPath}`);

function legacyMessages(evalCase: PromptABCaseV3): PromptContext["messages"] {
  if (evalCase.callPoint === "interaction") {
    return new FastReplyAssembler(manifest, "prompts/10-fast-reply.md", {
      worldState: evalCase.legacy.worldState,
      persona: evalCase.legacy.persona,
      canonHits: evalCase.legacy.canonHits,
      memories: evalCase.legacy.memories,
      recentEvents: evalCase.legacy.recentEvents,
    }).assemble(evalCase.legacy.sceneTail ?? [], evalCase.legacy.newMessages ?? []).messages;
  }

  const event = evalCase.legacy.event;
  if (!event) throw new Error(`${evalCase.id} autonomous legacy case is missing event`);
  return new TickAssembler(manifest, {
    worldState: evalCase.legacy.worldState,
    persona: evalCase.legacy.persona,
  }).assemble(event).messages;
}

function v3Messages(evalCase: PromptABCaseV3): PromptContext["messages"] {
  return composePolicyPromptV3(evalCase.v3).messages;
}

async function callDeepSeek(messages: PromptContext["messages"]): Promise<string> {
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      thinking: { type: "disabled" },
      temperature,
      max_tokens: 1000,
      messages,
    }),
  });
  const payload = (await response.json()) as DeepSeekChatResponse;
  if (!response.ok) {
    throw new Error(`DeepSeek request failed (${response.status}): ${payload.error?.message ?? response.statusText}`);
  }
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("DeepSeek returned empty content");
  return content;
}

function parseV3(raw: string) {
  try {
    const value = JSON.parse(stripFence(raw)) as Record<string, unknown>;
    return {
      speech: typeof value.speech === "string" ? value.speech : "",
      actionIntent: typeof value.actionIntent === "string" ? value.actionIntent : "",
      attentionIntent: typeof value.attentionIntent === "string" ? value.attentionIntent : "",
      control: value.control === "continue" || value.control === "yield" ? value.control : "",
    };
  } catch {
    return emptyParsed();
  }
}

function emptyParsed() {
  return { speech: "", actionIntent: "", attentionIntent: "", control: "" };
}

function stripFence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function workbook(resultRows: RunRow[]) {
  const header = [
    "case_id", "title", "call_point", "focus", "version", "repeat",
    "system_chars", "total_prompt_chars", "raw_output", "speech", "action_intent",
    "attention_intent", "control", "latency_ms", "error",
  ];
  const data = resultRows.map((row) => [
    row.caseId, row.title, row.callPoint, row.focus, row.version, row.repeat,
    row.systemChars, row.totalPromptChars, row.rawOutput, row.speech, row.actionIntent,
    row.attentionIntent, row.control, row.latencyMs, row.error,
  ]);

  const compareHeader = [
    "case_id", "title", "call_point", "focus", "legacy_outputs", "v3_outputs",
    "legacy_system_chars", "v3_system_chars",
  ];
  const compare = PROMPT_AB_CASES_V3
    .filter((evalCase) => resultRows.some((row) => row.caseId === evalCase.id))
    .map((evalCase) => {
      const legacy = resultRows.filter((row) => row.caseId === evalCase.id && row.version === "legacy");
      const v3 = resultRows.filter((row) => row.caseId === evalCase.id && row.version === "v3");
      return [
        evalCase.id,
        evalCase.title,
        evalCase.callPoint,
        evalCase.focus,
        legacy.map((row) => `[${row.repeat}] ${row.rawOutput || row.error}`).join("\n\n"),
        v3.map((row) => `[${row.repeat}] ${row.rawOutput || row.error}`).join("\n\n"),
        mean(legacy.map((row) => row.systemChars)),
        mean(v3.map((row) => row.systemChars)),
      ];
    });

  return [
    {
      name: "Summary",
      rows: [
        ["GF Prompt V3 A/B", ""],
        ["run_id", runId],
        ["model", model],
        ["temperature", temperature],
        ["cases", cases.length],
        ["repeats", repeats],
        ["calls", resultRows.length],
        ["design", "Same scenario, real frozen legacy assembler versus V3 minimal identity + Working Self. Diagnostic comparison only; no automatic winner score."],
        ["v3_contract", "Identity seed + epistemic/agency boundaries in system; dynamic perception/memory/belief/relationship/commitment/message as Working Self data."],
      ],
      widths: [28, 100],
    },
    {
      name: "Compare",
      rows: [compareHeader, ...compare],
      widths: [12, 30, 14, 56, 80, 80, 20, 20],
      frozenRows: 1,
      autoFilter: true,
    },
    {
      name: "Raw Results",
      rows: [header, ...data],
      widths: [12, 28, 14, 48, 12, 10, 16, 20, 80, 50, 60, 60, 12, 14, 50],
      frozenRows: 1,
      autoFilter: true,
    },
  ];
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function finiteNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}
