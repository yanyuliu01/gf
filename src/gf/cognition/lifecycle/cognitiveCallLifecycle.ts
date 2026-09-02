import type {
  CognitiveCapacityEnvelopeV2,
  CognitiveEnergyAccountV1,
  CognitiveEnergyReservationV1,
  CognitiveEnergySettlementV1,
  ExperiencedUsageBreakdownV1,
  InferenceUsageReceiptV1,
  SourceRef,
} from "../../generated/cognitiveRuntimeTypes.js";
import type {
  PromptRunFinished,
  PromptRunStarted,
} from "../../inference/base.js";
import type {
  CognitiveEnergyEnginePort,
  UsageClassifierPort,
  UsageSettlementPort,
} from "../runtimePorts.js";
import type { StateManager } from "../../state/stateManager.js";

export interface AcceptedInferenceResult<T> {
  value: T;
  receipt: InferenceUsageReceiptV1;
  promptRunFinished: PromptRunFinished;
  capacityApplication: {
    semanticInput: "applied";
    expression: "applied";
    deliberation: "applied" | "unsupported_explicit";
    toolRounds: "applied" | "unsupported_explicit";
  };
}

export interface CognitiveCallPlan<
  T,
  TClassificationContext,
  TSettlementContext,
> {
  reservation: CognitiveEnergyReservationV1;
  reservedAccount: CognitiveEnergyAccountV1;
  capacityEnvelope: CognitiveCapacityEnvelopeV2;
  promptRunStarted: PromptRunStarted;
  baseStateRevision: number;
  inputSources: readonly SourceRef[];
  classificationContext: TClassificationContext;
  settlementContext: TSettlementContext;
  failureFinishedAt: string;
  run(
    envelope: Readonly<CognitiveCapacityEnvelopeV2>,
  ): Promise<AcceptedInferenceResult<T>>;
}

export interface CognitiveCallResult<T> {
  value: T;
  receipt: InferenceUsageReceiptV1;
  breakdown: ExperiencedUsageBreakdownV1;
  settlement: CognitiveEnergySettlementV1;
  account: CognitiveEnergyAccountV1;
}

/**
 * Reserve -> close transaction -> await model -> classify -> settle.
 * CapacityEnvelope is passed only as a separate engine argument and is never
 * appended to model-visible context by this lifecycle.
 */
export class CognitiveCallLifecycle<
  TClassificationContext,
  TSettlementContext,
> {
  constructor(
    private readonly stateManager: StateManager,
    private readonly energy: CognitiveEnergyEnginePort<unknown>,
    private readonly classifier: UsageClassifierPort<TClassificationContext>,
    private readonly settlement: UsageSettlementPort<TSettlementContext>,
  ) {}

  async execute<T>(
    plan: CognitiveCallPlan<T, TClassificationContext, TSettlementContext>,
  ): Promise<CognitiveCallResult<T>> {
    if (
      plan.capacityEnvelope.reservation_id !== plan.reservation.reservation_id
      || plan.capacityEnvelope.actor_id !== plan.reservation.actor_id
      || plan.capacityEnvelope.access_class !== plan.reservation.access_class
      || plan.capacityEnvelope.base_state_revision
        !== plan.reservation.base_state_revision
      || plan.baseStateRevision !== plan.reservation.base_state_revision
      || plan.promptRunStarted.runId !== plan.reservation.prompt_run_id
    ) {
      throw new Error("cognitive call plan has inconsistent lease boundaries");
    }
    this.stateManager.reserveCognitiveCall(
      plan.reservation,
      plan.reservedAccount,
      plan.promptRunStarted,
    );

    try {
      // Deliberately the only await: StateManager's reserve transaction is
      // already committed and closed before provider execution begins.
      const inference = await plan.run(plan.capacityEnvelope);
      if (inference.receipt.prompt_run_id !== plan.reservation.prompt_run_id) {
        throw new Error("inference receipt belongs to a different prompt run");
      }
      if (
        inference.promptRunFinished.runId !== plan.reservation.prompt_run_id
        || inference.promptRunFinished.status !== "validated"
      ) {
        throw new Error("accepted call requires a validated prompt result");
      }
      if (
        inference.capacityApplication.semanticInput !== "applied"
        || inference.capacityApplication.expression !== "applied"
      ) {
        throw new Error("mandatory capacity limits were not applied");
      }
      if (
        plan.capacityEnvelope.max_deliberation_units > 0
        && !["applied", "unsupported_explicit"].includes(
          inference.capacityApplication.deliberation,
        )
      ) {
        throw new Error("deliberation capacity degradation was not declared");
      }
      if (
        plan.capacityEnvelope.max_tool_rounds > 0
        && !["applied", "unsupported_explicit"].includes(
          inference.capacityApplication.toolRounds,
        )
      ) {
        throw new Error("tool capacity degradation was not declared");
      }
      this.stateManager.recordInferenceUsageReceipt(inference.receipt);
      const breakdown = this.classifier.classify(
        inference.receipt,
        plan.classificationContext,
      );
      this.stateManager.recordExperiencedUsageBreakdown(breakdown, {
        baseStateRevision: plan.baseStateRevision,
        inputSources: plan.inputSources,
        classifiedAt: inference.receipt.received_at,
      });
      const current = this.stateManager.getCognitiveEnergyAccount(
        plan.reservation.actor_id,
      );
      if (!current) {
        throw new Error("reserved cognitive energy account disappeared");
      }
      const settlement = this.settlement.propose(
        current,
        plan.reservation,
        inference.receipt,
        breakdown,
        plan.settlementContext,
      );
      const settledAccount = this.energy.proposeSettlement(current, settlement);
      const committed = this.stateManager.settleCognitiveCall(
        settlement,
        settledAccount,
      );
      this.stateManager.recordPromptRunFinished(inference.promptRunFinished);
      return {
        value: inference.value,
        receipt: inference.receipt,
        breakdown,
        settlement,
        account: committed.account,
      };
    } catch (error) {
      this.stateManager.releaseCognitiveReservation(
        plan.reservation.reservation_id,
      );
      this.stateManager.recordPromptRunFinished({
        runId: plan.reservation.prompt_run_id,
        status: "failed",
        outputHash: null,
        errorCode: "cognitive_call_failed",
        finishedAt: plan.failureFinishedAt,
      });
      throw error;
    }
  }
}
