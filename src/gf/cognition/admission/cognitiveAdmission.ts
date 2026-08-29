import { createHash } from "node:crypto";

import type {
  ObservationV1,
  SourceRef,
} from "../../generated/agentPipelineTypes.js";
import type {
  AttentionSubscriptionV1,
  WakeCandidateV1,
  WakeDecisionV1,
} from "../../generated/cognitiveRuntimeTypes.js";
import {
  computeInputClosureHash,
  normalizeSourceRefs,
} from "../../validation/derivedInputClosure.js";
import type {
  PerceptionProjectionInput,
  PerceptionProjectionResult,
  PerceptionCandidate,
} from "../perception/perceptionProjector.js";
import type { PerceptionPort } from "../ports.js";
import type {
  ChangeAggregatorPort,
  CognitiveGatePort,
} from "../runtimePorts.js";

const MAX_GATE_SOURCES = 64;

export type AdmissionBoundaryHint =
  | "observable_change"
  | "activity_boundary"
  | "runtime_hard_interrupt";

export interface CommittedAdmissionChange {
  changeId: string;
  aggregationKey: string;
  eventKind: string;
  entityIds: readonly string[];
  locationIds: readonly string[];
  salience: number;
  boundaryHint: AdmissionBoundaryHint;
  recursiveInternal: boolean;
  perceptionCandidate: Readonly<PerceptionCandidate>;
}

export interface ChangeAggregationContext {
  windowStartedAt: string;
  windowEndedAt: string;
  accumulatorVersion: string;
}

export interface AggregatedChangeBatch {
  changes: readonly Readonly<CommittedAdmissionChange>[];
  droppedDuplicateCount: number;
  windowStartedAt: string;
  windowEndedAt: string;
  accumulatorVersion: string;
}

export interface CurrentActivityAdmissionContext {
  activityId: string;
  continuation: "automatic" | "decision_required";
  sourceRefs: readonly SourceRef[];
}

export interface RuntimeHardInterruptContext {
  ruleId: string;
  observationRefs: readonly SourceRef[];
  queueLane: "reply" | "safety";
}

export interface AccumulatedSignalContext {
  accumulationId: string;
  aggregationKey: string;
  signalCount: number;
  salience: number;
  sourceRefs: readonly SourceRef[];
}

export interface CognitiveGateParameters {
  parameterVersion: string;
  wakeSalience: number;
  accumulateSalience: number;
  accumulatedWakeCount: number;
  accumulatedWakeSalience: number;
}

export interface VisibleAdmissionSignal {
  observation: Readonly<ObservationV1>;
  aggregationKey: string;
  eventKind: string;
  entityIds: readonly string[];
  locationIds: readonly string[];
  salience: number;
  boundaryHint: AdmissionBoundaryHint;
  recursiveInternal: boolean;
}

export interface CognitiveGateContext {
  signals: readonly VisibleAdmissionSignal[];
  currentActivity: Readonly<CurrentActivityAdmissionContext>;
  hardInterrupts: readonly Readonly<RuntimeHardInterruptContext>[];
  activeSubscriptions: readonly Readonly<AttentionSubscriptionV1>[];
  previousAccumulations: readonly Readonly<AccumulatedSignalContext>[];
  parameters: Readonly<CognitiveGateParameters>;
  gateVersion: string;
  decidedAt: string;
  droppedDuplicateCount: number;
}

export interface CognitiveAdmissionInput {
  changes: readonly Readonly<CommittedAdmissionChange>[];
  aggregation: Readonly<ChangeAggregationContext>;
  perception: Omit<PerceptionProjectionInput, "candidates">;
  gate: Omit<CognitiveGateContext, "signals" | "droppedDuplicateCount">;
}

export interface CognitiveAdmissionResult {
  batch: Readonly<AggregatedChangeBatch>;
  observations: readonly ObservationV1[];
  candidate: Readonly<WakeCandidateV1> | null;
  decision: Readonly<WakeDecisionV1> | null;
}

export class CognitiveAdmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CognitiveAdmissionError";
  }
}

