#!/usr/bin/env node
/**
 * GF runtime CLI (M1).
 *
 * Interactive REPL:
 *   node dist/gf/cli.js [--db runtime/gf.db] [--debounce 10]
 *
 * Meta commands (never enter the world):
 *   /status /world [n] /budget /mute [minutes] /snapshot /exit
 *
 * Dry-run skeleton:
 *   node dist/gf/cli.js --dry-run 24 --advance-minutes 360
 */

import { createInterface } from "node:readline";
import { CliAdapter } from "./adapters/cli.js";
import { OutboxWorker } from "./delivery/outbox.js";
import { Gateway } from "./gateway/gateway.js";
import { StubClient } from "./inference/stub.js";
import { Metrics } from "./observability/metrics.js";
import { Engine } from "./orchestration/engine.js";
import { Manifest } from "./prompts/manifest.js";
import { Scheduler } from "./scheduler/scheduler.js";
import { connect } from "./state/db.js";
import { MigrationRunner } from "./state/migrator.js";
import {
  EventStore,
  SceneStore,
  StateStore,
} from "./state/repositories.js";
import { StateManager } from "./state/stateManager.js";
import { Policy } from "./validation/policy.js";
import { SchemaRegistry } from "./validation/schemas.js";

interface CliOptions {
  db: string;
  migrations: string;
  prompts: string;
  schemas: string;
  debounce: number;
  idleSettleSeconds: number;
  rolloverMessages: number;
  dryRun: number;
  advanceMinutes: number;
  migrateOnly: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    db: "runtime/gf.db",
    migrations: "migrations",
    prompts: "prompts",
    schemas: "schemas",
    debounce: 10,
    idleSettleSeconds: 600,
    rolloverMessages: 30,
    dryRun: 0,
    advanceMinutes: 360,
    migrateOnly: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = (): string => argv[++i];
    switch (arg) {
      case "--db":
        options.db = next();
        break;
      case "--migrations":
        options.migrations = next();
        break;
      case "--prompts":
        options.prompts = next();
        break;
      case "--schemas":
        options.schemas = next();
        break;
      case "--debounce":
        options.debounce = Number(next());
        break;
      case "--idle-settle":
        options.idleSettleSeconds = Number(next());
        break;
      case "--rollover":
        options.rolloverMessages = Number(next());
        break;
      case "--dry-run":
        options.dryRun = Number(next());
        break;
      case "--advance-minutes":
        options.advanceMinutes = Number(next());
        break;
      case "--migrate-only":
        options.migrateOnly = true;
        break;
      default:
        console.error(`unknown argument: ${arg}`);
        process.exit(2);
    }
  }
  return options;
}

function buildRuntime(options: CliOptions) {
  const db = connect(options.db);
  const migrator = new MigrationRunner(db, options.migrations);
  migrator.apply();
  if (options.migrateOnly) {
    db.close();
    process.exit(0);
  }

  const schemas = new SchemaRegistry(options.schemas);
  const stateManager = new StateManager(() => connect(options.db), schemas, new Policy());
  const events = new EventStore(db);
  const scenes = new SceneStore(db);
  const state = new StateStore(db);
  const manifest = new Manifest(`${options.prompts}/manifest.yaml`);
  const metrics = new Metrics();
  const muteUntil = { value: 0 };
  const adapter = new CliAdapter(undefined, () => Date.now() < muteUntil.value);
  const outbox = new OutboxWorker(() => connect(options.db), adapter, metrics);
  const scheduler = new Scheduler(db);
  const inference = new StubClient();
  const engine = new Engine(
    db,
    stateManager,
    { events, scenes, state },
    manifest,
    inference,
    outbox,
    scheduler,
    metrics,
    {
      idleSettleSeconds: options.idleSettleSeconds,
      rolloverMessages: options.rolloverMessages,
    },
  );
  return {
    db,
    stateManager,
    events,
    scenes,
    state,
    metrics,
    outbox,
    engine,
    adapter,
    muteUntil,
  };
}

