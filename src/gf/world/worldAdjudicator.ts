/**
 * World Adjudicator: Deterministic hard constraint checks.
 *
 * This module implements the M20-022 hard adjudication for location, time,
 * resource, capability, knowledge, permission, and immutable world rules.
 *
 * Key invariants (from docs/invariants/19):
 * - A3: Action proposals cannot declare their own success. Actual consequences
 *   are judged here, but output is still a proposal for StateManager to commit.
 * - B3: Derived projections (like these constraints) are visible to the
 *   adjudicator but not to Working Self or Open Policy.
 *
 * The adjudicator receives the compiled primitives from M20-021's ActionCompiler
 * and checks each against the current world state.
 */

import { newId, utcnowIso } from "../domain/ids.js";
import type {
  ActionCompilationResultV1,
  ExecutionPrimitiveV1,
} from "../generated/cognitiveRuntimeTypes.js";
import type {
  ProposedWorldEffectV1,
  WorldOutcomeProposalV1,
  SourceRef,
} from "../generated/agentPipelineTypes.js";
import type { WorldAdjudicatorPort } from "./actionPorts.js";

export type HardConstraintClass =
  | "location"
  | "time"
  | "resource"
  | "capability"
  | "knowledge"
  | "permission"
  | "world_rule";

export interface ActorState {
  actor_id: string;
  location_id: string;
  capabilities: Set<string>;
  known_locations: Set<string>;
  known_targets: Set<string>;
  permissions: Set<string>;
}

export interface WorldSnapshot {
  revision: number;
  world_time: Date;
  world_day: number;
  world_phase: string;
  locations: Map<string, LocationState>;
  immutable_rules: ImmutableRule[];
}

export interface LocationState {
  location_id: string;
  adjacent_locations: Set<string>;
  available_targets: Set<string>;
  capacity_available: Map<string, number>;
}

export interface ImmutableRule {
  rule_id: string;
  description: string;
  check: (primitive: ExecutionPrimitiveV1, actor: ActorState, world: WorldSnapshot) => boolean;
}

export interface HardConstraintResult {
  passed: boolean;
  failed_classes: HardConstraintClass[];
  reasons: string[];
}

export interface AdjudicationContext {
  actor: ActorState;
  world: WorldSnapshot;
  source_refs: SourceRef[];
}

const ADJUDICATOR_VERSION = "world-adjudicator.v1";
const RULE_VERSION = "hard-constraints.v1";

export function checkLocationConstraint(
  primitive: ExecutionPrimitiveV1,
  actor: ActorState,
  world: WorldSnapshot,
): { passed: boolean; reason?: string } {
  if (primitive.primitive === "wait" || primitive.primitive === "communicate") {
    return { passed: true };
  }

  if (primitive.primitive === "move") {
    const targetLocation = primitive.target;
    const currentLocation = world.locations.get(actor.location_id);
    if (!currentLocation) {
      return { passed: false, reason: `Actor location ${actor.location_id} not found` };
    }
    if (!currentLocation.adjacent_locations.has(targetLocation) && targetLocation !== actor.location_id) {
      return { passed: false, reason: `Location ${targetLocation} not adjacent to ${actor.location_id}` };
    }
    if (!world.locations.has(targetLocation)) {
      return { passed: false, reason: `Target location ${targetLocation} does not exist` };
    }
    return { passed: true };
  }

  if (primitive.primitive === "observe" || primitive.primitive === "use_object") {
    const currentLocation = world.locations.get(actor.location_id);
    if (!currentLocation) {
      return { passed: false, reason: `Actor location ${actor.location_id} not found` };
    }
    if (!currentLocation.available_targets.has(primitive.target)) {
      return { passed: false, reason: `Target ${primitive.target} not available at ${actor.location_id}` };
    }
    return { passed: true };
  }

  return { passed: true };
}

export function checkTimeConstraint(
  primitive: ExecutionPrimitiveV1,
  _actor: ActorState,
  world: WorldSnapshot,
): { passed: boolean; reason?: string } {
  if (primitive.primitive === "wait") {
    return { passed: true };
  }

  const phase = world.world_phase;
  if (phase === "night") {
    if (primitive.primitive === "move") {
      return { passed: false, reason: "Movement restricted during night phase" };
    }
    if (primitive.primitive === "use_object") {
      return { passed: false, reason: "Object use restricted during night phase" };
    }
  }

  return { passed: true };
}

