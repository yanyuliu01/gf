/**
 * VS01 — S-4 subjective cognition tracer bullet.
 *
 * This is intentionally narrow. It proves one product/architecture property:
 * world truth and subject context are separate, and a hidden fact cannot reach
 * cognition until it becomes legally observable through perception/action.
 *
 * It is not the final M2 CognitiveGate, AttentionCompiler, memory system, or
 * world model. Keep the interface small until the slice teaches us where the
 * real seams belong.
 */

export interface S4Attention {
  subject: "S-4";
  reason: string;
  expiresAt: string;
}

export interface S4Observation {
  sourceEventId: string;
  observedAt: string;
  text: string;
}

export interface S4PolicyInput {
  currentActivity: string;
  attention: S4Attention;
  observations: S4Observation[];
}

/**
 * The only external-model seam in VS01.
 *
 * Implement this interface with your API client. The runtime guarantees that
 * `input` contains subject-legal context only; do not pass raw world state to
 * the provider adapter.
 */
export interface S4PolicyClient {
  decide(input: S4PolicyInput): Promise<S4OpenAction>;
}

export type S4OpenAction =
  | {
      kind: "inspect";
      target: "S-4";
      focus: "irrigation" | "root-zone";
      intent: string;
    }
  | {
      kind: "wait";
      target: "S-4";
      intent: string;
    };

export interface S4WorldState {
  currentActivity: string;
  pumpPressure: "normal" | "low";
  s4Wilted: boolean;
}

export type S4WorldEvent = {
  eventId: string;
  occurredAt: string;
  kind: "pump_pressure_low" | "s4_wilted";
  visibility: "hidden" | "observable";
};

export type S4LoopResult =
  | {
      kind: "ignored";
      reason: "not_perceived" | "attention_expired" | "not_attention_relevant";
    }
  | {
      kind: "cognitive";
      observation: S4Observation;
      action: S4OpenAction;
      outcome: S4Outcome;
    };

export interface S4Outcome {
  outcomeEventId: string;
  happened: string;
  newObservations: S4Observation[];
}

export class S4AttentionLoop {
  private readonly policy: S4PolicyClient;
  private readonly attention: S4Attention;
  private readonly world: S4WorldState;

  constructor(options: {
    policy: S4PolicyClient;
    initialWorld: S4WorldState;
    attention: S4Attention;
  }) {
    this.policy = options.policy;
    this.attention = { ...options.attention };
    this.world = { ...options.initialWorld };
  }

  async process(event: S4WorldEvent): Promise<S4LoopResult> {
    this.applyWorldEvent(event);

    // World truth changes first. Perception is a separate projection; hidden
    // events stop here and never become policy input.
    if (event.visibility !== "observable") {
      return { kind: "ignored", reason: "not_perceived" };
    }

    if (new Date(event.occurredAt).getTime() > new Date(this.attention.expiresAt).getTime()) {
      return { kind: "ignored", reason: "attention_expired" };
    }

    const observation = this.projectPerception(event);
    if (!observation) {
      return { kind: "ignored", reason: "not_attention_relevant" };
    }

    const input: S4PolicyInput = {
      currentActivity: this.world.currentActivity,
      attention: { ...this.attention },
      observations: [observation],
    };

    const action = await this.policy.decide(input);
    const outcome = this.adjudicate(action, event.occurredAt);

    return {
      kind: "cognitive",
      observation,
      action,
      outcome,
    };
  }

  private applyWorldEvent(event: S4WorldEvent): void {
    switch (event.kind) {
      case "pump_pressure_low":
        this.world.pumpPressure = "low";
        return;
      case "s4_wilted":
        this.world.s4Wilted = true;
        return;
    }
  }

  private projectPerception(event: S4WorldEvent): S4Observation | null {
    if (event.kind !== "s4_wilted" || !this.world.s4Wilted) {
      return null;
    }
    return {
      sourceEventId: event.eventId,
      observedAt: event.occurredAt,
      text: "S-4 出现持续萎蔫。",
    };
  }

  private adjudicate(action: S4OpenAction, occurredAt: string): S4Outcome {
    const outcomeEventId = `outcome_${occurredAt.replace(/[^0-9]/g, "")}`;

    if (action.kind === "wait") {
      return {
        outcomeEventId,
        happened: "她决定暂时继续观察 S-4。",
        newObservations: [],
      };
    }

    if (action.target === "S-4" && action.focus === "irrigation") {
      const text =
        this.world.pumpPressure === "low"
          ? "检查后发现 S-4 所在区域的灌溉压力偏低。"
          : "检查后没有发现 S-4 所在区域的灌溉压力异常。";
      return {
        outcomeEventId,
        happened: action.intent,
        newObservations: [
          {
            sourceEventId: outcomeEventId,
            observedAt: occurredAt,
            text,
          },
        ],
      };
    }

    return {
      outcomeEventId,
      happened: "当前最小世界还不能执行这个检查。",
      newObservations: [],
    };
  }
}

/**
 * Default placeholder for local/manual runs. Replace by injecting your own
 * `S4PolicyClient`; no provider, model name, key format, or HTTP contract is
 * assumed by this slice.
 */
export class UnconfiguredS4PolicyClient implements S4PolicyClient {
  async decide(_input: S4PolicyInput): Promise<S4OpenAction> {
    throw new Error(
      "S4PolicyClient is not configured. Inject your API implementation here.",
    );
  }
}
