import type { WorldEvent } from "../state/stateManager.js";

export interface ObservationV1 {
  schemaVersion: "1.0";
  observationId: string;
  sourceEventId: string;
  actorId: string;
  observedAt: string;
  text: string;
  source: "environment" | "actor" | "system" | "external";
  location: string | null;
  sourceRef: string | null;
  worldTime: string | null;
  worldCursor: string | null;
}

/**
 * Projects canonical GF WorldEvents into actor-visible observations.
 *
 * Objective world outcomes are deliberately not projected. Only events that
 * explicitly represent a visibility-filtered observation may cross this seam.
 */
export class PerceptionProjector {
  project(event: WorldEvent, actorId: string): ObservationV1 | null {
    if (event.kind !== "world.observation.received") {
      return null;
    }

    const payload = event.payload as Record<string, unknown>;
    if (payload.actor_id !== actorId) {
      return null;
    }

    const text = payload.text;
    const observedAt = payload.observed_at;
    const observationId = payload.observation_id;
    const source = payload.source;

    if (
      typeof text !== "string" ||
      typeof observedAt !== "string" ||
      typeof observationId !== "string" ||
      !isObservationSource(source)
    ) {
      throw new Error(
        `malformed world.observation.received event ${event.event_id}`,
      );
    }

    return {
      schemaVersion: "1.0",
      observationId,
      sourceEventId: event.event_id,
      actorId,
      observedAt,
      text,
      source,
      location:
        typeof payload.location === "string" ? payload.location : null,
      sourceRef:
        typeof payload.source_ref === "string" ? payload.source_ref : null,
      worldTime:
        typeof payload.world_time === "string" ? payload.world_time : null,
      worldCursor:
        typeof payload.world_cursor === "string" ? payload.world_cursor : null,
    };
  }
}

function isObservationSource(
  value: unknown,
): value is ObservationV1["source"] {
  return (
    value === "environment" ||
    value === "actor" ||
    value === "system" ||
    value === "external"
  );
}
