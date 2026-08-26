import type {
  AgentWorld,
  WorldActionProposal,
  WorldActionResolution,
  WorldActorId,
  WorldAdvanceRequest,
  WorldAdvanceResult,
  WorldObservationBatch,
} from "./contract.js";

interface BridgeOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

/**
 * Thin HTTP bridge to a Python Concordia sidecar.
 *
 * The sidecar is deliberately world-only: it must not own GF memory, affect,
 * beliefs, character prompt, Working Self or wake policy.
 */
export class ConcordiaWorldBridge implements AgentWorld {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: BridgeOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  observe(actorId: WorldActorId, afterCursor?: string): Promise<WorldObservationBatch> {
    return this.post<WorldObservationBatch>("/v1/observe", {
      actorId,
      afterCursor: afterCursor ?? null,
    });
  }

  resolve(proposal: WorldActionProposal): Promise<WorldActionResolution> {
    return this.post<WorldActionResolution>("/v1/resolve", proposal);
  }

  advance(request: WorldAdvanceRequest): Promise<WorldAdvanceResult> {
    return this.post<WorldAdvanceResult>("/v1/advance", request);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await this.fetchImpl(
      `${this.options.baseUrl.replace(/\/$/, "")}${path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      throw new Error(`Concordia world bridge failed (${response.status}): ${await response.text()}`);
    }

    return (await response.json()) as T;
  }
}