/** Canonicalizes one committed change window without merging visibility paths. */
export class ChangeAggregator
  implements ChangeAggregatorPort<
    CommittedAdmissionChange,
    ChangeAggregationContext,
    AggregatedChangeBatch
  >
{
  aggregate(
    changes: readonly CommittedAdmissionChange[],
    context: Readonly<ChangeAggregationContext>,
  ): AggregatedChangeBatch {
    validateTimestamp(context.windowStartedAt, "windowStartedAt");
    validateTimestamp(context.windowEndedAt, "windowEndedAt");
    if (Date.parse(context.windowEndedAt) < Date.parse(context.windowStartedAt)) {
      throw new CognitiveAdmissionError("aggregation window must be monotonic");
    }
    validateId(context.accumulatorVersion, "accumulatorVersion");
    const unique = new Map<string, Readonly<CommittedAdmissionChange>>();
    let droppedDuplicateCount = 0;
    for (const change of changes) {
      validateChange(change, context);
      const prior = unique.get(change.changeId);
      if (prior) {
        if (JSON.stringify(prior) !== JSON.stringify(change)) {
          throw new CognitiveAdmissionError(
            `conflicting duplicate change ${change.changeId}`,
          );
        }
        droppedDuplicateCount += 1;
        continue;
      }
      unique.set(change.changeId, structuredClone(change));
    }
    return {
      changes: [...unique.values()].sort((left, right) =>
        left.perceptionCandidate.occurred_at.localeCompare(
          right.perceptionCandidate.occurred_at,
        ) || left.changeId.localeCompare(right.changeId),
      ),
      droppedDuplicateCount,
      windowStartedAt: context.windowStartedAt,
      windowEndedAt: context.windowEndedAt,
      accumulatorVersion: context.accumulatorVersion,
    };
  }
}

/** Deterministic admission over legal observations and source-linked context. */
export class CognitiveGate
  implements CognitiveGatePort<CognitiveGateContext>
{
  evaluate(
    candidate: Readonly<WakeCandidateV1>,
    context: Readonly<CognitiveGateContext>,
  ): WakeDecisionV1 {
    validateGateInput(candidate, context);
    const candidateKeys = new Set(candidate.observation_refs.map(sourceKey));
    const visibleHardInterrupts = context.hardInterrupts.filter((interrupt) =>
      interrupt.observationRefs.length > 0
      && interrupt.observationRefs.every((source) =>
        candidateKeys.has(sourceKey(source)),
      ),
    );
    const matchingSubscriptions = context.activeSubscriptions.filter(
      (subscription) => subscriptionMatches(subscription, context),
    );
    const matchingAccumulations = context.previousAccumulations.filter(
      (accumulation) => context.signals.some(
        (signal) => signal.aggregationKey === accumulation.aggregationKey,
      ),
    );
    const allInternal = context.signals.every((signal) => signal.recursiveInternal);
    const currentSalience = context.signals.reduce(
      (sum, signal) => sum + signal.salience,
      0,
    );
    const currentSignalCount = context.signals.length;
    const priorSalience = matchingAccumulations.reduce(
      (sum, accumulation) => sum + accumulation.salience,
      0,
    );
    const priorSignalCount = matchingAccumulations.reduce(
      (sum, accumulation) => sum + accumulation.signalCount,
      0,
    );
    const accumulatedWake =
      currentSignalCount + priorSignalCount >= context.parameters.accumulatedWakeCount
      || currentSalience + priorSalience >= context.parameters.accumulatedWakeSalience;
    const directUserMessage = context.signals.some(
      (signal) => signal.eventKind === "message.user"
        && signal.observation.sensing_basis === "direct_message",
    );
    const activityBoundary = context.currentActivity.continuation === "decision_required"
      || context.signals.some((signal) => signal.boundaryHint === "activity_boundary");

    let disposition: WakeDecisionV1["disposition"];
    let queueLane: WakeDecisionV1["queue_lane"];
    const reasons: WakeDecisionV1["reason_codes"] = [];
    const matchedRuleIds: string[] = [];
    const decisionSources: SourceRef[] = [...candidate.observation_refs];

    if (allInternal) {
      disposition = "ignore";
      queueLane = "none";
      reasons.push("non_recursive_internal_change");
    } else if (visibleHardInterrupts.length > 0) {
      disposition = "wake";
      queueLane = visibleHardInterrupts.some((item) => item.queueLane === "safety")
        ? "safety"
        : "reply";
      reasons.push("runtime_hard_interrupt");
      for (const interrupt of visibleHardInterrupts) {
        matchedRuleIds.push(interrupt.ruleId);
        decisionSources.push(...interrupt.observationRefs);
      }
    } else if (directUserMessage) {
      disposition = "wake";
      queueLane = "reply";
      reasons.push("observable_change");
    } else if (activityBoundary) {
      disposition = "wake";
      queueLane = "normal";
      reasons.push("current_activity_boundary");
      matchedRuleIds.push(context.currentActivity.activityId);
      decisionSources.push(...context.currentActivity.sourceRefs);
    } else if (matchingSubscriptions.length > 0) {
      disposition = "wake";
      queueLane = "normal";
      reasons.push("attention_subscription_match");
      for (const subscription of matchingSubscriptions) {
        matchedRuleIds.push(subscription.subscription_id);
        decisionSources.push(...subscription.evidence_refs);
      }
    } else if (accumulatedWake) {
      disposition = "wake";
      queueLane = "normal";
      reasons.push("accumulated_signal");
      for (const accumulation of matchingAccumulations) {
        matchedRuleIds.push(accumulation.accumulationId);
        decisionSources.push(...accumulation.sourceRefs);
      }
    } else if (currentSalience >= context.parameters.wakeSalience) {
      disposition = "wake";
      queueLane = "normal";
      reasons.push("observable_change");
    } else if (currentSalience >= context.parameters.accumulateSalience) {
      disposition = "accumulate";
      queueLane = "background";
      reasons.push("observable_change");
    } else {
      disposition = "ignore";
      queueLane = "none";
      reasons.push("no_material_change");
    }
    if (context.droppedDuplicateCount > 0) reasons.push("deduplicated");

    const observationRefs = normalizeSourceRefs(decisionSources);
    if (observationRefs.length > MAX_GATE_SOURCES) {
      throw new CognitiveAdmissionError("WakeDecision source closure exceeds v1 capacity");
    }
    const inputClosureHash = computeInputClosureHash(
      candidate.committed_revision,
      observationRefs,
    );
    const normalizedReasons = uniqueSorted(reasons);
    const normalizedRuleIds = uniqueSorted(matchedRuleIds);
    const decisionId = `wake-decision:${hashJson({
      contract: "gf.cognitive-gate.v1",
      candidate_id: candidate.candidate_id,
      disposition,
      queue_lane: queueLane,
      reason_codes: normalizedReasons,
      matched_rule_ids: normalizedRuleIds,
      observation_refs: observationRefs,
      gate_version: context.gateVersion,
      parameter_version: context.parameters.parameterVersion,
      base_state_revision: candidate.committed_revision,
      input_closure_hash: inputClosureHash,
      decided_at: context.decidedAt,
    })}`;
    return {
      schema_version: "1.0",
      decision_id: decisionId,
      candidate_id: candidate.candidate_id,
      actor_id: candidate.actor_id,
      disposition,
      queue_lane: queueLane,
      reason_codes: normalizedReasons,
      matched_rule_ids: normalizedRuleIds,
      observation_refs: observationRefs,
      gate_version: context.gateVersion,
      parameter_version: context.parameters.parameterVersion,
      base_state_revision: candidate.committed_revision,
      input_closure_hash: inputClosureHash,
      decided_at: context.decidedAt,
    };
  }
}

