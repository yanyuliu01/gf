#!/usr/bin/env node
import { resolve } from "node:path";
import lockfile from "proper-lockfile";
import { connect } from "./state/db.js";
import { MigrationRunner } from "./state/migrator.js";
import { SchemaRegistry } from "./validation/schemas.js";
import { StateManager } from "./state/stateManager.js";
import { LifeRuntime } from "./world/life/runtime.js";
import { DeepSeekLifeModel } from "./world/life/model.js";
import { createLifeFixture } from "./world/life/fixtureModel.js";
import { createFeishuConnection, LifeOutboxWorker } from "./adapters/feishu.js";
const required = [
  "FEISHU_APP_ID",
  "FEISHU_APP_SECRET",
  "FEISHU_OWNER_OPEN_ID",
  "DEEPSEEK_API_KEY",
] as const;
async function main() {
  const dry = process.argv.includes("--dry-run");
  const check = process.argv.includes("--check-config");
  const missing = required.filter((k) => !process.env[k]?.trim());
  if (check) {
    console.log(
      JSON.stringify({
        ready: !missing.length,
        missing,
        proactive: process.env.GF_PROACTIVE_ENABLED === "true",
        database: process.env.GF_LIFE_DB ?? "runtime/life.db",
      }),
    );
    process.exitCode = missing.length ? 1 : 0;
    return;
  }
  if (!dry && missing.length)
    throw new Error(`Missing configuration names: ${missing.join(", ")}`);
  const owner = dry ? "ou_fixture" : process.env.FEISHU_OWNER_OPEN_ID!;
  if (!/^ou_[A-Za-z0-9_-]+$/.test(owner))
    throw new Error(
      "FEISHU_OWNER_OPEN_ID must be an application-scoped open_id",
    );
  const path = resolve(
    dry
      ? "runtime/life-dry-run.db"
      : (process.env.GF_LIFE_DB ?? "runtime/life.db"),
  );
  const db = connect(path);
  const unlock = await lockfile.lock(path, {
    stale: 120000,
    update: 10000,
    retries: 0,
    onCompromised: () => {
      console.error("[system] database ownership lost");
      process.exit(1);
    },
  });
  new MigrationRunner(db, "migrations").apply();
  const schemas = new SchemaRegistry("schemas");
  const state = new StateManager(() => connect(path), schemas);
  const at = new Date().toISOString();
  state.initializeLife(at);
  // Bind the database to this bot and owner. Restart cannot silently reroute history.
  state.bindLifeOwner(owner, dry ? "fixture" : process.env.FEISHU_APP_ID!);
  // This process holds the exclusive lock, so abandoned inference leases are safe to release.
  const leases = db
    .prepare(
      "SELECT reservation_id FROM cognitive_energy_reservations WHERE status='active'",
    )
    .all() as { reservation_id: string }[];
  for (const lease of leases)
    state.releaseCognitiveReservation(lease.reservation_id);
  if (dry) {
    const runtime = new LifeRuntime(
      db,
      state,
      createLifeFixture(schemas),
      owner,
      true,
    );
    let deliveries = 0;
    const outbox = new LifeOutboxWorker(state, {
      async send(_r, _t, key) {
        deliveries++;
        return `fixture:${key}`;
      },
    });
    for (let i = 0; i < 8; i++) {
      await runtime.cycle(at);
      await outbox.dispatch();
    }
    console.log(
      JSON.stringify({
        mode: "offline-fixture",
        realModel: false,
        feishuConnected: false,
        deliveries,
        world: state.lifeSnapshot()!.state.at,
        episodes: (
          db.prepare("SELECT count(*) n FROM life_episodes").get() as {
            n: number;
          }
        ).n,
      }),
    );
    db.close();
    await unlock();
    return;
  }
  const connection = createFeishuConnection(
    process.env.FEISHU_APP_ID!,
    process.env.FEISHU_APP_SECRET!,
    owner,
    state,
  );
  const runtime = new LifeRuntime(
    db,
    state,
    new DeepSeekLifeModel(process.env.DEEPSEEK_API_KEY!, schemas, state),
    owner,
    process.env.GF_PROACTIVE_ENABLED === "true",
  );
  const outbox = new LifeOutboxWorker(state, connection.transport);
  let stopping = false;
  let cycleWork = Promise.resolve();
  let deliveryWork = Promise.resolve();
  let cycleRunning = false;
  let deliveryRunning = false;
  const run = () => {
    if (cycleRunning || stopping) return;
    cycleRunning = true;
    cycleWork = runtime
      .cycle()
      .catch(() => {
        console.error("[system] life cycle failed; durable queue retained");
      })
      .finally(() => {
        cycleRunning = false;
      });
  };
  const deliver = () => {
    if (deliveryRunning || stopping) return;
    deliveryRunning = true;
    deliveryWork = outbox
      .dispatch()
      .then(() => {})
      .catch(() => {
        console.error("[system] delivery recovery pending");
      })
      .finally(() => {
        deliveryRunning = false;
      });
  };
  const timer = setInterval(run, 5000);
  const deliveryTimer = setInterval(deliver, 2000);
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    clearInterval(deliveryTimer);
    connection.close();
    await Promise.allSettled([cycleWork, deliveryWork]);
    db.close();
    await unlock();
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop());
  process.on("SIGINT", () => void stop());
  await connection.start();
  run();
  deliver();
  console.log(
    "[system] GF life service started; Feishu connection managed by official SDK.",
  );
}
main().catch((error) => {
  const safe =
    error instanceof Error &&
    error.message.startsWith("Missing configuration names:")
      ? error.message
      : "Startup failed; check configuration, database lock and platform connectivity.";
  console.error(safe);
  process.exit(1);
});
