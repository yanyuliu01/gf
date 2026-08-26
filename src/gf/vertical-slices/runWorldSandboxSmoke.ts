import { ConcordiaWorldBridge } from "../world/concordiaBridge.js";
import { composePolicyPromptV3, type WorkingSelfEvidenceV3 } from "../prompts/policyComposerV3.js";

interface DeepSeekChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

interface PolicyDecision {
  speech: string;
  actionIntent: string;
  attentionIntent: string;
  control: "continue" | "yield";
}

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) throw new Error('DEEPSEEK_API_KEY is missing.');

const actorId = process.env.GF_WORLD_ACTOR_ID ?? "muelsyse";
const worldUrl = process.env.GF_WORLD_URL ?? "http://127.0.0.1:8765";
const model = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";
const steps = Math.max(1, Math.min(6, Number(process.env.GF_WORLD_SMOKE_STEPS ?? 2)));
const advanceMinutes = Math.max(1, Math.min(240, Number(process.env.GF_WORLD_SMOKE_ADVANCE_MINUTES ?? 15)));

const world = new ConcordiaWorldBridge({ baseUrl: worldUrl });
let cursor: string | undefined;
let lastOutcome = "";

console.log(`GF world smoke: actor=${actorId}, world=${worldUrl}, model=${model}, steps=${steps}`);

for (let step = 1; step <= steps; step += 1) {
  const observed = await world.observe(actorId, cursor);
  cursor = observed.cursor;
  console.log(`\n=== step ${step} / observation @ ${observed.worldTime} ===`);
  for (const item of observed.observations) console.log(`- ${item.text}`);

  const evidence: WorkingSelfEvidenceV3[] = observed.observations.map((item) => ({
    source: "perception",
    sourceRef: item.id,
    text: item.text,
  }));
  if (lastOutcome) {
    evidence.push({
      source: "memory",
      sourceRef: `smoke-outcome-${step - 1}`,
      text: `刚才自己的行动产生了这个结果：${lastOutcome}`,
    });
  }

  const prompt = composePolicyPromptV3({
    mode: "autonomous",
    identity: {
      facts: [
        "她是缪尔赛思，精灵，莱茵生命生态科主任，也是公司早期元老；熟人常叫她缪缪。",
        "她长期生活在特里蒙；生态科、生态园、同事、研究和私人生活都真实存在，不围绕博士展开。",
        "她对水、植物和活体有不同于普通人的感知；这种差异也长期造成她与多数人之间难以完全跨越的隔阂。",
        "她知道博士本人生活在彼侧世界，当前终端是两人唯一持续直接的通信纽带。",
      ],
    },
    workingSelf: {
      now: observed.worldTime,
      evidence,
    },
  });

  const decision = await callPolicy(prompt.messages);
  console.log("\nPolicy:");
  console.log(JSON.stringify(decision, null, 2));

  const worldIntent = combineWorldIntent(decision);
  if (worldIntent) {
    const actionId = `smoke-${Date.now()}-${step}`;
    const resolution = await world.resolve({
      id: actionId,
      actorId,
      proposedAt: observed.worldTime,
      intent: worldIntent,
    });
    lastOutcome = resolution.happened;
    cursor = resolution.observations.length ? cursor : cursor;
    console.log("\nWorld resolution:");
    console.log(JSON.stringify(resolution, null, 2));
  } else {
    lastOutcome = "她没有提出新的外部行动，继续留在当前生活轨迹中。";
    console.log("\nWorld resolution: no external action proposed.");
  }

  const to = addMinutes(observed.worldTime, advanceMinutes);
  const advanced = await world.advance({ to });
  console.log(`\nWorld advanced: ${advanced.from} -> ${advanced.to}`);
}

const finalObservation = await world.observe(actorId, cursor);
console.log(`\n=== final observation @ ${finalObservation.worldTime} ===`);
for (const item of finalObservation.observations) console.log(`- ${item.text}`);

async function callPolicy(
  messages: Array<{ role: "system" | "user"; content: string }>,
): Promise<PolicyDecision> {
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
      temperature: 0.45,
      max_tokens: 800,
      messages,
    }),
  });
  const payload = (await response.json()) as DeepSeekChatResponse;
  if (!response.ok) {
    throw new Error(`DeepSeek policy failed (${response.status}): ${payload.error?.message ?? response.statusText}`);
  }
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("DeepSeek policy returned empty content");
  const raw = JSON.parse(stripFence(content)) as Record<string, unknown>;
  const control = raw.control === "continue" ? "continue" : "yield";
  return {
    speech: typeof raw.speech === "string" ? raw.speech : "",
    actionIntent: typeof raw.actionIntent === "string" ? raw.actionIntent : "",
    attentionIntent: typeof raw.attentionIntent === "string" ? raw.attentionIntent : "",
    control,
  };
}

function combineWorldIntent(decision: PolicyDecision): string {
  const action = decision.actionIntent.trim();
  const speech = decision.speech.trim();
  if (action && speech) return `${action} 同时如果需要对外说话，她说：“${speech}”`;
  if (action) return action;
  if (speech) return `她说：“${speech}”`;
  return "";
}

function addMinutes(value: string, minutes: number): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid world time: ${value}`);
  return new Date(parsed + minutes * 60_000).toISOString();
}

function stripFence(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}
