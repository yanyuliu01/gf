/**
 * Single event queue derived from the append-only ledger.
 *
 * User events are prioritized; all other events follow arrival order. The
 * queue state is derivable (no extra tables): an event is pending until a tick
 * operation references it or its message is appended to a scene.
 */

import { EventStore } from "../state/repositories.js";

export class EventQueue {
  constructor(private readonly store: EventStore) {}

  nextEventId(): string | null {
    const pending = this.store.pendingEventIds();
    return pending[0] ?? null;
  }

  pendingIds(): string[] {
    return this.store.pendingEventIds();
  }

  pendingCount(): number {
    return this.store.pendingEventIds().length;
  }
}
