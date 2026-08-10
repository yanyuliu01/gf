import { DeepSeekS4PolicyClient } from "./deepseekS4Policy.js";
import { S4AttentionLoop, type S4LoopResult } from "./s4AttentionLoop.js";

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  throw new Error(
    'DEEPSEEK_API_KEY is missing. In PowerShell run: $env:DEEPSEEK_API_KEY="..."',
  );
}

const model = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";

const characters = [
  {
    id: "cautious-researcher",
    label: "A 谨慎研究型",
    prompt:
      "你长期做研究，对因果归因很克制。过去过早下结论给你带来过麻烦，所以你重视独立证据，也清楚重复确认同一件事并不会自动增加信息。你习惯让判断保留不确定性。",
  },
  {
    id: "decisive-operator",
    label: "B 现场决断型",
    prompt:
      "你长期负责现场处置，重视及时理解最可能影响运行的因素。你接受现实里证据经常不完备，不会为了获得心理上的确定感而反复核对已经清楚的事实。你的判断简洁、有承担。",
  },
  {
    id: "low-intervention-observer",
    label: "C 低干预观察型",
    prompt:
      "你更像长期观察者，对短时波动有耐心，也不喜欢因为一点异常就扰动系统。你重视趋势和时间带来的信息，但持续恶化的迹象仍会留在你的注意里。",
  },
] as const;

console.log("VS01 character matrix");
console.log(`model=${model}; temperature=0.2; same world/context for every character`);
console.log("world truth: 12:40 irrigation pressure drops; subject cannot perceive it directly");
console.log("subjective trigger: 13:20 S-4 is visibly and persistently wilted");

for (const character of characters) {
  const policy = new DeepSeekS4PolicyClient({
    apiKey,
    model,
    agentPrompt: character.prompt,
    temperature: 0.2,
  });

  const loop = new S4AttentionLoop({
    policy,
    initialWorld: {
      currentActivity: "ecology-garden routine work",
      pumpPressure: "normal",
      rootZoneMoisture: "normal",
      s4Wilted: false,
    },
    attention: {
      subject: "S-4",
      reason: "上午观察时觉得状态有点不对，下午继续留意。",
      expiresAt: "2026-08-10T18:00:00+08:00",
    },
    maxEpisodeSteps: 4,
  });

  await loop.process({
    eventId: `evt_pump_low_${character.id}`,
    occurredAt: "2026-08-10T12:40:00+08:00",
    kind: "pump_pressure_low",
    visibility: "hidden",
  });

  const result = await loop.process({
    eventId: `evt_s4_wilted_${character.id}`,
    occurredAt: "2026-08-10T13:20:00+08:00",
    kind: "s4_wilted",
    visibility: "observable",
  });

  printTrajectory(character.label, result);
}

function printTrajectory(label: string, result: S4LoopResult): void {
  console.log(`\n=== ${label} ===`);

  if (result.kind !== "cognitive") {
    console.log(`no cognition: ${result.reason}`);
    return;
  }

  console.log(`trigger: ${result.observation.text}`);

  if (result.episodeHistory.length === 0) {
    console.log("steps: 0");
  }

  for (const [index, step] of result.episodeHistory.entries()) {
    console.log(`\n[step ${index + 1}] ${step.action.intent}`);
    console.log(
      `execution: ${step.action.execution.primitive}(${step.action.execution.target}, ${step.action.execution.aspect})`,
    );
    if (step.outcome.newObservations.length === 0) {
      console.log(`outcome: ${step.outcome.happened}`);
    } else {
      for (const observation of step.outcome.newObservations) {
        console.log(`observation: ${observation.text}`);
      }
    }
  }

  if (result.end.kind === "agent_yield") {
    console.log(`\nyield: ${result.end.reason}`);
  } else {
    console.log("\nend: runtime_step_limit");
  }
}
