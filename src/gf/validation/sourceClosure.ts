/**
 * Call-scoped source closure validation.
 *
 * Every `source_ref` inside a proposal must belong to the exact inputs
 * assembled for that model call, or to provenance recursively referenced by
 * those inputs. Merely being stored in the database never makes a source
 * visible to a call. Sequential canon ids are not runtime references.
 */

import type { DatabaseSync } from "node:sqlite";
import type { SourceRef } from "../generated/agentPipelineTypes.js";

export type { SourceRef } from "../generated/agentPipelineTypes.js";

export class SourceClosureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceClosureError";
  }
}

const CANON_ID_RE = /^(?:cs|ck|cw)_[0-9a-f]{16}$/;

export class SourceClosure {
  private readonly known = new Set<string>();

  addKnown(sourceType: SourceRef["source_type"], sourceId: string): void {
    this.known.add(`${sourceType}:${sourceId}`);
  }

  checkRef(ref: SourceRef): void {
    const { source_type: sourceType, source_id: sourceId } = ref;
    if (sourceType === "canon" && !CANON_ID_RE.test(sourceId)) {
      throw new SourceClosureError(
        `unstable canon id ${sourceId}; only content-addressed ids are runtime references`,
      );
    }
    if (!this.known.has(`${sourceType}:${sourceId}`)) {
      throw new SourceClosureError(
        `source ${sourceType}:${sourceId} outside legal closure`,
      );
    }
  }

  checkRefs(refs: readonly SourceRef[] | undefined): void {
    for (const ref of refs ?? []) {
      this.checkRef(ref);
    }
  }

  checkEventIds(eventIds: string[] | undefined): void {
    for (const eventId of eventIds ?? []) {
      if (!this.known.has(`event:${eventId}`)) {
        throw new SourceClosureError(
          `cause event ${eventId} outside legal closure`,
        );
      }
    }
  }
}

/**
 * Build the legal closure from the call's explicit inputs.
 *
 * Claims expose their recorded source refs and causal action. Events expose
 * only their causal ancestor. Messages do not implicitly expose their parent
 * event, and events do not expose sibling/child messages: those must have been
 * assembled as their own call inputs.
 */
export function closureFromInputs(
  db: DatabaseSync,
  roots: Iterable<SourceRef>,
): SourceClosure {
  const closure = new SourceClosure();
  const queued = new Set<string>();
  const queue: SourceRef[] = [];

  const enqueue = (ref: SourceRef): void => {
    const key = `${ref.source_type}:${ref.source_id}`;
    if (!queued.has(key)) {
      queued.add(key);
      queue.push(ref);
    }
  };

  for (const root of roots) {
    enqueue(root);
  }

  for (let index = 0; index < queue.length; index += 1) {
    const ref = queue[index];
    const sourceType = ref.source_type;
    const sourceId = ref.source_id;

    if (sourceType === "canon") {
      if (!CANON_ID_RE.test(sourceId)) {
        throw new SourceClosureError(
          `unstable canon id ${sourceId}; only content-addressed ids are runtime references`,
        );
      }
      closure.addKnown(sourceType, sourceId);
      continue;
    }

    if (sourceType === "external_action") {
      // The namespace is reserved but has no authoritative table in M1. An
      // external action is legal only when explicitly supplied by the caller
      // or reached through recorded claim provenance.
      closure.addKnown(sourceType, sourceId);
      continue;
    }

    if (sourceType === "message") {
      const row = db
        .prepare("SELECT 1 AS present FROM messages WHERE message_id = ?")
        .get(sourceId);
      if (!row) {
        throw new SourceClosureError(
          `input source message:${sourceId} is not stored`,
        );
      }
      closure.addKnown(sourceType, sourceId);
      continue;
    }

    if (sourceType === "event") {
      const row = db
        .prepare(
          "SELECT causation_event_id FROM world_events WHERE event_id = ?",
        )
        .get(sourceId) as { causation_event_id: string | null } | undefined;
      if (!row) {
        throw new SourceClosureError(`input source event:${sourceId} is not stored`);
      }
      closure.addKnown(sourceType, sourceId);
      if (row.causation_event_id) {
        enqueue({ source_type: "event", source_id: row.causation_event_id });
      }
      continue;
    }

    const claim = db
      .prepare(
        `
        SELECT causal_action_source_type, causal_action_source_id
        FROM claims WHERE claim_id = ?
        `,
      )
      .get(sourceId) as
      | {
          causal_action_source_type: SourceRef["source_type"] | null;
          causal_action_source_id: string | null;
        }
      | undefined;
    if (!claim) {
      throw new SourceClosureError(`input source claim:${sourceId} is not stored`);
    }
    closure.addKnown(sourceType, sourceId);
    const sources = db
      .prepare(
        "SELECT source_type, source_id FROM claim_sources WHERE claim_id = ?",
      )
      .all(sourceId) as {
      source_type: SourceRef["source_type"];
      source_id: string;
    }[];
    for (const source of sources) {
      enqueue(source);
    }
    if (claim.causal_action_source_type && claim.causal_action_source_id) {
      enqueue({
        source_type: claim.causal_action_source_type,
        source_id: claim.causal_action_source_id,
      });
    }
  }

  return closure;
}
