import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CliAdapter } from "../adapters/cli.js";
import { OutboxWorker } from "../delivery/outbox.js";
import { Gateway } from "../gateway/gateway.js";
import { StubClient } from "../inference/stub.js";
import { Metrics } from "../observability/metrics.js";
import { Engine } from "../orchestration/engine.js";
import { Manifest } from "../prompts/manifest.js";
import { Scheduler } from "../scheduler/scheduler.js";
import { connect } from "../state/db.js";
import { MigrationRunner } from "../state/migrator.js";
import {
  EventStore,
  SceneStore,
  StateStore,
} from "../state/repositories.js";
import { StateManager } from "../state/stateManager.js";
import { Policy } from "../validation/policy.js";
import { SchemaRegistry } from "../validation/schemas.js";
import { userEvent } from "./helpers.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function buildEngine(options: {
  idleSettleSeconds?: number;
  rolloverMessages?: number;
  now?: Date;
  stub?: StubClient;
}) {
  const dir = mkdtempSync(join(tmpdir(), "gf-engine-"));
  const dbPath = join(dir, "gf.db");
  const db = connect(dbPath);
  new MigrationRunner(db, join(ROOT, "migrations")).apply();
  const schemas = new SchemaRegistry(join(ROOT, "schemas"));
  const stateManager = new StateManager(
    () => connect(dbPath),
    schemas,
    new Policy(),
  );
  const events = new EventStore(db);
  const scenes = new SceneStore(db);
  const state = new StateStore(db);
  const manifest = new Manifest(join(ROOT, "prompts", "manifest.yaml"));
  const metrics = new Metrics();
  const sent: string[] = [];
  const adapter = new CliAdapter((line) => sent.push(line));
  const outbox = new OutboxWorker(() => connect(dbPath), adapter, metrics);
  const scheduler = new Scheduler(db, { now: options.now ?? new Date() });
  const stub = options.stub ?? new StubClient();
  const engine = new Engine(
    db,
    stateManager,
    { events, scenes, state },
    manifest,
    stub,
    outbox,
    scheduler,
    metrics,
    {
      idleSettleSeconds: options.idleSettleSeconds ?? 600,
      rolloverMessages: options.rolloverMessages ?? 30,
    },
  );
  return {
    db,
    dbPath,
    dir,
    stateManager,
    events,
    scenes,
    state,
    metrics,
    outbox,
    engine,
    sent,
    cleanup: () => {
      try {
        db.close();
      } catch {
        // ignore
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("user message -> fast reply -> speech/outbox atomic commit -> delivery", () => {
  const rt = buildEngine({});
  try {
    const gateway = new Gateway({ debounceSeconds: 0 });
    const result = gateway.handleLine("在吗");
    assert.equal(result.events.length, 1);
    rt.stateManager.ingestEvent(result.events[0]);
    const outcome = rt.engine.processOnce();
    assert.equal(outcome.kind, "reply");
    assert.equal(rt.state.currentRevision(), 1);
    const speechRows = rt.db
      .prepare("SELECT * FROM speech_records")
      .all() as { speech_id: string; status: string }[];
    assert.equal(speechRows.length, 1);
    const outboxRows = rt.db
      .prepare("SELECT * FROM outbox")
      .all() as { status: string }[];
    assert.equal(outboxRows.length, 1);
    assert.equal(outboxRows[0].status, "sent");
    assert.deepEqual(rt.sent, ["嗯，听到了。"]);
    const sceneMessages = rt.scenes.messagesInScene(outcome.sceneId!);
    assert.equal(sceneMessages.length, 2);
  } finally {
    rt.cleanup();
  }
});

test("scheduled phase event produces a committed no-speech tick", () => {
  // Deterministic: scheduler starts at night, then a morning event arrives.
  const rt = buildEngine({ now: new Date("2026-08-05T23:00:00Z") });
  try {
    const outcome = rt.engine.processOnce(new Date("2026-08-05T09:00:00Z"));
    assert.equal(outcome.kind, "tick");
    assert.equal(rt.state.currentRevision(), 1);
    const outboxRows = rt.db.prepare("SELECT * FROM outbox").all();
    assert.equal(outboxRows.length, 0);
    assert.equal(rt.sent.length, 0);
  } finally {
    rt.cleanup();
  }
});

test("outbox crash recovery does not duplicate delivery", () => {
  const rt = buildEngine({});
  try {
    const gateway = new Gateway({ debounceSeconds: 0 });
    const event = gateway.handleLine("在吗").events[0];
    rt.stateManager.ingestEvent(event);
    rt.engine.processOnce();
    assert.equal(rt.sent.length, 1);

    // Simulate crash after delivery record but before outbox marked sent.
    rt.db.prepare("UPDATE outbox SET status = 'pending', sent_at = NULL").run();
    rt.outbox.dispatchPending();
    assert.equal(rt.sent.length, 1, "adapter must not be called twice");
    const deliveries = rt.db.prepare("SELECT * FROM deliveries").all();
    assert.equal(deliveries.length, 1);
    const outboxRows = rt.db
      .prepare("SELECT * FROM outbox WHERE status = 'sent'")
      .all();
    assert.equal(outboxRows.length, 1);
  } finally {
    rt.cleanup();
  }
});

test("idle scene settles and closes", () => {
  const rt = buildEngine({ idleSettleSeconds: 0, rolloverMessages: 30 });
  try {
    const gateway = new Gateway({ debounceSeconds: 0 });
    const event = gateway.handleLine("聊聊").events[0];
    rt.stateManager.ingestEvent(event);
    rt.engine.processOnce();
    const scene = rt.db.prepare("SELECT * FROM scenes").get() as {
      status: string;
      summary: string | null;
    };
    assert.equal(scene.status, "closed");
    assert.ok(scene.summary);
    const settled = rt.db
      .prepare(
        "SELECT COUNT(*) AS n FROM operation_commits WHERE operation_kind = 'scene_settlement'",
      )
      .get() as { n: number };
    assert.equal(settled.n, 1);
  } finally {
    rt.cleanup();
  }
});

test("injected stub reply bubbles are committed verbatim", () => {
  const stub = new StubClient({
    fastReply: () => ({ bubbles: ["第一段", "第二段"] }),
  });
  const rt = buildEngine({ stub });
  try {
    const event = userEvent("测试");
    rt.stateManager.ingestEvent(event);
    const outcome = rt.engine.processOnce();
    assert.equal(outcome.kind, "reply");
    assert.deepEqual(rt.sent, ["第一段", "第二段"]);
  } finally {
    rt.cleanup();
  }
});