/** Executes ChangeAggregator -> Perception -> CognitiveGate for one window. */
export class CognitiveAdmissionPipeline {
  constructor(
    private readonly aggregator: ChangeAggregatorPort<
      CommittedAdmissionChange,
      ChangeAggregationContext,
      AggregatedChangeBatch
    >,
    private readonly perception: PerceptionPort<
      PerceptionProjectionInput,
      PerceptionProjectionResult
    >,
    private readonly gate: CognitiveGatePort<CognitiveGateContext>,
  ) {}

  evaluate(input: Readonly<CognitiveAdmissionInput>): CognitiveAdmissionResult {
    const batch = this.aggregator.aggregate(input.changes, input.aggregation);
    const signals: VisibleAdmissionSignal[] = [];
    for (const change of batch.changes) {
      const projection = this.perception.project({
        ...input.perception,
        candidates: [change.perceptionCandidate],
      });
      for (const observation of projection.observations) {
        signals.push({
          observation,
          aggregationKey: change.aggregationKey,
          eventKind: change.eventKind,
          entityIds: uniqueSorted(change.entityIds),
          locationIds: uniqueSorted(change.locationIds),
          salience: change.salience,
          boundaryHint: change.boundaryHint,
          recursiveInternal: change.recursiveInternal,
        });
      }
    }
    if (signals.length === 0) {
      return { batch, observations: [], candidate: null, decision: null };
    }
    const observationRefs = normalizeSourceRefs(
      signals.flatMap((signal) => signal.observation.source_refs),
    );
    if (observationRefs.length > MAX_GATE_SOURCES) {
      throw new CognitiveAdmissionError("WakeCandidate source closure exceeds v1 capacity");
    }
    const boundaryKind = classifyBoundary(signals, input.gate);
    const inputClosureHash = computeInputClosureHash(
      input.perception.base_state_revision,
      observationRefs,
    );
    const candidateId = `wake-candidate:${hashJson({
      contract: "gf.wake-candidate.v1",
      actor_id: input.perception.actor_id,
      committed_revision: input.perception.base_state_revision,
      observation_refs: observationRefs,
      boundary_kind: boundaryKind,
      occurred_at: input.perception.projected_at,
      input_closure_hash: inputClosureHash,
    })}`;
    const candidate: WakeCandidateV1 = {
      schema_version: "1.0",
      candidate_id: candidateId,
      actor_id: input.perception.actor_id,
      committed_revision: input.perception.base_state_revision,
      observation_refs: observationRefs,
      boundary_kind: boundaryKind,
      occurred_at: input.perception.projected_at,
      input_closure_hash: inputClosureHash,
    };
    const context: CognitiveGateContext = {
      ...input.gate,
      signals,
      droppedDuplicateCount: batch.droppedDuplicateCount,
    };
    return {
      batch,
      observations: signals.map((signal) => signal.observation),
      candidate,
      decision: this.gate.evaluate(candidate, context),
    };
  }
}

