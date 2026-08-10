/**
 * VS01 — S-4 subjective cognition tracer bullet.
 *
 * This is intentionally narrow. It proves two product/architecture properties:
 * 1. world truth and subject context are separate;
 * 2. once cognition starts, the agent decides when to yield back to the world.
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

export interface S4EpisodeStep {
  action: S4OpenAction;
  outcome: S4Outcome;
}

export interface S4PolicyInput {
  currentActivity: string;
  attention: S4Attention;
  observations: S4Observation[];
  episodeHistory: S4EpisodeStep[];
}

/**
 * The only external-model seam in VS01.
 *
 * Implement this interface with your API client. The runtime guarantees that
 * `input` contains subject-legal context only; do not pass raw world state to
 * the provider adapter.
 *
 * Returning `yield` is the agent's decision that this cognitive episode has
 * enough information for now. Runtime limits remain a hard safety/resource
 * guardrail, not a semantic decision-maker.
 */
export interface S4PolicyClient {
  decide(input: S4PolicyInput): Promise<S4PolicyDecision>;
}

export type S4PolicyDecision =
  | {
      kind: "act";
      action: S4OpenAction;
    }
  | {
      kind: "yield";
      reason: string;
    };

export type S4OpenAction = {
  kind: "inspect";
  target: "S-4";
  focus: "irrigation" | "root-zone";
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

export type S4EpisodeEnd =
  | {
      kind: "agent_yield";
      reason: string;
    }
  | {
      kind: "runtime_step_limit";
    };

export type S4LoopResult =
  | {
      kind: "ignored";
      reason: "not_perceived" | "attention_expired" | "not_attention_relevant";
    }
  | {
      kind: "cognitive";
      observation: S4Observation;
      episodeHistory: S4EpisodeStep[];
      end: S4EpisodeEnd;
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
  private readonly maxEpisodeSteps: number;

  constructor(options: {
    policy: S4PolicyClient;
    initialWorld: S4WorldState;
    attention: S4Attention;
    maxEpisodeSteps?: number;
  }) {
    this.policy = options.policy;
    this.attention = { ...options.attention };
    this.world = { ...options.initialWorld };
    this.maxEpisodeSteps = options.maxEpisodeSteps ?? 4;
  }

  async process(event: S4WorldEvent): Promise<S4LoopResult> {
    this.applyWorldEvent(event);

    // World truth changes first. Perception is a separate projection; hidden
    // events stop here and never become policy input.
    if (event.visibility !== "observable") {
      return { kind: "ignored", reason: "not_perceived" };
    }

    if (
      new Date(event.occurredAt).getTime() >
      new Date(this.attention.expiresAt).getTime()
    ) {
      return { kind: "ignored", reason: "attention_expired" };
    }

    const initialObservation = this.projectPerception(event);
    if (!initialObservation) {
      return { kind: "ignored", reason: "not_attention_relevant" };
    }

    const observations: S4Observation[] = [initialObservation];
    const episodeHistory: S4EpisodeStep[] = [];

    for (let step = 0; step < this.maxEpisodeSteps; step += 1) {
      const decision = await this.policy.decide({
        currentActivity: this.world.currentActivity,
        attention: { ...this.attention },
        observations: observations.map((item) => ({ ...item })),
        episodeHistory: episodeHistory.map((item) => ({
          action: { ...item.action },
          outcome: {
            ...item.outcome,
            newObservations: item.outcome.newObservations.map((obs) => ({ ...obs })),
          },
        })),
      });

      if (decision.kind === "yield") {
        return {
          kind: "cognitive",
          observation: initialObservation,
          episodeHistory,
          end: { kind: "agent_yield", reason: decision.reason },
        };
      }

      const outcome = this.adjudicate(decision.action, event.occurredAt, step);
      episodeHistory.push({ action: decision.action, outcome });
      observations.push(...outcome.newObservations);
    }

    return {
      kind: "cognitive",
      observation: initialObservation,
      episodeHistory,
      end: { kind: "runtime_step_limit" },
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

  private adjudicate(
    action: S4OpenAction,
    occurredAt: string,
    step: number,
  ): S4Outcome {
    const outcomeEventId = `outcome_${occurredAt.replace(/[^0-9]/g, "")}_${step}`;

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
  async decide(_input: S4PolicyInput): Promise<S4PolicyDecision> {
    throw new Error(
      "S4PolicyClient is not configured. Inject your API implementation here.",
    );
  }
}
