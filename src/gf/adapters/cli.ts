/**
 * CLI adapter: the most primitive IM surface for M1 debugging.
 */

import type { Adapter } from "../delivery/outbox.js";

export class CliAdapter implements Adapter {
  readonly connectorId = "cli:local";

  constructor(
    private readonly printer: (line: string) => void = (line) =>
      console.log(line),
    private readonly muted: () => boolean = () => false,
  ) {}

  paused(): boolean {
    return this.muted();
  }

  sendText(options: {
    channel: string;
    recipientPrincipalId: string;
    bubbles: string[];
    idempotencyKey: string;
  }): string {
    for (const bubble of options.bubbles) {
      this.printer(bubble);
    }
    return options.idempotencyKey;
  }
}
