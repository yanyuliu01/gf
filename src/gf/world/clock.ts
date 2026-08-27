/**
 * World-time projection over an injectable wall-clock source.
 *
 * Instants remain UTC. Calendar date, day number, and phase are derived in the
 * configured IANA time zone so the scheduler and future world adapters share
 * one deterministic time boundary.
 */

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export type WorldPhase =
  | "dawn"
  | "morning"
  | "noon"
  | "afternoon"
  | "evening"
  | "night";

export interface WorldTimeConfig {
  timeZone: string;
  epochDate: string;
}

export interface WorldTimeSnapshot {
  instant: Date;
  timeZone: string;
  localDate: string;
  localHour: number;
  localMinute: number;
  worldDay: number;
  phase: WorldPhase;
}

export const DEFAULT_WORLD_TIME_CONFIG: Readonly<WorldTimeConfig> = {
  timeZone: "Asia/Shanghai",
  epochDate: "2026-08-05",
};

const PHASE_BOUNDARIES: readonly [number, WorldPhase][] = [
  [5, "dawn"],
  [8, "morning"],
  [12, "noon"],
  [14, "afternoon"],
  [18, "evening"],
  [21, "night"],
];

interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export class WorldClock {
  readonly config: Readonly<WorldTimeConfig>;
  private readonly formatter: Intl.DateTimeFormat;
  private readonly epochOrdinal: number;

  constructor(
    private readonly clock: Clock = new SystemClock(),
    config: Partial<WorldTimeConfig> = {},
  ) {
    this.config = {
      ...DEFAULT_WORLD_TIME_CONFIG,
      ...config,
    };
    this.epochOrdinal = localDateOrdinal(this.config.epochDate);
    try {
      this.formatter = makeFormatter(this.config.timeZone);
    } catch (error) {
      throw new Error(
        `invalid IANA world time zone ${this.config.timeZone}: ${String(error)}`,
      );
    }
  }

  now(): WorldTimeSnapshot {
    return this.at(this.clock.now());
  }

  at(instant: Date): WorldTimeSnapshot {
    if (Number.isNaN(instant.getTime())) {
      throw new Error("invalid world-clock instant");
    }
    const stableInstant = new Date(instant.getTime());
    const local = localDateTime(stableInstant, this.formatter);
    const localDate = formatLocalDate(local);
    return {
      instant: stableInstant,
      timeZone: this.config.timeZone,
      localDate,
      localHour: local.hour,
      localMinute: local.minute,
      worldDay: Math.max(
        1,
        localDateOrdinal(localDate) - this.epochOrdinal + 1,
      ),
      phase: phaseForHour(local.hour),
    };
  }
}

export function phaseForDate(date: Date, timeZone: string): WorldPhase {
  const formatter = makeFormatter(timeZone);
  return phaseForHour(localDateTime(date, formatter).hour);
}

export function worldDayFor(
  date: Date,
  timeZone: string,
  epochDate = DEFAULT_WORLD_TIME_CONFIG.epochDate,
): number {
  const formatter = makeFormatter(timeZone);
  const local = localDateTime(date, formatter);
  return Math.max(
    1,
    localDateOrdinal(formatLocalDate(local)) - localDateOrdinal(epochDate) + 1,
  );
}

export function phaseForHour(hour: number): WorldPhase {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error(`invalid local world hour ${hour}`);
  }
  let current: WorldPhase = "night";
  for (const [boundary, phase] of PHASE_BOUNDARIES) {
    if (hour >= boundary) {
      current = phase;
    }
  }
  return current;
}

function makeFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function localDateTime(
  instant: Date,
  formatter: Intl.DateTimeFormat,
): LocalDateTime {
  if (Number.isNaN(instant.getTime())) {
    throw new Error("invalid world-clock instant");
  }
  const values = new Map(
    formatter
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const local = {
    year: values.get("year"),
    month: values.get("month"),
    day: values.get("day"),
    hour: values.get("hour"),
    minute: values.get("minute"),
  };
  if (Object.values(local).some((value) => value === undefined)) {
    throw new Error("world-clock formatter omitted a required date part");
  }
  return local as LocalDateTime;
}

function formatLocalDate(local: LocalDateTime): string {
  return [
    String(local.year).padStart(4, "0"),
    String(local.month).padStart(2, "0"),
    String(local.day).padStart(2, "0"),
  ].join("-");
}

function localDateOrdinal(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`invalid world epoch date ${value}; expected YYYY-MM-DD`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const instant = new Date(Date.UTC(year, month - 1, day));
  if (
    instant.getUTCFullYear() !== year ||
    instant.getUTCMonth() !== month - 1 ||
    instant.getUTCDate() !== day
  ) {
    throw new Error(`invalid world epoch date ${value}`);
  }
  return Math.floor(instant.getTime() / 86400000);
}
