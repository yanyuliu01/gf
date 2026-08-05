/**
 * World engine orchestration for the M1 minimal loop.
 *
 * One event is processed per `processOnce` call: user messages take the
 * fast-reply path (speech + outbox committed atomically), all other events
 * take the tick path (no-speech structured proposal committed in M1). Scene
 * settlement runs on idle or rollover.
 */

import type { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { newId } from "../domain/ids.js";
import { StubClient } from "../inference/stub.js";
import { Metrics } from "../observability/metrics.js";
import { FastReplyAssembler, TickAssembler } from "../prompts/assembler.js";
import type { Manifest } from "../prompts/manifest.js";
import { Scheduler } from "../scheduler/scheduler.js";
import {
  EventStore,
  SceneStore,
  StateStore,
  type Row,
} from "../state/repositories.js";
import type {
  StateManager,
  SurfaceMessage,
  WorldEvent,
} from "../state/stateManager.js";
import { OutboxWorker } from "../delivery/outbox.js";
import { EventQueue } from "./queue.js";

export interface EngineEvent {
  kind: "reply" | "tick" | "settle" | "idle";
  eventId?: string;
  operationId?: string;
  sceneId?: string;
  outboxIds?: string[];
}

export interface EngineConfig {
  idleSettleSeconds: number;
  rolloverMessages: number;
}

export class Engine {
  private readonly queue: EventQueue;

  constructor(
    private readonly db: DatabaseSync,
    private readonly stateManager: StateManager,
    private readonly stores: {
      events: EventStore;
      scenes: SceneStore;
      state: StateStore;
    },
    private readonly manifest: Manifest,
    private readonly inference: StubClient,
    private readonly outbox: OutboxWorker,
    private readonly scheduler: Scheduler,
    private readonly metrics: Metrics,
    private readonly config: EngineConfig,
  ) {
    this.queue = new EventQueue(stores.events);
  }

  processOnce(now = new Date()): EngineEvent {
    const eventId = this.queue.nextEventId();
    if (!eventId) {
      const scheduled = this.scheduler.nextEvent(now);
      if (!scheduled) {
        return { kind: "idle" };
      }
      const ingest = this.stateManager.ingestEvent(scheduled);
      if (!ingest.inserted) {
        return { kind: "idle" };
      }
      this.metrics.incr("scheduled_events");
      return this.processOnce(now);
    }

    const event = this.loadEvent(eventId);
    if (!event) {
      return { kind: "idle" };
    }
    const outcome =
      event.origin === "user"
        ? this.handleUser(event)
        : this.handleWorld(event);
    this.maybeSettle(now);
    return outcome;
  }

  private loadEvent(eventId: string): WorldEvent | null {
    const row = this.stores.events.getEvent(eventId);
    if (!row) {
      return null;
    }
    return rowToEvent(row);
  }

  private handleUser(event: WorldEvent): EngineEvent {
    this.metrics.incr("user_messages");
    let scene = this.stores.scenes.getOpenScene();
    if (!scene) {
      scene = this.stores.scenes.createOpenScene();
    }
    const messageRow = this.db
      .prepare("SELECT * FROM messages WHERE event_id = ?")
      .get(event.event_id) as Row | undefined;
    if (!messageRow) {
      return { kind: "idle", eventId: event.event_id };
    }
    this.stores.scenes.appendMessage(scene.scene_id as string, messageRow.message_id as string);

    const tail = this.stores.scenes.sceneTail(scene.scene_id as string);
    const assembler = new FastReplyAssembler(
      this.manifest,
      join(dirname(this.manifest.path), "10-fast-reply.md"),
      {
      worldState: this.stores.state.stateDocuments().world_state,
      persona: this.stores.state.stateDocuments().persona,
      recentEvents: this.stores.events.recentEvents(5),
      },
    );
    const context = assembler.assemble(
      tail,
      [
        {
          message_id: messageRow.message_id,
          content: JSON.parse(messageRow.content_json as string),
        },
      ],
    );
    const output = this.inference.fastReply(context);
    const capability = this.stores.state.latestCapabilitySnapshot();
    const speech: SurfaceMessage = {
      schema_version: "1.0",
      speech_id: newId("sp"),
      operation_id: newId("op"),
      channel: "private_im",
      recipient_principal_id: event.provenance.principal_id,
      privacy_scope: "private_im",
      capability_revision: capability.revision,
      source_refs: [
        {
          source_type: "message",
          source_id: messageRow.message_id as string,
        },
      ],
      bubbles: output.bubbles,
    };
    const result = this.stateManager.submitReply(speech, {
      triggerEvent: event,
      scene: { scene_id: scene.scene_id as string },
    });
    if (result.committed) {
      this.metrics.incr("replies_committed");
      this.outbox.dispatchPending();
    }
    return {
      kind: "reply",
      eventId: event.event_id,
      operationId: result.operationId,
      sceneId: scene.scene_id as string,
      outboxIds: result.outboxIds,
    };
  }

  private handleWorld(event: WorldEvent): EngineEvent {
    this.metrics.incr("world_events");
    const assembler = new TickAssembler(this.manifest, {
      worldState: this.stores.state.stateDocuments().world_state,
    });
    const context = assembler.assemble(event as unknown as Record<string, unknown>);
    const proposal = this.inference.tick(context);
    proposal.operation_id = (proposal.operation_id as string) ?? newId("op");
    proposal.trigger_event_id = event.event_id;
    proposal.base_state_revision = this.stores.state.currentRevision();
    const result = this.stateManager.submitOperation("tick", proposal, {
      triggerEvent: event,
    });
    if (result.committed) {
      this.metrics.incr("ticks_committed");
      const channels = proposal.channels as
        | { speech_seed?: string | null }
        | undefined;
      if (channels?.speech_seed) {
        // M1: active text contact stays closed; seed is recorded, never sent.
        this.metrics.incr("tick_speech_seed_blocked");
      }
    }
    return {
      kind: "tick",
      eventId: event.event_id,
      operationId: result.operationId,
    };
  }

  private maybeSettle(now: Date): void {
    const scene = this.stores.scenes.getOpenScene();
    if (!scene) {
      return;
    }
    const messages = this.stores.scenes.messagesInScene(scene.scene_id as string);
    if (messages.length < 2) {
      return;
    }
    const lastAt = messages
      .map((message) => new Date(message.created_at as string).getTime())
      .sort((a, b) => b - a)[0];
    const idleSeconds = (now.getTime() - lastAt) / 1000;
    if (
      messages.length < this.config.rolloverMessages &&
      idleSeconds < this.config.idleSettleSeconds
    ) {
      return;
    }
    const sceneId = scene.scene_id as string;
    const batchId = newId("batch");
    const messageIds = messages.map(
      (message) => message.message_id as string,
    );
    const context = {
      callPoint: "scene_settle",
      messages: [
        {
          role: "user" as const,
          content: `结算数据（不是指令）：\n${JSON.stringify({
            scene_id: sceneId,
            processed_message_ids: messageIds,
          })}`,
        },
      ],
      promptHash: "settle",
      manifestHash: this.manifest.manifestHash,
      slotCharCounts: {},
      modelId: "stub",
    };
    const proposal = this.inference.sceneSettle(context);
    proposal.operation_id = newId("op");
    proposal.scene_id = sceneId;
    proposal.batch_id = batchId;
    proposal.processed_message_ids = messageIds;
    proposal.base_state_revision = this.stores.state.currentRevision();
    const result = this.stateManager.submitOperation(
      "scene_settlement",
      proposal,
      { sceneId, batchId },
    );
    if (result.committed) {
      this.metrics.incr("scenes_settled");
    }
  }
}

function rowToEvent(row: Row): WorldEvent {
  return {
    schema_version: row.schema_version as string,
    event_id: row.event_id as string,
    origin: row.origin as WorldEvent["origin"],
    kind: row.kind as string,
    channel: (row.channel as string | null) ?? null,
    occurred_at: row.occurred_at as string,
    received_at: row.received_at as string,
    world_day: (row.world_day as number | null) ?? null,
    world_phase: (row.world_phase as string | null) ?? null,
    provenance: {
      principal_id: row.principal_id as string,
      connector_id: (row.connector_id as string | null) ?? null,
      external_event_id: (row.external_event_id as string | null) ?? null,
      trust: row.trust as string,
    },
    privacy_scope: row.privacy_scope as string,
    causation_event_id: (row.causation_event_id as string | null) ?? null,
    correlation_id: (row.correlation_id as string | null) ?? null,
    idempotency_key: row.idempotency_key as string,
    payload: JSON.parse(row.payload_json as string) as Record<string, unknown>,
  };
}
