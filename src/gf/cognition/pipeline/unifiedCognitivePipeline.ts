/**
 * Unified Cognitive Pipeline (M20-025).
 *
 * Routes both user and non-user events through the same:
 *   Cognitive Admission -> Working Self -> Open Policy -> Action Compiler
 *   -> World Adjudicator -> Social Outcome -> StateManager commit
 *
 * Preserves the existing user-message response contract via low-latency
 * surface rendering for communication intents.
 *
 * Key invariants:
 * - Single personality and decision system for all event types
 * - User messages get priority queue lane but same cognitive path
 * - Communication intents create speech via SurfaceMessage/outbox
 * - World actions commit via submitWorldOutcome
 * - Affect mode (off/shadow/active) does not change admission or policy input
 */

import type { SourceRef, WorkingSelfV1, WorldOutcomeProposalV1 } from "../../generated/agentPipelineTypes.js";
import type {
  WakeCandidateV1,
  WakeDecisionV1,
  ActionCompilationResultV1,
} from "../../generated/cognitiveRuntimeTypes.js";
import type { WorldEvent, StateManager, SurfaceMessage } from "../../state/stateManager.js";
import type { OpenPolicyPort, WorkingSelfBuilderPort } from "../ports.js";
import type { WorkingSelfBuildInput } from "../workingSelf/workingSelfBuilder.js";
import type { AsyncActionCompilerPort } from "../../world/actionPorts.js";
import type { AdjudicationContext, WorldAdjudicator } from "../../world/worldAdjudicator.js";
import type { SocialOutcomeProposer, SocialContext, EnrichedOutcomeProposal } from "../../world/socialOutcome.js";
import type { OpenPolicyResultV1 } from "../policy/openGenerativePolicy.js";
import { newId, utcnowIso } from "../../domain/ids.js";

export type PipelineEventOrigin = "user" | "world" | "scheduled" | "internal";

export interface PipelineEvent {
  eventId: string;
  origin: PipelineEventOrigin;
  kind: string;
  occurredAt: string;
  sourceRefs: SourceRef[];
  payload: unknown;
}

export interface AdmissionResult {
  candidate: WakeCandidateV1 | null;
  decision: WakeDecisionV1 | null;
}

export interface PipelineResult {
  eventId: string;
  origin: PipelineEventOrigin;
  admission: AdmissionResult;
  woke: boolean;
  policyResult?: OpenPolicyResultV1;
  compilation?: ActionCompilationResultV1;
  hardOutcome?: WorldOutcomeProposalV1;
  enrichedOutcome?: EnrichedOutcomeProposal;
  committed: boolean;
  speechIds: string[];
  outboxIds: string[];
  error?: string;
}

export interface CognitivePipelineConfig {
  actorId: string;
  pipelineVersion: string;
  enableSpeechOutput: boolean;
  speechChannel: string;
}

export interface ActionCompilerAdapter {
  compile(input: ActionCompilationInput): Promise<ActionCompilationResultV1>;
}

export interface ActionCompilationInput {
  intent: string;
  plan?: readonly string[];
  actorId: string;
  sourceRefs: readonly SourceRef[];
  baseStateRevision: number;
}

export interface WorldAdjudicatorAdapter {
  adjudicate(
    compilation: Readonly<ActionCompilationResultV1>,
    context: Readonly<AdjudicationContext>,
  ): Promise<Readonly<WorldOutcomeProposalV1>>;
}

export interface CognitivePipelineDependencies {
  stateManager: StateManager;
  workingSelfBuilder: WorkingSelfBuilderPort<WorkingSelfBuildInput, WorkingSelfV1>;
  openPolicy: OpenPolicyPort<WorkingSelfV1, OpenPolicyResultV1>;
  actionCompiler: ActionCompilerAdapter;
  worldAdjudicator: WorldAdjudicatorAdapter;
  socialProposer: SocialOutcomeProposer;
}

