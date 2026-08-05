/**
 * Source closure validation.
 *
 * Every `source_ref` inside a proposal must belong to the call's legal source
 * closure: the trigger event and its inputs, events/messages/claims already in
 * the ledger, or stable content-addressed canon ids. Sequential canon ids are
 * not runtime references.
 */

import type { DatabaseSync } from "node:sqlite";

export class SourceClosureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceClosureError";
  }
}

export interface SourceRef {
  source_type: "message" | "event" | "claim" | "external_action" | "canon";
  source_id: string;
  quote_hash?: string | null;
  observed_at?: string | null;
}

const CANON_ID_RE = /^(?:cs|ck|cw)_[0-9a-f]{16}$/;

export class SourceClosure {
  private readonly known = new Set<string>();

  constructor(known?: Iterable<[string, string]>) {
    for (const [sourceType, sourceId] of known ?? []) {
      this.addKnown(sourceType, sourceId);
    }
  }

  addKnown(sourceType: string, sourceId: string): void {
    this.known.add(`${sourceType}:${sourceId}`);
  }

  addEvent(eventId: string): void {
    this.known.add(`event:${eventId}`);
  }

  addMessage(messageId: string): void {
    this.known.add(`message:${messageId}`);
  }

  addClaim(claimId: string): void {
    this.known.add(`claim:${claimId}`);
  }

  checkRef(ref: SourceRef): void {
    const { source_type: sourceType, source_id: sourceId } = ref;
    if (sourceType === "canon") {
      if (!CANON_ID_RE.test(sourceId)) {
        throw new SourceClosureError(
          `unstable canon id ${sourceId}; only content-addressed ids are runtime references`,
        );
      }
      return;
    }
    if (!this.known.has(`${sourceType}:${sourceId}`)) {
      throw new SourceClosureError(
        `source ${sourceType}:${sourceId} outside legal closure`,
      );
    }
  }

  checkRefs(refs: SourceRef[] | undefined): void {
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

export function closureFromDb(
  db: DatabaseSync,
  triggerEvent?: { event_id: string } | null,
  extra: Iterable<[string, string]> = [],
): SourceClosure {
  const closure = new SourceClosure(extra);
  if (triggerEvent) {
    closure.addEvent(triggerEvent.event_id);
    const message = db
      .prepare("SELECT message_id FROM messages WHERE event_id = ?")
      .get(triggerEvent.event_id) as { message_id: string } | undefined;
    if (message) {
      closure.addMessage(message.message_id);
    }
  }
  for (const row of db.prepare("SELECT event_id FROM world_events").all() as {
    event_id: string;
  }[]) {
    closure.addEvent(row.event_id);
  }
  for (const row of db.prepare("SELECT message_id FROM messages").all() as {
    message_id: string;
  }[]) {
    closure.addMessage(row.message_id);
  }
  for (const row of db.prepare("SELECT claim_id FROM claims").all() as {
    claim_id: string;
  }[]) {
    closure.addClaim(row.claim_id);
  }
  return closure;
}
