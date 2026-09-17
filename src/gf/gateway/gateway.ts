/**
 * Gateway: single-user whitelist, debounce aggregation, meta commands.
 *
 * Meta commands (leading `/`) never enter the WorldEvent ledger. Ordinary
 * messages are buffered into a debounce window and flushed as one `user`
 * WorldEvent; the payload keeps the ordered content parts.
 *
 * Debounce behavior: Lines within the debounce window are aggregated. A
 * flush occurs when (a) the window expires, checked via `checkFlush()` or
 * the next `handleLine()`, or (b) a meta command arrives, or (c) `flush()`
 * is called explicitly. Single-line messages flush after the timeout.
 */

import { newId, utcnowIso } from "../domain/ids.js";
import type { WorldEvent } from "../state/stateManager.js";

export interface GatewayResult {
  events: WorldEvent[];
  meta?: { name: string; args: string[] };
  dropped: boolean;
  flushDueInMs?: number;
}

interface BufferedLine {
  text: string;
  at: string;
}

const META_COMMANDS = new Set([
  "status",
  "world",
  "budget",
  "mute",
  "snapshot",
  "exit",
]);

export class Gateway {
  private buffer: BufferedLine[] = [];
  private firstMessageId: string | null = null;
  private lastLineAt: number | null = null;

  constructor(
    private readonly options: {
      whitelist?: Set<string>;
      debounceSeconds?: number;
      principal?: string;
      connector?: string;
      now?: () => Date;
    } = {},
  ) {
    this.whitelist = options.whitelist ?? new Set(["doctor"]);
    this.debounceSeconds = options.debounceSeconds ?? 10;
    this.principal = options.principal ?? "doctor";
    this.connector = options.connector ?? "cli:local";
    this.now = options.now ?? (() => new Date());
  }

  private readonly whitelist: Set<string>;
  private readonly debounceSeconds: number;
  private readonly principal: string;
  private readonly connector: string;
  private readonly now: () => Date;

  handleLine(line: string, principal?: string): GatewayResult {
    const trimmed = line.trim();
    if (!trimmed) {
      return { events: [], dropped: false };
    }
    const sender = principal ?? this.principal;
    if (!this.whitelist.has(sender)) {
      return { events: [], dropped: true };
    }
    if (trimmed.startsWith("/")) {
      const [name, ...args] = trimmed.slice(1).split(/\s+/);
      if (META_COMMANDS.has(name)) {
        const flushed = this.flush();
        return { events: flushed, meta: { name, args }, dropped: false };
      }
      return { events: [], meta: { name, args }, dropped: true };
    }

    if (this.debounceSeconds <= 0) {
      this.buffer.push({ text: trimmed, at: utcnowIso() });
      if (this.firstMessageId === null) {
        this.firstMessageId = newId("msg");
      }
      return { events: this.flush(), dropped: false };
    }

    const nowMs = this.now().getTime();
    const windowMs = this.debounceSeconds * 1000;

    if (
      this.lastLineAt !== null &&
      nowMs - this.lastLineAt >= windowMs
    ) {
      const flushed = this.flush();
      this.buffer.push({ text: trimmed, at: utcnowIso() });
      this.firstMessageId = newId("msg");
      this.lastLineAt = nowMs;
      return { events: flushed, dropped: false, flushDueInMs: windowMs };
    }

    this.buffer.push({ text: trimmed, at: utcnowIso() });
    if (this.firstMessageId === null) {
      this.firstMessageId = newId("msg");
    }
    this.lastLineAt = nowMs;

    const elapsed = this.lastLineAt !== null ? nowMs - this.lastLineAt : 0;
    const remaining = Math.max(0, windowMs - elapsed);
    return { events: [], dropped: false, flushDueInMs: remaining };
  }

  checkFlush(): WorldEvent[] {
    if (this.buffer.length === 0 || this.lastLineAt === null) {
      return [];
    }
    const nowMs = this.now().getTime();
    const elapsed = nowMs - this.lastLineAt;
    if (elapsed >= this.debounceSeconds * 1000) {
      return this.flush();
    }
    return [];
  }

  msUntilFlush(): number | null {
    if (this.buffer.length === 0 || this.lastLineAt === null) {
      return null;
    }
    const nowMs = this.now().getTime();
    const elapsed = nowMs - this.lastLineAt;
    const remaining = this.debounceSeconds * 1000 - elapsed;
    return remaining > 0 ? remaining : 0;
  }

  flush(): WorldEvent[] {
    if (this.buffer.length === 0) {
      return [];
    }
    const nowIso = utcnowIso();
    const messageId = this.firstMessageId ?? newId("msg");
    const content = this.buffer.map((line) => ({
      type: "text",
      text: line.text,
    }));
    this.buffer = [];
    this.firstMessageId = null;
    this.lastLineAt = null;
    const event: WorldEvent = {
      schema_version: "1.0",
      event_id: newId("evt"),
      origin: "user",
      kind: "im.message.received",
      channel: "private_im",
      occurred_at: nowIso,
      received_at: nowIso,
      world_day: null,
      world_phase: null,
      provenance: {
        principal_id: this.principal,
        connector_id: this.connector,
        trust: "authenticated",
      },
      privacy_scope: "private_im",
      causation_event_id: null,
      correlation_id: null,
      idempotency_key: newId("usr"),
      payload: {
        message_id: messageId,
        sender_principal_id: this.principal,
        content,
      },
    };
    return [event];
  }
}