export interface AdmissionAdapter {
  evaluate(event: PipelineEvent, baseRevision: number): AdmissionResult;
}

export interface WorkingSelfInputAdapter {
  prepare(
    event: PipelineEvent,
    decision: WakeDecisionV1,
    baseRevision: number,
  ): WorkingSelfBuildInput;
}

export interface AdjudicationContextAdapter {
  prepare(
    event: PipelineEvent,
    compilation: ActionCompilationResultV1,
    baseRevision: number,
  ): AdjudicationContext;
}

export interface SocialContextAdapter {
  prepare(
    event: PipelineEvent,
    hardOutcome: WorldOutcomeProposalV1,
  ): SocialContext;
}

export interface SpeechRenderer {
  render(
    policyResult: OpenPolicyResultV1,
    event: PipelineEvent,
    config: CognitivePipelineConfig,
  ): SurfaceMessage | null;
}

/**
 * Unified pipeline for both user and world events.
 *
 * The same cognitive path is used regardless of event origin:
 * 1. Admission decides wake/accumulate/ignore
 * 2. If wake, Working Self is built
 * 3. Open Policy proposes action
 * 4. Action is compiled to primitives
 * 5. Hard adjudication checks constraints
 * 6. Social outcomes are added
 * 7. Result is committed via submitWorldOutcome
 * 8. If communication intent, speech is created
 */
export class UnifiedCognitivePipeline {
  constructor(
    private readonly config: CognitivePipelineConfig,
    private readonly deps: CognitivePipelineDependencies,
    private readonly admissionAdapter: AdmissionAdapter,
    private readonly workingSelfAdapter: WorkingSelfInputAdapter,
    private readonly adjudicationAdapter: AdjudicationContextAdapter,
    private readonly socialAdapter: SocialContextAdapter,
    private readonly speechRenderer: SpeechRenderer,
  ) {}

