import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { PerceptionProjector } from "../perception/projector.js";
import {
  composePolicyPromptV3,
  type WorkingSelfEvidenceV3,
} from "../prompts/policyComposerV3.js";
import { connect } from "../state/db.js";
import { MigrationRunner } from "../state/migrator.js";
import { EventStore, type Row } from "../state/repositories.js";
import { StateManager, type WorldEvent } from "../state/stateManager.js";
import { Policy } from "../validation/policy.js";
import { SchemaRegistry } from "../validation/schemas.js";
import { ConcordiaWorldBridge } from "../world/concordiaBridge.js";
import { AgentWorldIngress } from "../world/ingress.js";

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
if (!apiKey) throw new Error("DEEPSEEK_API_KEY is missing.");

const actorId = process.env.GF_WORLD_ACTOR_ID ?? "muelsyse";
const worldUrl = process.env.GF_WORLD_URL ?? "http://127.0.0.1:8765";
const model = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";
const steps = Math.max(
  1,
  Math.min(6, Number(process.env.GF_WORLD_SMOKE_STEPS ?? 2)),
);
const advanceMinutes = Math.max(
  1,
  Math.min(240, Number(process.env.GF_WORLD_SMOKE_ADVANCE_MINUTES ?? 15)),
);

const root = process.cwd();
const dbPath =
  process.env.GF_WORLD_SMOKE_DB ?? join(root, "artifacts", "world-smoke.sqlite");
mkdirSync(dirname(dbPath), { recursive: true });
const bootstrapDb = connect(dbPath);
new MigrationRunner(bootstrapDb, join(root, "migrations")).apply();
bootstrapDb.close();

const schemas = new SchemaRegistry(join(root, "schemas"));
const stateManager = new StateManager(
  () => connect(dbPath),
  schemas,
  new Policy(),
);
const readDb = connect(dbPath);
const events = new EventStore(readDb);
const projector = new PerceptionProjector();
const world = new ConcordiaWorldBridge({ baseUrl: worldUrl });
const ingress = new AgentWorldIngress(stateManager, world, {
  connectorId: "world:concordia",
});

let cursor: string | undefined;

console.log(
  `GF world smoke: actor=${actorId}, world=${worldUrl}, model=${model}, steps=${steps}, db=${dbPath}`,
);

try {
  for (let step = 1; step <= steps; step += 1) {
    const pulled = await ingress.pull(actorId, cursor);
    cursor = pulled.cursor;
    const observations = pulled.ingested
      .map((result) => events.getEvent(result.eventId))
      .filter((row): row is Row => row !== undefined)
      .map(rowToWorldEvent)
      .map((event) => projector.project(event, actorId))
      .filter((item) => item !== null);

    console.log(`\n=== step ${step} / perception @ ${pulled.worldTime} ===`);
    for (const item of observations) console.log(`- ${item.text}`);

    const evidence: WorkingSelfEvidenceV3[] = observations.map((item) => ({
      source: "perception",
      sourceRef: item.sourceEventId,
      text: item.text,
    }));

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
        now: pulled.worldTime,
        evidence,
      },
    });

    const decision = await callPolicy(prompt.messages);
    console.log("\nPolicy:");
    console.log(JSON.stringify(decision, null, 2));

    if (decision.speech.trim()) {
      console.log(
        `\nCommunication proposal (not sent to World; production path is Outbox): ${decision.speech.trim()}`,
      );
    }

    const worldIntent = decision.actionIntent.trim();
    if (worldIntent) {
      const actionId = `smoke-${Date.now()}-${step}`;
      const resolved = await ingress.resolve({
        id: actionId,
        actorId,
        proposedAt: pulled.worldTime,
        intent: worldIntent,
      });
      console.log("\nWorld resolution (objective ledger event):");
      console.log(JSON.stringify(resolved.resolution, null, 2));

      const legalOutcomeObservations = resolved.observations
        .map((result) => events.getEvent(result.eventId))
        .filter((row): row is Row => row !== undefined)
        .map(rowToWorldEvent)
        .map((event) => projector.project(event, actorId))
        .filter((item) => item !== null);
      if (legalOutcomeObservations.length > 0) {
        console.log("\nLegally perceived outcome:");
        for (const item of legalOutcomeObservations) console.log(`- ${item.text}`);
      }
    } else {
      console.log("\nWorld resolution: no external action proposed.");
    }

    const to = addMinutes(pulled.worldTime, advanceMinutes);
    const advanced = await ingress.advance({ to });
    console.log(`\nWorld advanced: ${advanced.from} -> ${advanced.to}`);
    console.log(
      "Background world event ids are not cognition input until a later pull exposes legal observations.",
    );
  }

  const finalPull = await ingress.pull(actorId, cursor);
  const finalObservations = finalPull.ingested
    .map((result) => events.getEvent(result.eventId))
    .filter((row): row is Row => row !== undefined)
    .map(rowToWorldEvent)
    .map((event) => projector.project(event, actorId))
    .filter((item) => item !== null);
  console.log(`\n=== final perception @ ${finalPull.worldTime} ===`);
  for (const item of finalObservations) console.log(`- ${item.text}`);
} finally {
  readDb.close();
}

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
    throw new Error(
      `DeepSeek policy failed (${response.status}): ${payload.error?.message ?? response.statusText}`,
    );
  }
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("DeepSeek policy returned empty content");
  const raw = JSON.parse(stripFence(content)) as Record<string, unknown>;
  return {
    speech: typeof raw.speech === "string" ? raw.speech : "",
    actionIntent:
      typeof raw.actionIntent === "string" ? raw.actionIntent : "",
    attentionIntent:
      typeof raw.attentionIntent === "string" ? raw.attentionIntent : "",
    control: raw.control === "continue" ? "continue" : "yield",
  };
}

function rowToWorldEvent(row: Row): WorldEvent {
  return {
    schema_version: String(row.schema_version),
    event_id: String(row.event_id),
    origin: row.origin as WorldEvent["origin"],
    kind: String(row.kind),
    channel: row.channel == null ? null : String(row.channel),
    occurred_at: String(row.occurred_at),
    received_at: String(row.received_at),
    world_day: row.world_day == null ? null : Number(row.world_day),
    world_phase: row.world_phase == null ? null : String(row.world_phase),
    provenance: {
      principal_id: String(row.principal_id),
      connector_id: row.connector_id == null ? null : String(row.connector_id),
      external_event_id:
        row.external_event_id == null ? null : String(row.external_event_id),
      trust: String(row.trust),
    },
    privacy_scope: String(row.privacy_scope),
    causation_event_id:
      row.causation_event_id == null ? null : String(row.causation_event_id),
    correlation_id:
      row.correlation_id == null ? null : String(row.correlation_id),
    idempotency_key: String(row.idempotency_key),
    payload: JSON.parse(String(row.payload_json)) as Record<string, unknown>,
  };
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
