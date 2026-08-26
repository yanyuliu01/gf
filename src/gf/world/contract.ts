export type WorldActorId = string;
export type WorldEventId = string;
export type WorldActionId = string;

/**
 * A legal observation that the world may expose to one actor.
 * Hidden world state must never be serialized here.
 */
export interface WorldObservation {
  id: WorldEventId;
  observedAt: string;
  text: string;
  source: "environment" | "actor" | "system" | "external";
  location?: string;
  sourceRef?: string;
}

export interface WorldObservationBatch {
  actorId: WorldActorId;
  worldTime: string;
  cursor: string;
  observations: WorldObservation[];
}

/**
 * Open semantic action proposal from GF Policy.
 * It states intent only; success and concrete outcome belong to the world.
 */
export interface WorldActionProposal {
  id: WorldActionId;
  actorId: WorldActorId;
  proposedAt: string;
  intent: string;
}

export interface WorldActionResolution {
  actionId: WorldActionId;
  actorId: WorldActorId;
  status: "accepted" | "partial" | "rejected" | "deferred";
  happened: string;
  startedAt?: string;
  endedAt?: string;
  committedEventIds: WorldEventId[];
  observations: WorldObservation[];
}

export interface WorldAdvanceRequest {
  /** Advance to an absolute world timestamp. */
  to: string;
}

export interface WorldAdvanceResult {
  from: string;
  to: string;
  committedEventIds: WorldEventId[];
}

/**
 * Boundary between GF cognition/runtime and any external world engine.
 *
 * GF owns cognition, wake/scheduling, memory, belief, affect and Policy.
 * The world owns objective state, time/causality, action adjudication and
 * visibility-filtered observations.
 */
export interface AgentWorld {
  observe(actorId: WorldActorId, afterCursor?: string): Promise<WorldObservationBatch>;
  resolve(proposal: WorldActionProposal): Promise<WorldActionResolution>;
  advance(request: WorldAdvanceRequest): Promise<WorldAdvanceResult>;
}