function renderStatus(state: StateStore, metrics: Metrics): string {
  const revision = state.currentRevision();
  const documents = state.stateDocuments();
  const world = (documents.world_state ?? {}) as Record<string, unknown>;
  const snapshot = metrics.snapshot();
  return [
    `state revision: ${revision}`,
    `world: day ${world.world_day ?? "?"} ${world.world_phase ?? "?"} @ ${world.location ?? "?"} — ${world.activity ?? ""}`,
    `capabilities: ${JSON.stringify(world.channel_capabilities ?? {})}`,
    `metrics: ${JSON.stringify(snapshot)}`,
  ].join("\n");
}

function renderEvents(events: EventStore, limit: number): string {
  const recent = events.recentEvents(limit);
  if (recent.length === 0) {
    return "（暂无世界事件）";
  }
  return recent
    .map(
      (row) =>
        `${row.occurred_at} [${row.origin}] ${row.kind} (${row.event_id})`,
    )
    .join("\n");
}

async function runRepl(options: CliOptions): Promise<void> {
  const runtime = buildRuntime(options);
  const gateway = new Gateway({ debounceSeconds: options.debounce });
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.setPrompt("博士> ");
  rl.prompt();

  rl.on("line", (rawLine) => {
    const result = gateway.handleLine(rawLine);
    for (const event of result.events) {
      runtime.stateManager.ingestEvent(event);
    }
    if (result.meta) {
      const { name, args } = result.meta;
      switch (name) {
        case "status":
          console.log(renderStatus(runtime.state, runtime.metrics));
          break;
        case "world": {
          const limit = Number(args[0] ?? 10) || 10;
          console.log(renderEvents(runtime.events, limit));
          break;
        }
        case "budget":
          console.log(JSON.stringify(runtime.metrics.snapshot(), null, 2));
          break;
        case "mute": {
          const minutes = Number(args[0] ?? 0) || 0;
          runtime.muteUntil.value =
            minutes > 0 ? Date.now() + minutes * 60_000 : Number.MAX_SAFE_INTEGER;
          console.log(
            minutes > 0
              ? `已静音 ${minutes} 分钟（出向冻结，解除后偿还）`
              : "已静音（出向冻结）",
          );
          break;
        }
        case "snapshot":
          console.log("M1 未启用 git 导出；状态已由 SQLite 事务持久化。");
          break;
        case "exit":
          rl.close();
          break;
      }
    } else if (!result.dropped) {
      runtime.engine.processOnce();
      runtime.engine.processOnce();
    }
    if (!rl.closed) {
      rl.prompt();
    }
  });

  rl.on("close", () => {
    const flushed = gateway.flush();
    for (const event of flushed) {
      runtime.stateManager.ingestEvent(event);
    }
    runtime.engine.processOnce();
    console.log("\n—— 会话结束，出向队列已提交。");
    runtime.db.close();
    process.exit(0);
  });
}

async function runDryRun(options: CliOptions): Promise<void> {
  const runtime = buildRuntime(options);
  const base = new Date("2026-08-05T04:30:00Z");
  let committed = 0;
  for (let i = 0; i < options.dryRun; i += 1) {
    const now = new Date(base.getTime() + i * options.advanceMinutes * 60_000);
    const outcome = runtime.engine.processOnce(now);
    if (outcome.kind === "tick" && outcome.operationId) {
      committed += 1;
    }
  }
  const snapshot = runtime.metrics.snapshot();
  console.log(
    [
      `dry-run 完成：${options.dryRun} 轮，提交 tick ${committed} 次`,
      `metrics: ${JSON.stringify(snapshot)}`,
      `pending outbox: ${runtime.events.pendingEventIds().length} 事件未消费`,
    ].join("\n"),
  );
  runtime.db.close();
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.dryRun > 0) {
    await runDryRun(options);
  } else {
    await runRepl(options);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