function classifyBoundary(
  signals: readonly VisibleAdmissionSignal[],
  context: Omit<CognitiveGateContext, "signals" | "droppedDuplicateCount">,
): WakeCandidateV1["boundary_kind"] {
  const keys = new Set(signals.flatMap((signal) =>
    signal.observation.source_refs.map(sourceKey)
  ));
  if (context.hardInterrupts.some((interrupt) =>
    interrupt.observationRefs.length > 0
    && interrupt.observationRefs.every((source) => keys.has(sourceKey(source)))
  )) return "runtime_hard_interrupt";
  if (
    context.currentActivity.continuation === "decision_required"
    || signals.some((signal) => signal.boundaryHint === "activity_boundary")
  ) return "activity_boundary";
  if (context.activeSubscriptions.some((subscription) =>
    subscriptionMatches(subscription, { ...context, signals, droppedDuplicateCount: 0 })
  )) return "attention_match";
  if (context.previousAccumulations.some((accumulation) =>
    signals.some((signal) => signal.aggregationKey === accumulation.aggregationKey)
  )) return "accumulated_signal";
  return "observable_change";
}

function subscriptionMatches(
  subscription: Readonly<AttentionSubscriptionV1>,
  context: Readonly<CognitiveGateContext>,
): boolean {
  if (
    subscription.status !== "active"
    || subscription.perception_only !== true
    || subscription.actor_id !== context.signals[0]?.observation.actor_id
    || (subscription.expires_at !== undefined
      && subscription.expires_at !== null
      && Date.parse(subscription.expires_at) <= Date.parse(context.decidedAt))
  ) return false;
  const filter = subscription.observable_filter;
  const dimensions = [
    filter.event_kinds.length === 0
      ? null
      : filter.event_kinds.every((value) =>
        context.signals.some((signal) => signal.eventKind === value)
      ),
    filter.entity_ids.length === 0
      ? null
      : filter.entity_ids.every((value) =>
        context.signals.some((signal) => signal.entityIds.includes(value))
      ),
    filter.location_ids.length === 0
      ? null
      : filter.location_ids.every((value) =>
        context.signals.some((signal) => signal.locationIds.includes(value))
      ),
  ].filter((value): value is boolean => value !== null);
  if (dimensions.length === 0) return false;
  return filter.match_mode === "all"
    ? dimensions.every(Boolean)
    : dimensions.some(Boolean);
}