export function checkResourceConstraint(
  primitive: ExecutionPrimitiveV1,
  actor: ActorState,
  world: WorldSnapshot,
): { passed: boolean; reason?: string } {
  if (primitive.primitive === "use_object") {
    const location = world.locations.get(actor.location_id);
    if (!location) {
      return { passed: true };
    }
    const available = location.capacity_available.get(primitive.target) ?? 0;
    if (available <= 0) {
      return { passed: false, reason: `Resource ${primitive.target} not available` };
    }
  }

  return { passed: true };
}

export function checkCapabilityConstraint(
  primitive: ExecutionPrimitiveV1,
  actor: ActorState,
  _world: WorldSnapshot,
): { passed: boolean; reason?: string } {
  const requiredCapabilities: Record<string, string> = {
    observe: "perception",
    move: "locomotion",
    use_object: "manipulation",
    communicate: "speech",
  };

  const required = requiredCapabilities[primitive.primitive];
  if (required && !actor.capabilities.has(required)) {
    return { passed: false, reason: `Actor lacks ${required} capability for ${primitive.primitive}` };
  }

  return { passed: true };
}

export function checkKnowledgeConstraint(
  primitive: ExecutionPrimitiveV1,
  actor: ActorState,
  _world: WorldSnapshot,
): { passed: boolean; reason?: string } {
  if (primitive.primitive === "move") {
    if (!actor.known_locations.has(primitive.target)) {
      return { passed: false, reason: `Actor does not know location ${primitive.target}` };
    }
  }

  if (primitive.primitive === "observe" || primitive.primitive === "use_object") {
    if (!actor.known_targets.has(primitive.target)) {
      return { passed: false, reason: `Actor does not know target ${primitive.target}` };
    }
  }

  return { passed: true };
}

export function checkPermissionConstraint(
  primitive: ExecutionPrimitiveV1,
  actor: ActorState,
  _world: WorldSnapshot,
): { passed: boolean; reason?: string } {
  if (primitive.primitive === "use_object") {
    const permissionRequired = `use:${primitive.target}`;
    if (actor.permissions.size > 0 && !actor.permissions.has(permissionRequired)) {
      return { passed: false, reason: `Actor lacks permission ${permissionRequired}` };
    }
  }

  return { passed: true };
}

export function checkWorldRuleConstraint(
  primitive: ExecutionPrimitiveV1,
  actor: ActorState,
  world: WorldSnapshot,
): { passed: boolean; reason?: string } {
  for (const rule of world.immutable_rules) {
    if (!rule.check(primitive, actor, world)) {
      return { passed: false, reason: `Violates immutable rule: ${rule.description}` };
    }
  }

  return { passed: true };
}

export function checkHardConstraints(
  primitive: ExecutionPrimitiveV1,
  context: AdjudicationContext,
): HardConstraintResult {
  const checks: Array<{
    class: HardConstraintClass;
    check: (p: ExecutionPrimitiveV1, a: ActorState, w: WorldSnapshot) => { passed: boolean; reason?: string };
  }> = [
    { class: "location", check: checkLocationConstraint },
    { class: "time", check: checkTimeConstraint },
    { class: "resource", check: checkResourceConstraint },
    { class: "capability", check: checkCapabilityConstraint },
    { class: "knowledge", check: checkKnowledgeConstraint },
    { class: "permission", check: checkPermissionConstraint },
    { class: "world_rule", check: checkWorldRuleConstraint },
  ];

  const failed_classes: HardConstraintClass[] = [];
  const reasons: string[] = [];

  for (const { class: constraintClass, check } of checks) {
    const result = check(primitive, context.actor, context.world);
    if (!result.passed) {
      failed_classes.push(constraintClass);
      if (result.reason) {
        reasons.push(result.reason);
      }
    }
  }

  return {
    passed: failed_classes.length === 0,
    failed_classes,
    reasons,
  };
}

