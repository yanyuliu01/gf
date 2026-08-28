import type {
  AttentionIntentV1,
  AttentionSubscriptionV1,
  CognitiveCapacityEnvelopeV2,
  CognitiveEnergyAccountV1,
  CognitiveEnergyReservationV1,
  CognitiveEnergySettlementV1,
  ExperiencedUsageBreakdownV1,
  InferenceUsageReceiptV1,
  SourceRef,
  WakeCandidateV1,
  WakeDecisionV1,
} from "../generated/cognitiveRuntimeTypes.js";

/** Purely aggregates committed changes. It neither senses hidden state nor writes audit rows. */
export interface ChangeAggregatorPort<
  TCommittedChange,
  TContext,
  TAggregate,
> {
  aggregate(
    changes: readonly TCommittedChange[],
    context: Readonly<TContext>,
  ): TAggregate;
}

/** Pure admission decision over a source-closed candidate and already assembled context. */
export interface CognitiveGatePort<TAttentionContext> {
  evaluate(
    candidate: Readonly<WakeCandidateV1>,
    context: Readonly<TAttentionContext>,
  ): WakeDecisionV1;
}

/** Pure compiler from open, source-linked intent into a perception-only watcher. */
export interface AttentionCompilerPort<TCompilerContext> {
  compile(
    intent: Readonly<AttentionIntentV1>,
    context: Readonly<TCompilerContext>,
  ): AttentionSubscriptionV1;
}

/** The only asynchronous attention port: it reads current activity and active subscriptions. */
export interface AttentionContextProviderPort<TQuery, TAttentionContext> {
  load(query: Readonly<TQuery>): Promise<TAttentionContext>;
}

/** Pure planner. A null result means admission cannot currently obtain a valid lease. */
export interface CognitiveBudgetPlannerPort<TPlanningContext> {
  plan(
    decision: Readonly<WakeDecisionV1>,
    account: Readonly<CognitiveEnergyAccountV1>,
    context: Readonly<TPlanningContext>,
  ): CognitiveEnergyReservationV1 | null;
}

/** Purely derives an engine-only envelope from a committed reservation. */
export interface CognitiveCapacityLimiterPort<TCapacityContext = object> {
  limit(
    account: Readonly<CognitiveEnergyAccountV1>,
    reservation: Readonly<CognitiveEnergyReservationV1>,
    mandatorySources: readonly SourceRef[],
    context: Readonly<TCapacityContext>,
  ): CognitiveCapacityEnvelopeV2;
}

/**
 * Pure account transition proposals. StateManager remains the only component
 * allowed to commit any returned account snapshot.
 */
export interface CognitiveEnergyEnginePort<TRecoveryContext> {
  proposeRecovery(
    account: Readonly<CognitiveEnergyAccountV1>,
    context: Readonly<TRecoveryContext>,
  ): CognitiveEnergyAccountV1;

  proposeReservation(
    account: Readonly<CognitiveEnergyAccountV1>,
    reservation: Readonly<CognitiveEnergyReservationV1>,
  ): CognitiveEnergyAccountV1;

  proposeSettlement(
    account: Readonly<CognitiveEnergyAccountV1>,
    settlement: Readonly<CognitiveEnergySettlementV1>,
  ): CognitiveEnergyAccountV1;
}

/** Purely classifies raw provider/local counters; it does not settle an account. */
export interface UsageClassifierPort<TClassificationContext> {
  classify(
    receipt: Readonly<InferenceUsageReceiptV1>,
    context: Readonly<TClassificationContext>,
  ): ExperiencedUsageBreakdownV1;
}

/** Pure settlement proposal. StateManager validates and commits it atomically. */
export interface UsageSettlementPort<TSettlementContext> {
  propose(
    account: Readonly<CognitiveEnergyAccountV1>,
    reservation: Readonly<CognitiveEnergyReservationV1>,
    receipt: Readonly<InferenceUsageReceiptV1>,
    breakdown: Readonly<ExperiencedUsageBreakdownV1>,
    context: Readonly<TSettlementContext>,
  ): CognitiveEnergySettlementV1;
}
