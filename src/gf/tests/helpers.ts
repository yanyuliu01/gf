import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { connect } from "../state/db.js";
import { MigrationRunner } from "../state/migrator.js";
import {
  EventStore,
  SceneStore,
  StateStore,
} from "../state/repositories.js";
import { StateManager } from "../state/stateManager.js";
import type { WorldEvent } from "../state/stateManager.js";
import { Policy } from "../validation/policy.js";
import { SchemaRegistry } from "../validation/schemas.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export interface TestRuntime {
  dbPath: string;
  db: DatabaseSync;
  stateManager: StateManager;
  events: EventStore;
  scenes: SceneStore;
  state: StateStore;
  cleanup(): void;
}

export function setupRuntime(): TestRuntime {
  const dir = mkdtempSync(join(tmpdir(), "gf-test-"));
  const dbPath = join(dir, "gf.db");
  const db = connect(dbPath);
  new MigrationRunner(db, join(ROOT, "migrations")).apply();
  const schemas = new SchemaRegistry(join(ROOT, "schemas"));
  const stateManager = new StateManager(
    () => connect(dbPath),
    schemas,
    new Policy(),
  );
  return {
    dbPath,
    db,
    stateManager,
    events: new EventStore(db),
    scenes: new SceneStore(db),
    state: new StateStore(db),
    cleanup: () => {
      try {
        db.close();
      } catch {
        // already closed
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function userEvent(
  text: string,
  overrides: Partial<Record<string, unknown>> = {},
): WorldEvent {
  const now = new Date().toISOString();
  const base: WorldEvent = {
    schema_version: "1.0",
    event_id: `evt_${Math.random().toString(16).slice(2, 10)}`,
    origin: "user",
    kind: "im.message.received",
    channel: "private_im",
    occurred_at: now,
    received_at: now,
    world_day: null,
    world_phase: null,
    provenance: {
      principal_id: "doctor",
      connector_id: "cli:local",
      trust: "authenticated",
    },
    privacy_scope: "private_im",
    causation_event_id: null,
    correlation_id: null,
    idempotency_key: `usr_${Math.random().toString(16).slice(2, 10)}`,
    payload: {
      message_id: `msg_${Math.random().toString(16).slice(2, 10)}`,
      sender_principal_id: "doctor",
      content: [{ type: "text", text }],
    },
  };
  return { ...base, ...overrides } as unknown as WorldEvent;
}

export function tickProposal(
  triggerEventId: string,
  baseRevision = 0,
): Record<string, unknown> {
  return {
    schema_version: "1.0",
    operation_id: `op_${Math.random().toString(16).slice(2, 10)}`,
    trigger_event_id: triggerEventId,
    base_state_revision: baseRevision,
    happened: "世界照常运转，没有特别的事。",
    channels: {
      act: null,
      monologue: null,
      communication_intent: null,
      speech_seed: null,
      express: null,
    },
    claims: [],
    patch_ops: [],
    salience_self: 0.0,
    valence: 0.0,
    intensity: 0.0,
    involves: [],
  };
}
