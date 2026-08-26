import assert from "node:assert/strict";
import test from "node:test";
import type { DatabaseSync } from "node:sqlite";

import { PerceptionProjector } from "../perception/projector.js";
import type { WorldEvent } from "../state/stateManager.js";
import type {
  AgentWorld,
  WorldActionProposal,
  WorldActionResolution,
  WorldAdvanceRequest,
  WorldAdvanceResult,
  WorldObservationBatch,
} from "../world/contract.js";
import { AgentWorldIngress } from "../world/ingress.js";
import { setupRuntime } from "./helpers.js";

class FakeWorld implements AgentWorld {
  observationBatch: WorldObservationBatch = {
    actorId: "muelsyse",
    worldTime: "2026-08-26T14:20:00+08:00",
    cursor: "world_evt_2",
    observations: [
      {
        id: "world_obs_s4",
        observedAt: "2026-08-26T14:20:00+08:00",
        text: "S-4 第二组湿度读数仍在处理中。",
        source: "system",
        location: "中央生态园",
        sourceRef: "terminal:s4",
      },
    ],
  };

  resolution: WorldActionResolution = {
    actionId: "world_action_1",
    actorId: "muelsyse",
    status: "partial",
    happened:
      "她检查了终端；后台同时记录了一个她当前看不到的维护队列变化。",
    startedAt: "2026-08-26T14:20:05+08:00",
    endedAt: "2026-08-26T14:20:10+08:00",
    committedEventIds: ["world_evt_3", "world_evt_hidden_4"],
    observations: [
      {
        id: "world_obs_after_check",
        observedAt: "2026-08-26T14:20:10+08:00",
        text: "终端显示第二组采样预计还需要约 7 分钟。",
        source: "system",
        location: "中央生态园",
        sourceRef: "terminal:s4",
      },
    ],
  };

  async observe(): Promise<WorldObservationBatch> {
    return this.observationBatch;
  }

  async resolve(_proposal: WorldActionProposal): Promise<WorldActionResolution> {
    return this.resolution;
  }

  async advance(request: WorldAdvanceRequest): Promise<WorldAdvanceResult> {
    return {
      from: this.observationBatch.worldTime,
      to: request.to,
      committedEventIds: ["world_evt_background_only"],
    };
  }
}

function readEvent(db: DatabaseSync, eventId: string): WorldEvent {
  const row = db
    .prepare("SELECT * FROM world_events WHERE event_id = ?")
    .get(eventId) as Record<string, unknown> | undefined;
  assert.ok(row, `missing event ${eventId}`);
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

test("world ingress is idempotent and only stores visibility-filtered observations as perception events", async () => {
  const runtime = setupRuntime();
  try {
    const world = new FakeWorld();
    const ingress = new AgentWorldIngress(runtime.stateManager, world, {
      connectorId: "world:fake",
    });

    const first = await ingress.pull("muelsyse");
    const second = await ingress.pull("muelsyse");

    assert.equal(first.ingested.length, 1);
    assert.equal(first.ingested[0].inserted, true);
    assert.equal(second.ingested[0].inserted, false);
    assert.equal(second.ingested[0].replay, true);
    assert.equal(second.ingested[0].eventId, first.ingested[0].eventId);

    const count = runtime.db
      .prepare(
        "SELECT COUNT(*) AS n FROM world_events WHERE kind = 'world.observation.received'",
      )
      .get() as { n: number };
    assert.equal(count.n, 1);
  } finally {
    runtime.cleanup();
  }
});

test("objective action outcome enters ledger but cannot cross PerceptionProjector by itself", async () => {
  const runtime = setupRuntime();
  try {
    const world = new FakeWorld();
    const ingress = new AgentWorldIngress(runtime.stateManager, world, {
      connectorId: "world:fake",
    });
    const proposal: WorldActionProposal = {
      id: "world_action_1",
      actorId: "muelsyse",
      proposedAt: "2026-08-26T14:20:00+08:00",
      intent: "确认一下 S-4 第二组湿度读数有没有出来。",
    };

    const result = await ingress.resolve(proposal);
    const projector = new PerceptionProjector();
    const outcomeEvent = readEvent(runtime.db, result.outcome.eventId);
    const observationEvent = readEvent(
      runtime.db,
      result.observations[0].eventId,
    );

    assert.equal(outcomeEvent.kind, "world.action.resolved");
    assert.match(
      String(outcomeEvent.payload.happened),
      /她当前看不到的维护队列变化/,
    );
    assert.equal(projector.project(outcomeEvent, "muelsyse"), null);

    const observation = projector.project(observationEvent, "muelsyse");
    assert.ok(observation);
    assert.equal(
      observation.text,
      "终端显示第二组采样预计还需要约 7 分钟。",
    );
    assert.equal(observation.location, "中央生态园");
    assert.doesNotMatch(observation.text, /维护队列/);
    assert.equal(observationEvent.causation_event_id, result.outcome.eventId);
  } finally {
    runtime.cleanup();
  }
});

test("world advance event ids do not become perceptions until the world exposes them", async () => {
  const runtime = setupRuntime();
  try {
    const world = new FakeWorld();
    const ingress = new AgentWorldIngress(runtime.stateManager, world, {
      connectorId: "world:fake",
    });

    const advanced = await ingress.advance({
      to: "2026-08-26T15:00:00+08:00",
    });
    assert.deepEqual(advanced.committedEventIds, ["world_evt_background_only"]);

    const count = runtime.db
      .prepare("SELECT COUNT(*) AS n FROM world_events")
      .get() as { n: number };
    assert.equal(count.n, 0);
  } finally {
    runtime.cleanup();
  }
});

test("perception projector is actor-scoped", () => {
  const projector = new PerceptionProjector();
  const now = "2026-08-26T14:20:00+08:00";
  const event: WorldEvent = {
    schema_version: "1.0",
    event_id: "evt_observation",
    origin: "system",
    kind: "world.observation.received",
    channel: null,
    occurred_at: now,
    received_at: now,
    provenance: {
      principal_id: "world",
      connector_id: "world:fake",
      external_event_id: "world_obs_private",
      trust: "verified",
    },
    privacy_scope: "internal",
    idempotency_key: "world:fake:observation:world_obs_private:muelsyse",
    payload: {
      actor_id: "muelsyse",
      observation_id: "world_obs_private",
      observed_at: now,
      text: "她能看到的内容。",
      source: "environment",
      location: "中央生态园",
      source_ref: null,
      world_time: now,
      world_cursor: "world_evt_9",
    },
  };

  assert.ok(projector.project(event, "muelsyse"));
  assert.equal(projector.project(event, "other_actor"), null);
});
