/**
 * Thin data-access helpers over the GF SQLite schema.
 *
 * The StateManager owns the only transaction boundaries; these helpers are
 * read paths plus small write helpers used by the engine and outbox worker.
 */

import { DatabaseSync } from "node:sqlite";
import { newId, utcnowIso } from "../domain/ids.js";

export type Row = Record<string, unknown>;

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (value === null || value === undefined) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export class EventStore {
  constructor(private readonly db: DatabaseSync) {}

  getEvent(eventId: string): Row | undefined {
    return this.db
      .prepare("SELECT * FROM world_events WHERE event_id = ?")
      .get(eventId) as Row | undefined;
  }

  getByIdempotency(key: string): Row | undefined {
    return this.db
      .prepare("SELECT * FROM world_events WHERE idempotency_key = ?")
      .get(key) as Row | undefined;
  }

  recentEvents(limit = 20): Row[] {
    return this.db
      .prepare(
        "SELECT * FROM world_events ORDER BY received_at DESC, event_id DESC LIMIT ?",
      )
      .all(limit) as Row[];
  }

  count(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM world_events")
      .get() as { n: number };
    return Number(row.n);
  }

  pendingEventIds(): string[] {
    const rows = this.db
      .prepare(
        `
        SELECT e.event_id
        FROM world_events AS e
        WHERE e.event_id NOT IN (
          SELECT trigger_event_id FROM operation_commits
          WHERE trigger_event_id IS NOT NULL
        )
          AND NOT EXISTS (
            SELECT 1
            FROM messages AS m
            JOIN scene_messages AS sm ON sm.message_id = m.message_id
            WHERE m.event_id = e.event_id
          )
        ORDER BY
          CASE e.origin WHEN 'user' THEN 0 ELSE 1 END,
          e.received_at,
          e.event_id
        `,
      )
      .all() as { event_id: string }[];
    return rows.map((row) => row.event_id);
  }
}

export class SceneStore {
  constructor(private readonly db: DatabaseSync) {}

  getOpenScene(): Row | undefined {
    return this.db
      .prepare(
        "SELECT * FROM scenes WHERE status = 'open' ORDER BY opened_at LIMIT 1",
      )
      .get() as Row | undefined;
  }

  getScene(sceneId: string): Row | undefined {
    return this.db
      .prepare("SELECT * FROM scenes WHERE scene_id = ?")
      .get(sceneId) as Row | undefined;
  }

  createOpenScene(privacyScope = "private_im"): Row {
    const sceneId = newId("scn");
    const now = utcnowIso();
    this.db
      .prepare(
        "INSERT INTO scenes(scene_id, status, privacy_scope, opened_at) VALUES (?, 'open', ?, ?)",
      )
      .run(sceneId, privacyScope, now);
    return {
      scene_id: sceneId,
      status: "open",
      privacy_scope: privacyScope,
      opened_at: now,
      closed_at: null,
      summary: null,
    };
  }

  appendMessage(sceneId: string, messageId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM scene_messages WHERE scene_id = ?")
      .get(sceneId) as { n: number };
    const ordinal = Number(row.n);
    this.db
      .prepare(
        "INSERT INTO scene_messages(scene_id, message_id, ordinal) VALUES (?, ?, ?)",
      )
      .run(sceneId, messageId, ordinal);
    return ordinal;
  }

  messagesInScene(sceneId: string): Row[] {
    return this.db
      .prepare(
        `
        SELECT m.*, sm.ordinal
        FROM scene_messages AS sm
        JOIN messages AS m ON m.message_id = sm.message_id
        WHERE sm.scene_id = ?
        ORDER BY sm.ordinal
        `,
      )
      .all(sceneId) as Row[];
  }

  sceneTail(sceneId: string, limit = 40): Row[] {
    const rows = this.db
      .prepare(
        `
        SELECT m.message_id, m.direction, m.content_json, m.created_at
        FROM scene_messages AS sm
        JOIN messages AS m ON m.message_id = sm.message_id
        WHERE sm.scene_id = ?
        ORDER BY sm.ordinal DESC
        LIMIT ?
        `,
      )
      .all(sceneId, limit) as Row[];
    return rows.reverse().map((item) => ({
      ...item,
      content: parseJson(item.content_json as string, {}),
    }));
  }
}

export class StateStore {
  constructor(private readonly db: DatabaseSync) {}

  currentRevision(): number {
    const row = this.db
      .prepare(
        "SELECT current_revision FROM runtime_revision WHERE singleton_id = 1",
      )
      .get() as { current_revision: number } | undefined;
    return row ? Number(row.current_revision) : 0;
  }

  stateDocuments(): Record<string, Record<string, unknown>> {
    const rows = this.db
      .prepare("SELECT document_key, value_json FROM state_documents")
      .all() as { document_key: string; value_json: string }[];
    return Object.fromEntries(
      rows.map((row) => [
        row.document_key,
        parseJson(row.value_json, {}),
      ]),
    );
  }

  latestStateHash(): string | null {
    const row = this.db
      .prepare(
        "SELECT state_hash FROM state_revisions ORDER BY revision DESC LIMIT 1",
      )
      .get() as { state_hash: string } | undefined;
    return row ? row.state_hash : null;
  }

  latestCapabilitySnapshot(): {
    revision: number;
    transport: Record<string, boolean>;
    diegetic: Record<string, boolean>;
    last_changed_event_id: string | null;
  } {
    const row = this.db
      .prepare(
        `
        SELECT revision, transport_json, diegetic_json, last_changed_event_id
        FROM capability_snapshots
        ORDER BY revision DESC
        LIMIT 1
        `,
      )
      .get() as {
      revision: number;
      transport_json: string;
      diegetic_json: string;
      last_changed_event_id: string | null;
    } | undefined;
    if (!row) {
      throw new Error("no capability snapshot; migration incomplete");
    }
    return {
      revision: Number(row.revision),
      transport: parseJson(row.transport_json, {}),
      diegetic: parseJson(row.diegetic_json, {}),
      last_changed_event_id: row.last_changed_event_id,
    };
  }

  outgoingUnprocessed(): Row[] {
    return this.db
      .prepare(
        `
        SELECT * FROM outbox
        WHERE status IN ('pending', 'retry')
        ORDER BY created_at, outbox_id
        `,
      )
      .all() as Row[];
  }

  existingOperation(operationId: string): Row | undefined {
    return this.db
      .prepare("SELECT * FROM operation_commits WHERE operation_id = ?")
      .get(operationId) as Row | undefined;
  }
}
