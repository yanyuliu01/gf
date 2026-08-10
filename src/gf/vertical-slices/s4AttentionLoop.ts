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

/**
 * The semantic action remains open text. `execution` is only a low-level
 * capability request, not a finite semantic candidate supplied to Policy.
 */
export interface S4OpenAction {
  intent: string;
  execution: S4ExecutionRequest;
}

export interface S4ExecutionRequest {
  primitive: "observe";
  target: string;
  aspect: string;
}

export interface S4WorldState {
  currentActivity: string;
  pumpPressure: "normal" | "low";
  rootZoneMoisture: "normal" | "low";
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
          action: {
            intent: item.action.intent,
            execution: { ...item.action.execution },
          },
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
        // Minimal deterministic world consequence for this tracer bullet. This
        // remains hidden until the subject explicitly observes the root zone.
        this.world.rootZoneMoisture = "low";
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
    const request = action.execution;

    if (request.primitive !== "observe") {
      return this.unsupportedOutcome(outcomeEventId, action.intent, "unsupported primitive");
    }

    if (request.target !== "S-4") {
      return this.unsupportedOutcome(
        outcomeEventId,
        action.intent,
        `unknown target ${request.target}`,
      );
    }

    if (request.aspect === "irrigation-pressure") {
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

    if (request.aspect === "root-zone-moisture") {
      const text =
        this.world.rootZoneMoisture === "low"
          ? "检查后发现 S-4 根区含水明显偏低。"
          : "检查后没有发现 S-4 根区含水异常。";
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

    return this.unsupportedOutcome(
      outcomeEventId,
      action.intent,
      `unsupported observation aspect ${request.aspect}`,
    );
  }

  private unsupportedOutcome(
    outcomeEventId: string,
    intent: string,
    reason: string,
  ): S4Outcome {
    return {
      outcomeEventId,
      happened: `${intent}（执行未完成：${reason}）`,
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
