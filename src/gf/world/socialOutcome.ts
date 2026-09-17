/**
 * Social/Environmental Outcome Proposal (M20-023).
 *
 * This module adds NPC choice, partial success, misunderstanding, and side
 * effects to hard-adjudicated outcomes. It CANNOT bypass hard adjudication:
 * - If M20-022 rejected an action, it stays rejected
 * - Social outcomes only apply to accepted/partial actions
 *
 * Key invariants:
 * - Source-constrained: all outcomes must reference valid sources
 * - NPC decisions respect NPC availability and known sources
 * - Partial success reduces but does not eliminate effects
 * - Misunderstandings modify communication outcomes
 * - Side effects are additional consequences, never contradicting hard results
 */

import { newId, utcnowIso } from "../domain/ids.js";
import type {
  ProposedWorldEffectV1,
  WorldOutcomeProposalV1,
  SourceRef,
} from "../generated/agentPipelineTypes.js";
import type { ExecutionPrimitiveV1 } from "../generated/cognitiveRuntimeTypes.js";

export type SocialOutcomeClass =
  | "npc_accepted"
  | "npc_rejected"
  | "npc_negotiated"
  | "partial_success"
  | "misunderstanding"
  | "side_effect";

export interface NPCState {
  npc_id: string;
  location_id: string;
  availability: "available" | "busy" | "unavailable";
  disposition: "cooperative" | "neutral" | "reluctant";
  known_sources: Set<string>;
  active_commitments: string[];
}

export interface SocialContext {
  npcs: Map<string, NPCState>;
  environmental_factors: EnvironmentalFactor[];
  communication_channel: string;
  source_refs: SourceRef[];
}

export interface EnvironmentalFactor {
  factor_id: string;
  kind: "noise" | "distraction" | "obstacle" | "opportunity";
  severity: "minor" | "moderate" | "major";
  description: string;
}

export interface SocialOutcomeResult {
  outcome_class: SocialOutcomeClass;
  description: string;
  modified_effects: ProposedWorldEffectV1[];
  side_effects: ProposedWorldEffectV1[];
  source_refs: SourceRef[];
}

const SOCIAL_PROPOSER_VERSION = "social-outcome-proposer.v1";

export function evaluateNPCChoice(
  primitive: ExecutionPrimitiveV1,
  targetNPC: NPCState | undefined,
  context: SocialContext,
): { choice: "accept" | "reject" | "negotiate"; reason: string } {
  if (!targetNPC) {
    return { choice: "reject", reason: "Target NPC not found" };
  }

  if (targetNPC.availability === "unavailable") {
    return { choice: "reject", reason: `${targetNPC.npc_id} is unavailable` };
  }

  if (targetNPC.availability === "busy") {
    if (targetNPC.disposition === "cooperative") {
      return { choice: "negotiate", reason: `${targetNPC.npc_id} is busy but willing to negotiate` };
    }
    return { choice: "reject", reason: `${targetNPC.npc_id} is too busy` };
  }

  if (targetNPC.disposition === "reluctant") {
    return { choice: "negotiate", reason: `${targetNPC.npc_id} is reluctant and wants to negotiate` };
  }

  return { choice: "accept", reason: `${targetNPC.npc_id} accepts` };
}

export function evaluatePartialSuccess(
  primitive: ExecutionPrimitiveV1,
  context: SocialContext,
): { partial: boolean; reduction: number; reason?: string } {
  const obstacles = context.environmental_factors.filter(
    (f) => f.kind === "obstacle" || f.kind === "distraction",
  );

  if (obstacles.length === 0) {
    return { partial: false, reduction: 0 };
  }

  const majorObstacles = obstacles.filter((f) => f.severity === "major");
  if (majorObstacles.length > 0) {
    return {
      partial: true,
      reduction: 0.5,
      reason: `Major obstacle: ${majorObstacles[0].description}`,
    };
  }

  const moderateObstacles = obstacles.filter((f) => f.severity === "moderate");
  if (moderateObstacles.length > 0) {
    return {
      partial: true,
      reduction: 0.25,
      reason: `Moderate obstacle: ${moderateObstacles[0].description}`,
    };
  }

  return { partial: false, reduction: 0 };
}

export function evaluateMisunderstanding(
  primitive: ExecutionPrimitiveV1,
  context: SocialContext,
): { misunderstood: boolean; interpretation?: string; reason?: string } {
  if (primitive.primitive !== "communicate") {
    return { misunderstood: false };
  }

  const noiseFactors = context.environmental_factors.filter(
    (f) => f.kind === "noise",
  );

  if (noiseFactors.length > 0 && noiseFactors[0].severity !== "minor") {
    return {
      misunderstood: true,
      interpretation: "Message was partially lost due to environmental noise",
      reason: noiseFactors[0].description,
    };
  }

  return { misunderstood: false };
}

export function evaluateSideEffects(
  primitive: ExecutionPrimitiveV1,
  context: SocialContext,
): ProposedWorldEffectV1[] {
  const sideEffects: ProposedWorldEffectV1[] = [];

  const opportunities = context.environmental_factors.filter(
    (f) => f.kind === "opportunity",
  );

  for (const opp of opportunities) {
    if (opp.severity === "major") {
      sideEffects.push({
        effect_id: newId("eff"),
        kind: "opportunity_discovered",
        summary: `Discovered opportunity: ${opp.description}`,
        source_refs: context.source_refs,
      });
    }
  }

  if (primitive.primitive === "move") {
    const distractions = context.environmental_factors.filter(
      (f) => f.kind === "distraction" && f.severity !== "minor",
    );
    for (const d of distractions) {
      sideEffects.push({
        effect_id: newId("eff"),
        kind: "observation_triggered",
        summary: `While moving, noticed: ${d.description}`,
        source_refs: context.source_refs,
      });
    }
  }

  return sideEffects;
}

