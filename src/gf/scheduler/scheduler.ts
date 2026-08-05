/**
 * Minimal world scheduler for M1.
 *
 * World time is 1:1 with wall time. The scheduler emits a low-significance
 * `scheduled` event on phase transitions. The impulse pool is empty by default:
 * Day-0 seed assets have not been Owner-signed, so the runtime must not invent
 * character impulses.
 */

import type { DatabaseSync } from "node:sqlite";
import { newId, utcnowIso } from "../domain/ids.js";
import type { WorldEvent } from "../state/stateManager.js";

const PHASE_BOUNDARIES: [number, string][] = [
  [5, "dawn"],
  [8, "morning"],
  [12, "noon"],
  [14, "afternoon"],
  [18, "evening"],
  [21, "night"],
];

export function phaseForDate(date: Date): string {
  let current = "night";
  for (const [boundary, phase] of PHASE_BOUNDARIES) {
    if (date.getUTCHours() >= boundary) {
      current = phase;
    }
  }
  return current;
}

export function worldDayFor(date: Date): number {
  const epoch = Date.UTC(2026, 7, 5);
  const current = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  return Math.floor((current - epoch) / 86400000) + 1;
}

export class Scheduler {
  private lastPhase: string;
  private impulseIndex = 0;

  constructor(
    private readonly db: DatabaseSync,
    options: {
      now?: Date;
      impulsePool?: Record<string, unknown>[];
    } = {},
  ) {
    this.impulsePool = options.impulsePool ?? [];
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
    return phaseForDate(now ?? new Date());
  }

  nextEvent(now = new Date()): WorldEvent | null {
    const phase = phaseForDate(now);
    if (phase !== this.lastPhase) {
      this.lastPhase = phase;
      const nowIso = utcnowIso();
      return {
        schema_version: "1.0",
        event_id: newId("evt"),
        origin: "scheduled",
        kind: "world.phase",
        channel: null,
        occurred_at: nowIso,
        received_at: nowIso,
        world_day: worldDayFor(now),
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
      const nowIso = utcnowIso();
      return {
        schema_version: "1.0",
        event_id: newId("evt"),
        origin: "impulse",
        kind: "world.impulse",
        channel: null,
        occurred_at: nowIso,
        received_at: nowIso,
        world_day: null,
        world_phase: null,
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