function validateGateInput(
  candidate: Readonly<WakeCandidateV1>,
  context: Readonly<CognitiveGateContext>,
): void {
  if (context.signals.length === 0) {
    throw new CognitiveAdmissionError("CognitiveGate requires legal observations");
  }
  validateId(context.gateVersion, "gateVersion");
  validateId(context.parameters.parameterVersion, "parameterVersion");
  validateTimestamp(context.decidedAt, "decidedAt");
  if (Date.parse(context.decidedAt) < Date.parse(candidate.occurred_at)) {
    throw new CognitiveAdmissionError("Gate decision cannot precede its candidate");
  }
  for (const [label, value] of [
    ["wakeSalience", context.parameters.wakeSalience],
    ["accumulateSalience", context.parameters.accumulateSalience],
    ["accumulatedWakeCount", context.parameters.accumulatedWakeCount],
    ["accumulatedWakeSalience", context.parameters.accumulatedWakeSalience],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new CognitiveAdmissionError(`${label} must be finite and non-negative`);
    }
  }
  if (!Number.isInteger(context.parameters.accumulatedWakeCount)) {
    throw new CognitiveAdmissionError("accumulatedWakeCount must be an integer");
  }
  if (
    context.parameters.accumulatedWakeCount < 1
    || context.parameters.wakeSalience < context.parameters.accumulateSalience
  ) {
    throw new CognitiveAdmissionError("Gate thresholds are not monotonic");
  }
  validateId(context.currentActivity.activityId, "activityId");
  if (context.currentActivity.sourceRefs.length === 0) {
    throw new CognitiveAdmissionError("current Activity must remain source-linked");
  }
  for (const signal of context.signals) {
    if (
      signal.observation.actor_id !== candidate.actor_id
      || signal.observation.base_state_revision !== candidate.committed_revision
    ) {
      throw new CognitiveAdmissionError(
        "Gate observations must match candidate actor/revision",
      );
    }
  }
  for (const interrupt of context.hardInterrupts) {
    validateId(interrupt.ruleId, "hard interrupt ruleId");
    if (interrupt.observationRefs.length === 0) {
      throw new CognitiveAdmissionError("hard interrupt must cite an observation");
    }
  }
  for (const subscription of context.activeSubscriptions) {
    if (
      subscription.actor_id !== candidate.actor_id
      || subscription.base_state_revision > candidate.committed_revision
    ) {
      throw new CognitiveAdmissionError(
        "AttentionSubscription must match actor and not come from a future revision",
      );
    }
    if (
      subscription.expires_at !== undefined
      && subscription.expires_at !== null
      && !Number.isFinite(Date.parse(subscription.expires_at))
    ) {
      throw new CognitiveAdmissionError("AttentionSubscription expiry is invalid");
    }
  }
  for (const accumulation of context.previousAccumulations) {
    validateId(accumulation.accumulationId, "accumulationId");
    validateId(accumulation.aggregationKey, "accumulation aggregationKey");
    if (
      !Number.isInteger(accumulation.signalCount)
      || accumulation.signalCount < 1
      || !Number.isFinite(accumulation.salience)
      || accumulation.salience < 0
      || accumulation.sourceRefs.length === 0
    ) {
      throw new CognitiveAdmissionError("previous accumulation is invalid");
    }
  }
  const expectedRefs = normalizeSourceRefs(
    context.signals.flatMap((signal) => signal.observation.source_refs),
  );
  if (JSON.stringify(expectedRefs) !== JSON.stringify(
    normalizeSourceRefs(candidate.observation_refs),
  )) {
    throw new CognitiveAdmissionError("candidate observations do not match Gate input");
  }
  if (
    candidate.input_closure_hash !== computeInputClosureHash(
      candidate.committed_revision,
      candidate.observation_refs,
    )
  ) {
    throw new CognitiveAdmissionError("WakeCandidate has a forged input closure");
  }
}

function validateChange(
  change: Readonly<CommittedAdmissionChange>,
  context: Readonly<ChangeAggregationContext>,
): void {
  validateId(change.changeId, "changeId");
  validateId(change.aggregationKey, "aggregationKey");
  validateId(change.eventKind, "eventKind");
  if (!Number.isFinite(change.salience) || change.salience < 0) {
    throw new CognitiveAdmissionError("change salience must be finite and non-negative");
  }
  validateTimestamp(change.perceptionCandidate.occurred_at, "change occurredAt");
  const occurred = Date.parse(change.perceptionCandidate.occurred_at);
  if (
    occurred < Date.parse(context.windowStartedAt)
    || occurred > Date.parse(context.windowEndedAt)
  ) {
    throw new CognitiveAdmissionError(`change ${change.changeId} is outside its window`);
  }
}

function validateId(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) || value.length > 128) {
    throw new CognitiveAdmissionError(`${label} is not a valid id`);
  }
}

function validateTimestamp(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    throw new CognitiveAdmissionError(`${label} must be an ISO timestamp`);
  }
}

function sourceKey(source: SourceRef): string {
  return `${source.source_type}:${source.source_id}`;
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
