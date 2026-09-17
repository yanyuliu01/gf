/**
 * Unified Speech Output (M20-026).
 *
 * Routes proactive and reactive text through the same:
 *   SurfaceMessage -> StateManager.submitReply -> outbox
 *
 * Key invariants:
 * - Same path for user-initiated (reactive) and system-initiated (proactive) speech
 * - Proactive delivery is feature-disabled by default until safety tests pass
 * - All speech requires valid source closure and capability revision
 * - Communication intent must come from Open Policy, not invented
 */

import type { SourceRef, OpenActionProposalV1 } from "../generated/agentPipelineTypes.js";
import type { StateManager, SurfaceMessage, WorldEvent } from "../state/stateManager.js";
import { newId, utcnowIso } from "../domain/ids.js";

export type SpeechTrigger = "reactive" | "proactive";

export interface UnifiedSpeechConfig {
  actorId: string;
  channel: "private_im";
  proactiveEnabled: boolean;
  speechVersion: string;
}

export interface SpeechIntent {
  trigger: SpeechTrigger;
  recipientPrincipalId: string;
  text: string;
  sourceRefs: readonly SourceRef[];
  actionProposal: OpenActionProposalV1;
  capabilityRevision: number;
}

export interface SpeechResult {
  submitted: boolean;
  speechId?: string;
  outboxIds?: string[];
  blocked?: "proactive_disabled" | "empty_text" | "no_intent";
}

const COMMUNICATE_PATTERNS = [
  /\bcommunicate\b/i,
  /\breply\b/i,
  /\brespond\b/i,
  /\bsay\b/i,
  /\btell\b/i,
  /\bask\b/i,
  /\bnotify\b/i,
  /\binform\b/i,
  /\bmessage\b/i,
];

export function hasCommunicationIntent(intent: string): boolean {
  return COMMUNICATE_PATTERNS.some((pattern) => pattern.test(intent));
}

export function extractTextFromPlan(plan: readonly string[] | undefined): string | null {
  if (!plan || plan.length === 0) {
    return null;
  }
  return plan[0];
}

/**
 * Unified speech submission through single path.
 *
 * Both reactive (user-triggered) and proactive (system-triggered) speech
 * use the same SurfaceMessage -> StateManager -> outbox path.
 */
export class UnifiedSpeechOutput {
  constructor(
    private readonly config: UnifiedSpeechConfig,
    private readonly stateManager: StateManager,
  ) {}

  submit(
    intent: SpeechIntent,
    triggerEvent: WorldEvent,
    sceneId: string,
  ): SpeechResult {
    if (intent.trigger === "proactive" && !this.config.proactiveEnabled) {
      return { submitted: false, blocked: "proactive_disabled" };
    }

    if (!intent.text.trim()) {
      return { submitted: false, blocked: "empty_text" };
    }

    if (!hasCommunicationIntent(intent.actionProposal.intent)) {
      return { submitted: false, blocked: "no_intent" };
    }

    const speech: SurfaceMessage = {
      schema_version: "1.0",
      speech_id: newId("sp"),
      operation_id: newId("op"),
      channel: this.config.channel,
      recipient_principal_id: intent.recipientPrincipalId,
      privacy_scope: "private_im",
      capability_revision: intent.capabilityRevision,
      authorization_decision_id: newId("authz"),
      source_refs: [...intent.sourceRefs],
      bubbles: [intent.text],
    };

    const result = this.stateManager.submitReply(speech, {
      triggerEvent,
      scene: { scene_id: sceneId },
      inputSources: intent.sourceRefs,
    });

    return {
      submitted: result.committed,
      speechId: speech.speech_id,
      outboxIds: result.outboxIds,
    };
  }

  /**
   * Creates speech intent from policy result.
   * Returns null if policy does not contain communication intent.
   */
  createIntentFromPolicy(
    actionProposal: OpenActionProposalV1,
    trigger: SpeechTrigger,
    recipientPrincipalId: string,
    capabilityRevision: number,
  ): SpeechIntent | null {
    if (!hasCommunicationIntent(actionProposal.intent)) {
      return null;
    }

    const text = extractTextFromPlan(actionProposal.plan) ?? actionProposal.intent;

    return {
      trigger,
      recipientPrincipalId,
      text,
      sourceRefs: actionProposal.source_refs,
      actionProposal,
      capabilityRevision,
    };
  }
}

/**
 * Stub implementation for testing.
 */
export class StubUnifiedSpeechOutput {
  private readonly submittedIntents: SpeechIntent[] = [];

  constructor(
    private readonly shouldSubmit: boolean = true,
    private readonly blocked?: SpeechResult["blocked"],
  ) {}

  submit(
    intent: SpeechIntent,
    _triggerEvent: WorldEvent,
    _sceneId: string,
  ): SpeechResult {
    if (!this.shouldSubmit) {
      return { submitted: false, blocked: this.blocked };
    }

    this.submittedIntents.push(intent);
    return {
      submitted: true,
      speechId: newId("sp"),
      outboxIds: [newId("outbox")],
    };
  }

  getSubmittedIntents(): readonly SpeechIntent[] {
    return this.submittedIntents;
  }

  createIntentFromPolicy(
    actionProposal: OpenActionProposalV1,
    trigger: SpeechTrigger,
    recipientPrincipalId: string,
    capabilityRevision: number,
  ): SpeechIntent | null {
    if (!hasCommunicationIntent(actionProposal.intent)) {
      return null;
    }

    const text = extractTextFromPlan(actionProposal.plan) ?? actionProposal.intent;

    return {
      trigger,
      recipientPrincipalId,
      text,
      sourceRefs: actionProposal.source_refs,
      actionProposal,
      capabilityRevision,
    };
  }
}
