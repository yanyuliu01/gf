import { DeepSeekS4PolicyClient } from "./deepseekS4Policy.js";
import { S4AttentionLoop } from "./s4AttentionLoop.js";

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  throw new Error(
    'DEEPSEEK_API_KEY is missing. In PowerShell run: $env:DEEPSEEK_API_KEY="..."',
  );
}

const policy = new DeepSeekS4PolicyClient({
  apiKey,
  model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
  agentPrompt: process.env.GF_AGENT_PROMPT,
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
  maxEpisodeSteps: 3,
});

console.log("\n[12:40] world truth: irrigation pressure drops (hidden from subject)");
const hidden = await loop.process({
  eventId: "evt_pump_low",
  occurredAt: "2026-08-10T12:40:00+08:00",
  kind: "pump_pressure_low",
  visibility: "hidden",
});
console.log(JSON.stringify(hidden, null, 2));

console.log("\n[13:20] subject observes: S-4 is persistently wilted");
const visible = await loop.process({
  eventId: "evt_s4_wilted",
  occurredAt: "2026-08-10T13:20:00+08:00",
  kind: "s4_wilted",
  visibility: "observable",
});
console.log(JSON.stringify(visible, null, 2));
