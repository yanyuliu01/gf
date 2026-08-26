import { newId, utcnowIso } from "../domain/ids.js";
import type {
  IngestResult,
  StateManager,
  WorldEvent,
} from "../state/stateManager.js";
import type {
  AgentWorld,
  WorldActionProposal,
  WorldActionResolution,
  WorldActorId,
  WorldAdvanceRequest,
  WorldAdvanceResult,
  WorldObservation,
  WorldObservationBatch,
} from "./contract.js";

export interface WorldIngressOptions {
  /** Stable GF provenance id for this world backend, e.g. `world:concordia`. */
  connectorId: string;
  /** Principal that owns world-originated facts in the GF ledger. */
  principalId?: string;
}

export interface WorldPullResult {
  actorId: WorldActorId;
  worldTime: string;
  cursor: string;
  ingested: IngestResult[];
}

export interface WorldResolveIngressResult {
  resolution: WorldActionResolution;
  outcome: IngestResult;
  observations: IngestResult[];
}

/**
 * Adapter-only ingress from an external AgentWorld into the canonical GF ledger.
 *
 * This class deliberately does NOT decide wake, build Working Self, call Policy,
 * or expose raw world state to cognition. Its only job is to normalize world
 * backend results into sourced WorldEvents and hand them to StateManager.
 */
export class AgentWorldIngress {
  private readonly principalId: string;

  constructor(
    private readonly stateManager: StateManager,
    private readonly world: AgentWorld,
    private readonly options: WorldIngressOptions,
  ) {
    this.principalId = options.principalId ?? "world";
  }

  async pull(
    actorId: WorldActorId,
    afterCursor?: string,
  ): Promise<WorldPullResult> {
    const batch = await this.world.observe(actorId, afterCursor);
    if (batch.actorId !== actorId) {
      throw new Error(
        `world observation actor mismatch: requested ${actorId}, got ${batch.actorId}`,
      );
    }

    const ingested = batch.observations.map((observation) =>
      this.stateManager.ingestEvent(
        this.observationEvent(observation, batch, actorId),
      ),
    );

    return {
      actorId,
      worldTime: batch.worldTime,
      cursor: batch.cursor,
      ingested,
    };
  }

  async resolve(
    proposal: WorldActionProposal,
    options: { causationEventId?: string | null } = {},
  ): Promise<WorldResolveIngressResult> {
    const resolution = await this.world.resolve(proposal);
    if (resolution.actionId !== proposal.id) {
      throw new Error(
        `world resolution action mismatch: proposed ${proposal.id}, got ${resolution.actionId}`,
      );
    }
    if (resolution.actorId !== proposal.actorId) {
      throw new Error(
        `world resolution actor mismatch: proposed ${proposal.actorId}, got ${resolution.actorId}`,
      );
    }

    const outcome = this.stateManager.ingestEvent(
      this.resolutionEvent(resolution, proposal, options.causationEventId ?? null),
    );

    const observationBatch: WorldObservationBatch = {
      actorId: proposal.actorId,
      worldTime:
        resolution.endedAt ?? resolution.startedAt ?? proposal.proposedAt,
      cursor: resolution.committedEventIds.at(-1) ?? resolution.actionId,
      observations: resolution.observations,
    };
    const observations = resolution.observations.map((observation) =>
      this.stateManager.ingestEvent(
        this.observationEvent(
          observation,
          observationBatch,
          proposal.actorId,
          outcome.eventId,
        ),
      ),
    );

    return { resolution, outcome, observations };
  }

  /**
   * Advance external world time only. Returned world event ids are NOT treated
   * as perceptions; callers must use pull() to obtain visibility-filtered
   * observations before anything can enter cognition.
   */
  advance(request: WorldAdvanceRequest): Promise<WorldAdvanceResult> {
    return this.world.advance(request);
  }

  private observationEvent(
    observation: WorldObservation,
    batch: WorldObservationBatch,
    actorId: WorldActorId,
    causationEventId: string | null = null,
  ): WorldEvent {
    return {
      schema_version: "1.0",
      event_id: newId("evt"),
      origin: "system",
      kind: "world.observation.received",
      channel: null,
      occurred_at: observation.observedAt,
      received_at: utcnowIso(),
      world_day: null,
      world_phase: null,
      provenance: {
        principal_id: this.principalId,
        connector_id: this.options.connectorId,
        external_event_id: observation.id,
        trust: "verified",
      },
      privacy_scope: "internal",
      causation_event_id: causationEventId,
      correlation_id: null,
      idempotency_key: `${this.options.connectorId}:observation:${observation.id}:${actorId}`,
      payload: {
        actor_id: actorId,
        world_time: batch.worldTime,
        world_cursor: batch.cursor,
        observation_id: observation.id,
        observed_at: observation.observedAt,
        text: observation.text,
        source: observation.source,
        location: observation.location ?? null,
        source_ref: observation.sourceRef ?? null,
      },
    };
  }

  private resolutionEvent(
    resolution: WorldActionResolution,
    proposal: WorldActionProposal,
    causationEventId: string | null,
  ): WorldEvent {
    return {
      schema_version: "1.0",
      event_id: newId("evt"),
      origin: "system",
      kind: "world.action.resolved",
      channel: null,
      occurred_at:
        resolution.endedAt ?? resolution.startedAt ?? proposal.proposedAt,
      received_at: utcnowIso(),
      world_day: null,
      world_phase: null,
      provenance: {
        principal_id: this.principalId,
        connector_id: this.options.connectorId,
        external_event_id: resolution.actionId,
        trust: "verified",
      },
      privacy_scope: "internal",
      causation_event_id: causationEventId,
      correlation_id: null,
      idempotency_key: `${this.options.connectorId}:resolution:${resolution.actionId}`,
      payload: {
        actor_id: resolution.actorId,
        action_id: resolution.actionId,
        proposed_intent: proposal.intent,
        status: resolution.status,
        happened: resolution.happened,
        started_at: resolution.startedAt ?? null,
        ended_at: resolution.endedAt ?? null,
        committed_world_event_ids: resolution.committedEventIds,
      },
    };
  }
}
