/**
 * Outbox delivery worker.
 *
 * Only committed outbox rows are dispatched. Delivery is idempotent through the
 * `deliveries` unique (connector_id, provider_message_id) constraint: a crash
 * between send and receipt leaves the row in `pending`/`retry` and the next
 * dispatch either dedupes on the provider side or records the receipt.
 */

import type { DatabaseSync } from "node:sqlite";
import { newId, utcnowIso } from "../domain/ids.js";
import { Metrics } from "../observability/metrics.js";

export interface Adapter {
  connectorId: string;
  sendText(options: {
    channel: string;
    recipientPrincipalId: string;
    bubbles: string[];
    idempotencyKey: string;
  }): string;
  paused?(): boolean;
}

export class OutboxWorker {
  constructor(
    private readonly connFactory: () => DatabaseSync,
    private readonly adapter: Adapter,
    private readonly metrics: Metrics = new Metrics(),
  ) {}

  dispatchPending(): string[] {
    if (this.adapter.paused?.()) {
      return [];
    }
    const delivered: string[] = [];
    const db = this.connFactory();
    try {
      const rows = db
        .prepare(
          `
          SELECT * FROM outbox
          WHERE status IN ('pending', 'retry')
          ORDER BY created_at, outbox_id
          `,
        )
        .all() as {
        outbox_id: string;
        idempotency_key: string;
        channel: string;
        recipient_principal_id: string;
        payload_json: string;
      }[];
      const markSending = db.prepare(
        "UPDATE outbox SET status = 'sending' WHERE outbox_id = ?",
      );
      const insertDelivery = db.prepare(
        `
        INSERT INTO deliveries(
          delivery_id, outbox_id, connector_id, provider_message_id,
          status, response_json, observed_at
        ) VALUES (?, ?, ?, ?, 'delivered', NULL, ?)
        `,
      );
      const markSent = db.prepare(
        "UPDATE outbox SET status = 'sent', sent_at = ?, attempts = attempts + 1 WHERE outbox_id = ?",
      );
      const markRetry = db.prepare(
        "UPDATE outbox SET status = 'retry', attempts = attempts + 1, last_error = ? WHERE outbox_id = ?",
      );
      const existingDelivery = db.prepare(
        "SELECT delivery_id FROM deliveries WHERE outbox_id = ? LIMIT 1",
      );
      for (const row of rows) {
        markSending.run(row.outbox_id);
        const alreadyDelivered = existingDelivery.get(row.outbox_id);
        if (alreadyDelivered) {
          // Crash between send and receipt: the delivery was recorded, so we
          // mark sent without calling the adapter again (no duplicate speech).
          markSent.run(utcnowIso(), row.outbox_id);
          delivered.push(row.outbox_id);
          this.metrics.incr("outbox_recovered");
          continue;
        }
        try {
          const payload = JSON.parse(row.payload_json) as { bubbles?: string[] };
          const providerMessageId = this.adapter.sendText({
            channel: row.channel,
            recipientPrincipalId: row.recipient_principal_id,
            bubbles: payload.bubbles ?? [],
            idempotencyKey: row.idempotency_key,
          });
          insertDelivery.run(
            newId("dlv"),
            row.outbox_id,
            this.adapter.connectorId,
            providerMessageId,
            utcnowIso(),
          );
          markSent.run(utcnowIso(), row.outbox_id);
          delivered.push(row.outbox_id);
          this.metrics.incr("outbox_sent");
        } catch (error) {
          markRetry.run(String(error).slice(0, 500), row.outbox_id);
          this.metrics.incr("outbox_failed");
        }
      }
      return delivered;
    } finally {
      db.close();
    }
  }
}