export class WorldAdjudicator
  implements
    WorldAdjudicatorPort<
      ActionCompilationResultV1,
      AdjudicationContext,
      WorldOutcomeProposalV1
    >
{
  async adjudicate(
    compilation: Readonly<ActionCompilationResultV1>,
    context: Readonly<AdjudicationContext>,
  ): Promise<Readonly<WorldOutcomeProposalV1>> {
    const proposedAt = utcnowIso();
    const outcomeId = newId("out");

    if (compilation.status === "capability_gap") {
      return {
        schema_version: "1.0",
        outcome_id: outcomeId,
        action_proposal_id: compilation.action_proposal_id,
        actor_id: compilation.actor_id,
        status: "rejected",
        summary: compilation.capability_gap!.unsupported_semantics,
        hard_constraint_classes: ["capability"],
        proposed_effects: [],
        source_refs: context.source_refs,
        adjudicator_version: ADJUDICATOR_VERSION,
        rule_version: RULE_VERSION,
        source_closure_hash: compilation.source_closure_hash,
        base_state_revision: context.world.revision,
        proposed_at: proposedAt,
      };
    }

    const primitives = compilation.primitives ?? [];
    const allFailedClasses = new Set<HardConstraintClass>();
    const allReasons: string[] = [];
    const proposedEffects: ProposedWorldEffectV1[] = [];

    for (const primitive of primitives) {
      const result = checkHardConstraints(primitive, context);

      if (!result.passed) {
        for (const c of result.failed_classes) {
          allFailedClasses.add(c);
        }
        allReasons.push(...result.reasons);
      } else {
        proposedEffects.push({
          effect_id: newId("eff"),
          kind: primitive.primitive,
          summary: `${primitive.primitive}: ${primitive.target} - ${primitive.detail}`,
          source_refs: context.source_refs,
        });
      }
    }

    const hardConstraintClasses = Array.from(allFailedClasses) as HardConstraintClass[];

    if (hardConstraintClasses.length > 0 && proposedEffects.length === 0) {
      return {
        schema_version: "1.0",
        outcome_id: outcomeId,
        action_proposal_id: compilation.action_proposal_id,
        actor_id: compilation.actor_id,
        status: "rejected",
        summary: allReasons.join("; ") || "Hard constraint check failed",
        hard_constraint_classes: hardConstraintClasses,
        proposed_effects: [],
        source_refs: context.source_refs,
        adjudicator_version: ADJUDICATOR_VERSION,
        rule_version: RULE_VERSION,
        source_closure_hash: compilation.source_closure_hash,
        base_state_revision: context.world.revision,
        proposed_at: proposedAt,
      };
    }

    if (hardConstraintClasses.length > 0) {
      return {
        schema_version: "1.0",
        outcome_id: outcomeId,
        action_proposal_id: compilation.action_proposal_id,
        actor_id: compilation.actor_id,
        status: "partial",
        summary: `Partial execution: ${allReasons.join("; ")}`,
        hard_constraint_classes: hardConstraintClasses,
        proposed_effects: proposedEffects,
        source_refs: context.source_refs,
        adjudicator_version: ADJUDICATOR_VERSION,
        rule_version: RULE_VERSION,
        source_closure_hash: compilation.source_closure_hash,
        base_state_revision: context.world.revision,
        proposed_at: proposedAt,
      };
    }

    return {
      schema_version: "1.0",
      outcome_id: outcomeId,
      action_proposal_id: compilation.action_proposal_id,
      actor_id: compilation.actor_id,
      status: "accepted",
      summary: `Accepted: ${proposedEffects.map((e) => e.kind).join(", ")}`,
      hard_constraint_classes: [],
      proposed_effects: proposedEffects,
      source_refs: context.source_refs,
      adjudicator_version: ADJUDICATOR_VERSION,
      rule_version: RULE_VERSION,
      source_closure_hash: compilation.source_closure_hash,
      base_state_revision: context.world.revision,
      proposed_at: proposedAt,
    };
  }
}

export class StubWorldAdjudicator
  implements
    WorldAdjudicatorPort<
      ActionCompilationResultV1,
      AdjudicationContext,
      WorldOutcomeProposalV1
    >
{
  constructor(
    private readonly defaultResult?: Partial<WorldOutcomeProposalV1>,
  ) {}

  async adjudicate(
    compilation: Readonly<ActionCompilationResultV1>,
    context: Readonly<AdjudicationContext>,
  ): Promise<Readonly<WorldOutcomeProposalV1>> {
    const proposedAt = utcnowIso();
    const outcomeId = newId("out");
    const primitives = compilation.primitives ?? [];

    return {
      schema_version: "1.0",
      outcome_id: outcomeId,
      action_proposal_id: compilation.action_proposal_id,
      actor_id: compilation.actor_id,
      status: "accepted",
      summary: "Stub: all accepted",
      hard_constraint_classes: [],
      proposed_effects: primitives.map((p) => ({
        effect_id: newId("eff"),
        kind: p.primitive,
        summary: `${p.primitive}: ${p.target}`,
        source_refs: context.source_refs,
      })),
      source_refs: context.source_refs,
      adjudicator_version: "stub-adjudicator.v1",
      rule_version: "stub-rules.v1",
      source_closure_hash: compilation.source_closure_hash,
      base_state_revision: context.world.revision,
      proposed_at: proposedAt,
      ...this.defaultResult,
    };
  }
}