  async process(event: PipelineEvent): Promise<PipelineResult> {
    const baseRevision = this.getBaseRevision();

    const admission = this.admissionAdapter.evaluate(event, baseRevision);

    if (!admission.decision || admission.decision.disposition !== "wake") {
      return {
        eventId: event.eventId,
        origin: event.origin,
        admission,
        woke: false,
        committed: false,
        speechIds: [],
        outboxIds: [],
      };
    }

    try {
      const workingSelfInput = this.workingSelfAdapter.prepare(
        event,
        admission.decision,
        baseRevision,
      );

      const workingSelf = this.deps.workingSelfBuilder.build(workingSelfInput);

      const policyResult = await this.deps.openPolicy.propose(workingSelf);

      const compilationInput: ActionCompilationInput = {
        intent: policyResult.action.intent,
        plan: policyResult.action.plan,
        actorId: this.config.actorId,
        sourceRefs: policyResult.action.source_refs,
        baseStateRevision: baseRevision,
      };
      const compilation = await this.deps.actionCompiler.compile(compilationInput);

      const adjudicationContext = this.adjudicationAdapter.prepare(
        event,
        compilation,
        baseRevision,
      );
      const hardOutcome = await this.deps.worldAdjudicator.adjudicate(
        compilation,
        adjudicationContext,
      );

      const socialContext = this.socialAdapter.prepare(event, hardOutcome);
      const primitives = compilation.status === "compiled"
        ? (compilation.primitives ?? [])
        : [];
      const enrichedOutcome = await this.deps.socialProposer.propose(
        hardOutcome,
        primitives,
        socialContext,
      );

      const baseOutcome: WorldOutcomeProposalV1 = {
        schema_version: enrichedOutcome.schema_version,
        outcome_id: enrichedOutcome.outcome_id,
        action_proposal_id: enrichedOutcome.action_proposal_id,
        actor_id: enrichedOutcome.actor_id,
        status: enrichedOutcome.status,
        summary: enrichedOutcome.summary,
        hard_constraint_classes: enrichedOutcome.hard_constraint_classes,
        proposed_effects: enrichedOutcome.proposed_effects,
        source_refs: enrichedOutcome.source_refs,
        adjudicator_version: enrichedOutcome.adjudicator_version,
        rule_version: enrichedOutcome.rule_version,
        source_closure_hash: enrichedOutcome.source_closure_hash,
        base_state_revision: enrichedOutcome.base_state_revision,
        proposed_at: enrichedOutcome.proposed_at,
      };

      const commitResult = this.deps.stateManager.submitWorldOutcome(
        baseOutcome,
        {
          inputSources: event.sourceRefs,
        },
      );

      let speechIds: string[] = [];
      let outboxIds: string[] = [];

      if (this.config.enableSpeechOutput && this.hasCommunicationIntent(policyResult)) {
        const speech = this.speechRenderer.render(policyResult, event, this.config);
        if (speech) {
          const speechResult = this.deps.stateManager.submitReply(speech, {
            triggerEvent: this.toWorldEvent(event),
            scene: { scene_id: this.getOrCreateSceneId() },
            inputSources: event.sourceRefs,
          });
          speechIds = speechResult.speechIds;
          outboxIds = speechResult.outboxIds;
        }
      }

      return {
        eventId: event.eventId,
        origin: event.origin,
        admission,
        woke: true,
        policyResult,
        compilation,
        hardOutcome,
        enrichedOutcome,
        committed: commitResult.committed,
        speechIds,
        outboxIds,
      };
    } catch (error) {
      return {
        eventId: event.eventId,
        origin: event.origin,
        admission,
        woke: true,
        committed: false,
        speechIds: [],
        outboxIds: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private getBaseRevision(): number {
    return 0;
  }

  private hasCommunicationIntent(result: OpenPolicyResultV1): boolean {
    const intent = result.action.intent.toLowerCase();
    return intent.includes("communicate")
      || intent.includes("reply")
      || intent.includes("respond")
      || intent.includes("say")
      || intent.includes("tell")
      || intent.includes("ask");
  }

  private toWorldEvent(event: PipelineEvent): WorldEvent {
    return {
      schema_version: "1.0",
      event_id: event.eventId,
      origin: event.origin === "user" ? "user" : "system",
      kind: event.kind,
      channel: null,
      occurred_at: event.occurredAt,
      received_at: utcnowIso(),
      world_day: null,
      world_phase: null,
      provenance: {
        principal_id: this.config.actorId,
        connector_id: "pipeline",
        trust: "authenticated",
      },
      privacy_scope: "private_im",
      causation_event_id: null,
      idempotency_key: `idem:${event.eventId}`,
      payload: event.payload as Record<string, unknown>,
    };
  }

  private getOrCreateSceneId(): string {
    return newId("scene");
  }
}

/**
 * Stub admission adapter for testing.
 * Always returns wake for user events, ignore for others.
 */
export class StubAdmissionAdapter implements AdmissionAdapter {
  constructor(
    private readonly wakeUserEvents: boolean = true,
    private readonly wakeWorldEvents: boolean = false,
  ) {}

  evaluate(event: PipelineEvent, baseRevision: number): AdmissionResult {
    const shouldWake =
      (event.origin === "user" && this.wakeUserEvents) ||
      (event.origin !== "user" && this.wakeWorldEvents);

    if (!shouldWake) {
      return { candidate: null, decision: null };
    }

    const candidateId = `wake-candidate:${event.eventId}`;
    const candidate: WakeCandidateV1 = {
      schema_version: "1.0",
      candidate_id: candidateId,
      actor_id: "muelsyse",
      committed_revision: baseRevision,
      observation_refs: event.sourceRefs,
      boundary_kind: event.origin === "user" ? "observable_change" : "activity_boundary",
      occurred_at: event.occurredAt,
      input_closure_hash: "a".repeat(64),
    };

    const decision: WakeDecisionV1 = {
      schema_version: "1.0",
      decision_id: `wake-decision:${event.eventId}`,
      candidate_id: candidateId,
      actor_id: "muelsyse",
      disposition: "wake",
      queue_lane: event.origin === "user" ? "reply" : "normal",
      reason_codes: ["observable_change"],
      matched_rule_ids: [],
      observation_refs: event.sourceRefs,
      gate_version: "stub.v1",
      parameter_version: "stub.v1",
      base_state_revision: baseRevision,
      input_closure_hash: "a".repeat(64),
      decided_at: event.occurredAt,
    };

    return { candidate, decision };
  }
}

/**
 * Stub adapters for testing unified pipeline integration.
 */
export class StubWorkingSelfInputAdapter implements WorkingSelfInputAdapter {
  prepare(
    event: PipelineEvent,
    decision: WakeDecisionV1,
    baseRevision: number,
  ): WorkingSelfBuildInput {
    return {
      episodeId: newId("episode"),
      actorId: decision.actor_id,
      baseStateRevision: baseRevision,
      evidence: [
        {
          evidenceId: `ev_${event.eventId}`,
          origin: "current_input",
          narrative: `Event: ${event.kind}`,
          sourceRefs: event.sourceRefs,
        },
      ],
      capacityEnvelope: {
        schema_version: "2.0",
        envelope_id: newId("env"),
        actor_id: decision.actor_id,
        reservation_id: newId("res"),
        access_class: "reply",
        visibility: "engine_only",
        max_semantic_input_units: 1000,
        max_expression_units: 500,
        max_deliberation_units: 0,
        max_tool_rounds: 0,
        mandatory_source_refs: [],
        accounting_version: "stub.v1",
        base_state_revision: baseRevision,
      },
      assemblerVersion: "stub.v1",
      assembledAt: event.occurredAt,
    };
  }
}

export class StubAdjudicationContextAdapter implements AdjudicationContextAdapter {
  prepare(
    _event: PipelineEvent,
    _compilation: ActionCompilationResultV1,
    _baseRevision: number,
  ): AdjudicationContext {
    return {
      actor: {
        actor_id: "muelsyse",
        location_id: "lab",
        capabilities: new Set(["observe", "move", "communicate"]),
        known_locations: new Set(["lab", "office", "corridor"]),
        known_targets: new Set(["specimen_1", "researcher_wei"]),
        permissions: new Set(["use_equipment", "access_lab"]),
      },
      world: {
        revision: 0,
        world_time: new Date(),
        world_day: 1,
        world_phase: "morning",
        locations: new Map([
          [
            "lab",
            {
              location_id: "lab",
              adjacent_locations: new Set(["corridor", "office"]),
              available_targets: new Set(["specimen_1", "equipment_1"]),
              capacity_available: new Map([["researcher_slots", 3]]),
            },
          ],
        ]),
        immutable_rules: [],
      },
      source_refs: [],
    };
  }
}

export class StubSocialContextAdapter implements SocialContextAdapter {
  prepare(
    _event: PipelineEvent,
    _hardOutcome: WorldOutcomeProposalV1,
  ): SocialContext {
    return {
      npcs: new Map(),
      environmental_factors: [],
      communication_channel: "private_im",
      source_refs: [],
    };
  }
}

export class StubSpeechRenderer implements SpeechRenderer {
  render(
    policyResult: OpenPolicyResultV1,
    _event: PipelineEvent,
    _config: CognitivePipelineConfig,
  ): SurfaceMessage | null {
    const intent = policyResult.action.intent.toLowerCase();
    if (!intent.includes("communicate") && !intent.includes("reply")) {
      return null;
    }

    return {
      schema_version: "1.0",
      speech_id: newId("sp"),
      operation_id: newId("op"),
      channel: "private_im",
      recipient_principal_id: "doctor",
      privacy_scope: "private_im",
      capability_revision: 0,
      authorization_decision_id: newId("authz"),
      source_refs: [...policyResult.action.source_refs],
      bubbles: [policyResult.action.plan?.[0] ?? policyResult.action.intent],
    };
  }
}
