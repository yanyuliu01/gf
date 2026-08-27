import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Scheduler } from "../scheduler/scheduler.js";
import { connect } from "../state/db.js";
import { MigrationRunner } from "../state/migrator.js";
import {
  type Clock,
  WorldClock,
  phaseForDate,
  worldDayFor,
} from "../world/clock.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

class MutableClock implements Clock {
  constructor(private instant: Date) {}

  set(instant: Date): void {
    this.instant = instant;
  }

  now(): Date {
    return new Date(this.instant.getTime());
  }
}

test("the same instant crosses the configured UTC/Shanghai day boundary", () => {
  const instant = new Date("2026-08-05T16:30:00.000Z");
  const utc = new WorldClock(new MutableClock(instant), {
    timeZone: "UTC",
    epochDate: "2026-08-05",
  }).now();
  const shanghai = new WorldClock(new MutableClock(instant), {
    timeZone: "Asia/Shanghai",
    epochDate: "2026-08-05",
  }).now();

  assert.deepEqual(
    {
      localDate: utc.localDate,
      localHour: utc.localHour,
      worldDay: utc.worldDay,
      phase: utc.phase,
    },
    {
      localDate: "2026-08-05",
      localHour: 16,
      worldDay: 1,
      phase: "afternoon",
    },
  );
  assert.deepEqual(
    {
      localDate: shanghai.localDate,
      localHour: shanghai.localHour,
      worldDay: shanghai.worldDay,
      phase: shanghai.phase,
    },
    {
      localDate: "2026-08-06",
      localHour: 0,
      worldDay: 2,
      phase: "night",
    },
  );
});

test("phase helpers honor the configured zone at the dawn boundary", () => {
  const instant = new Date("2026-08-05T21:00:00.000Z");

  assert.equal(phaseForDate(instant, "UTC"), "night");
  assert.equal(phaseForDate(instant, "Asia/Shanghai"), "dawn");
  assert.equal(worldDayFor(instant, "UTC", "2026-08-05"), 1);
  assert.equal(worldDayFor(instant, "Asia/Shanghai", "2026-08-05"), 2);
});

test("scheduler timestamps and world coordinates use one injected clock", () => {
  const dir = mkdtempSync(join(tmpdir(), "gf-world-clock-"));
  const dbPath = join(dir, "gf.db");
  const db = connect(dbPath);
  try {
    new MigrationRunner(db, join(ROOT, "migrations")).apply();
    const clock = new MutableClock(new Date("2026-08-05T20:59:00.000Z"));
    const scheduler = new Scheduler(db, {
      clock,
      worldTime: {
        timeZone: "Asia/Shanghai",
        epochDate: "2026-08-05",
      },
    });

    clock.set(new Date("2026-08-05T21:00:00.000Z"));
    const event = scheduler.nextEvent();

    assert.ok(event);
    assert.equal(event.kind, "world.phase");
    assert.equal(event.occurred_at, "2026-08-05T21:00:00.000Z");
    assert.equal(event.received_at, event.occurred_at);
    assert.equal(event.world_day, 2);
    assert.equal(event.world_phase, "dawn");
    assert.deepEqual(event.payload, { phase: "dawn" });
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("invalid world time configuration fails at startup", () => {
  assert.throws(
    () =>
      new WorldClock(new MutableClock(new Date()), {
        timeZone: "Mars/Olympus_Mons",
      }),
    /invalid IANA world time zone/,
  );
  assert.throws(
    () =>
      new WorldClock(new MutableClock(new Date()), {
        epochDate: "2026-02-30",
      }),
    /invalid world epoch date/,
  );
});