export function proposeSocialOutcome(
  hardOutcome: WorldOutcomeProposalV1,
  primitives: ExecutionPrimitiveV1[],
  context: SocialContext,
): SocialOutcomeResult[] {
  if (hardOutcome.status === "rejected") {
    return [];
  }

  const results: SocialOutcomeResult[] = [];

  for (const primitive of primitives) {
    if (primitive.primitive === "communicate") {
      const targetId = primitive.target;
      const targetNPC = context.npcs.get(targetId);
      const npcChoice = evaluateNPCChoice(primitive, targetNPC, context);

      let outcomeClass: SocialOutcomeClass;
      switch (npcChoice.choice) {
        case "accept":
          outcomeClass = "npc_accepted";
          break;
        case "reject":
          outcomeClass = "npc_rejected";
          break;
        case "negotiate":
          outcomeClass = "npc_negotiated";
          break;
      }

      results.push({
        outcome_class: outcomeClass,
        description: npcChoice.reason,
        modified_effects: [],
        side_effects: [],
        source_refs: context.source_refs,
      });

      const misunderstanding = evaluateMisunderstanding(primitive, context);
      if (misunderstanding.misunderstood) {
        results.push({
          outcome_class: "misunderstanding",
          description: misunderstanding.interpretation ?? "Communication unclear",
          modified_effects: [],
          side_effects: [],
          source_refs: context.source_refs,
        });
      }
    }

    const partialResult = evaluatePartialSuccess(primitive, context);
    if (partialResult.partial) {
      results.push({
        outcome_class: "partial_success",
        description: partialResult.reason ?? "Action partially succeeded",
        modified_effects: [],
        side_effects: [],
        source_refs: context.source_refs,
      });
    }

    const sideEffects = evaluateSideEffects(primitive, context);
    if (sideEffects.length > 0) {
      results.push({
        outcome_class: "side_effect",
        description: `${sideEffects.length} side effect(s) occurred`,
        modified_effects: [],
        side_effects: sideEffects,
        source_refs: context.source_refs,
      });
    }
  }

  return results;
}

export interface EnrichedOutcomeProposal extends WorldOutcomeProposalV1 {
  social_outcomes: SocialOutcomeResult[];
  social_proposer_version: string;
}

export class SocialOutcomeProposer {
  async propose(
    hardOutcome: Readonly<WorldOutcomeProposalV1>,
    primitives: readonly ExecutionPrimitiveV1[],
    context: Readonly<SocialContext>,
  ): Promise<Readonly<EnrichedOutcomeProposal>> {
    if (hardOutcome.status === "rejected") {
      return {
        ...hardOutcome,
        social_outcomes: [],
        social_proposer_version: SOCIAL_PROPOSER_VERSION,
      };
    }

    const socialOutcomes = proposeSocialOutcome(
      hardOutcome,
      [...primitives],
      context,
    );

    const additionalEffects: ProposedWorldEffectV1[] = [];
    for (const outcome of socialOutcomes) {
      additionalEffects.push(...outcome.side_effects);
    }

    const hasNPCRejection = socialOutcomes.some(
      (o) => o.outcome_class === "npc_rejected",
    );
    const hasMisunderstanding = socialOutcomes.some(
      (o) => o.outcome_class === "misunderstanding",
    );
    const hasPartialSuccess = socialOutcomes.some(
      (o) => o.outcome_class === "partial_success",
    );

    let finalStatus = hardOutcome.status;
    let finalSummary = hardOutcome.summary;

    if (hasNPCRejection && hardOutcome.status === "accepted") {
      finalStatus = "partial";
      finalSummary = `${hardOutcome.summary}; NPC rejected interaction`;
    } else if (hasMisunderstanding && hardOutcome.status === "accepted") {
      finalStatus = "partial";
      finalSummary = `${hardOutcome.summary}; communication misunderstood`;
    } else if (hasPartialSuccess && hardOutcome.status === "accepted") {
      finalStatus = "partial";
      finalSummary = `${hardOutcome.summary}; action partially succeeded`;
    }

    const enrichedEffects = [
      ...hardOutcome.proposed_effects,
      ...additionalEffects,
    ];

    return {
      ...hardOutcome,
      status: finalStatus,
      summary: finalSummary,
      proposed_effects: enrichedEffects,
      social_outcomes: socialOutcomes,
      social_proposer_version: SOCIAL_PROPOSER_VERSION,
    };
  }
}

export class StubSocialOutcomeProposer {
  constructor(
    private readonly defaultOutcomes: SocialOutcomeResult[] = [],
  ) {}

  async propose(
    hardOutcome: Readonly<WorldOutcomeProposalV1>,
    _primitives: readonly ExecutionPrimitiveV1[],
    _context: Readonly<SocialContext>,
  ): Promise<Readonly<EnrichedOutcomeProposal>> {
    return {
      ...hardOutcome,
      social_outcomes: this.defaultOutcomes,
      social_proposer_version: "stub-social-proposer.v1",
    };
  }
}
