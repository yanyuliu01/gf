/**
 * Minimal world scheduler for M1.
 *
 * World time is 1:1 with wall time. The scheduler emits a low-significance
 * `scheduled` event on phase transitions. The impulse pool is empty by default:
 * Day-0 seed assets have not been Owner-signed, so the runtime must not invent
 * character impulses.
 */

import type { DatabaseSync } from "node:sqlite";
import { newId } from "../domain/ids.js";
import type { WorldEvent } from "../state/stateManager.js";
import {
  type Clock,
  type WorldTimeConfig,
  SystemClock,
  WorldClock,
} from "../world/clock.js";

export { phaseForDate, worldDayFor } from "../world/clock.js";

export class Scheduler {
  private lastPhase: string;
  private impulseIndex = 0;
  private readonly worldClock: WorldClock;

  constructor(
    private readonly db: DatabaseSync,
    options: {
      now?: Date;
      clock?: Clock;
      worldTime?: Partial<WorldTimeConfig>;
      impulsePool?: Record<string, unknown>[];
    } = {},
  ) {
    this.impulsePool = options.impulsePool ?? [];
    this.worldClock = new WorldClock(
      options.clock ?? new SystemClock(),
      options.worldTime,
    );
    this.lastPhase = this.loadLastPhase(options.now);
  }

  private impulsePool: Record<string, unknown>[];

  private loadLastPhase(now?: Date): string {
    const row = this.db
      .prepare(
        `
        SELECT payload_json FROM world_events
        WHERE kind = 'world.phase'
        ORDER BY occurred_at DESC, event_id DESC
        LIMIT 1
        `,
      )
      .get() as { payload_json: string } | undefined;
    if (row) {
      try {
        const phase = (JSON.parse(row.payload_json) as { phase?: string }).phase;
        if (phase) {
          return phase;
        }
      } catch {
        // fall through
      }
    }
    return (now ? this.worldClock.at(now) : this.worldClock.now()).phase;
  }

  nextEvent(now?: Date): WorldEvent | null {
    const worldTime = now ? this.worldClock.at(now) : this.worldClock.now();
    const phase = worldTime.phase;
    if (phase !== this.lastPhase) {
      this.lastPhase = phase;
      const nowIso = worldTime.instant.toISOString();
      return {
        schema_version: "1.0",
        event_id: newId("evt"),
        origin: "scheduled",
        kind: "world.phase",
        channel: null,
        occurred_at: nowIso,
        received_at: nowIso,
        world_day: worldTime.worldDay,
        world_phase: phase,
        provenance: {
          principal_id: "world",
          connector_id: null,
          trust: "verified",
        },
        privacy_scope: "internal",
        causation_event_id: null,
        correlation_id: null,
        idempotency_key: newId("sched"),
        payload: { phase },
      };
    }
    if (this.impulseIndex < this.impulsePool.length) {
      const item = this.impulsePool[this.impulseIndex++];
      const nowIso = worldTime.instant.toISOString();
      return {
        schema_version: "1.0",
        event_id: newId("evt"),
        origin: "impulse",
        kind: "world.impulse",
        channel: null,
        occurred_at: nowIso,
        received_at: nowIso,
        world_day: worldTime.worldDay,
        world_phase: worldTime.phase,
        provenance: {
          principal_id: "world",
          connector_id: null,
          trust: "generated",
        },
        privacy_scope: "internal",
        causation_event_id: null,
        correlation_id: null,
        idempotency_key: newId("imp"),
        payload: item,
      };
    }
    return null;
  }
}
