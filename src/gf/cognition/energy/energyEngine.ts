import { createHash } from "node:crypto";

import type {
  CognitiveCapacityEnvelopeV2,
  CognitiveEnergyAccountV1,
  CognitiveEnergyReservationV1,
  CognitiveEnergySettlementV1,
  SourceRef,
  WakeDecisionV1,
} from "../../generated/cognitiveRuntimeTypes.js";
import type {
  CognitiveBudgetPlannerPort,
  CognitiveCapacityLimiterPort,
  CognitiveEnergyEnginePort,
} from "../runtimePorts.js";

const EPSILON = 1e-9;

export class CognitiveCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CognitiveCapacityError";
  }
}

export interface EnergyRecoveryParameters {
  version: string;
  baseUnitsPerHour: number;
  protectedReplyReserveUnits: number;
}

export interface EnergyRecoveryContext {
  now: string;
  activityRecoveryFactor: number;
  physiologyRecoveryFactor: number;
  concurrentLoadFraction: number;
}

export interface BudgetPlanningContext {
  reservationId: string;
  promptRunId: string;
  purpose: CognitiveEnergyReservationV1["purpose"];
  accessClass: CognitiveEnergyReservationV1["access_class"];
  requestedNormalizedUnits: number;
  mandatorySemanticUnits: number;
  minimumExpressionUnits: number;
  accountingVersion: string;
  expiresAt: string;
  idempotencyKey: string;
}

export interface CapacityLimitContext {
  mandatorySemanticUnits: number;
  requestedOptionalSemanticUnits: number;
  requestedDeliberationUnits: number;
  minimumExpressionUnits: number;
  requestedExtraExpressionUnits: number;
  requestedToolRounds: number;
  deliberationUnitsPerToolRound: number;
}

function finiteNonnegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new CognitiveCapacityError(`${label} must be finite and nonnegative`);
  }
  return value;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function elapsedHours(from: string, to: string): number {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new CognitiveCapacityError("recovery timestamps must be valid and monotonic");
  }
  return (end - start) / 3_600_000;
}

/**
 * Pure numeric account transitions. `available` is free energy and `reserved`
 * is leased energy; their sum never exceeds capacity. Returned values are
 * proposals only and require StateManager commit.
 */
export class CognitiveEnergyEngine
  implements CognitiveEnergyEnginePort<EnergyRecoveryContext>
{
  constructor(private readonly recovery: Readonly<EnergyRecoveryParameters>) {
    finiteNonnegative(recovery.baseUnitsPerHour, "baseUnitsPerHour");
    finiteNonnegative(
      recovery.protectedReplyReserveUnits,
      "protectedReplyReserveUnits",
    );
  }

  proposeRecovery(
    account: Readonly<CognitiveEnergyAccountV1>,
    context: Readonly<EnergyRecoveryContext>,
  ): CognitiveEnergyAccountV1 {
    const hours = elapsedHours(account.recovered_at, context.now);
    const activity = finiteNonnegative(
      context.activityRecoveryFactor,
      "activityRecoveryFactor",
    );
    const physiology = finiteNonnegative(
      context.physiologyRecoveryFactor,
      "physiologyRecoveryFactor",
    );
    const concurrent = finiteNonnegative(
      context.concurrentLoadFraction,
      "concurrentLoadFraction",
    );
    if (concurrent > 1) {
      throw new CognitiveCapacityError("concurrentLoadFraction must be at most 1");
    }
    const recovered =
      hours * this.recovery.baseUnitsPerHour * activity * physiology * (1 - concurrent);
    const freeCapacity = Math.max(0, account.capacity - account.reserved);
    const available = round(Math.min(freeCapacity, account.available + recovered));
    return {
      ...account,
      available,
      protected_reply_reserve: round(
        Math.min(this.recovery.protectedReplyReserveUnits, available),
      ),
      recovered_at: context.now,
      recovery_model_version: this.recovery.version,
      revision: account.revision + (hours > 0 ? 1 : 0),
    };
  }

  proposeReservation(
    account: Readonly<CognitiveEnergyAccountV1>,
    reservation: Readonly<CognitiveEnergyReservationV1>,
  ): CognitiveEnergyAccountV1 {
    const amount = finiteNonnegative(
      reservation.max_normalized_token_units,
      "reservation amount",
    );
    if (amount > account.available + EPSILON) {
      throw new CognitiveCapacityError("reservation exceeds free energy");
    }
    if (
      reservation.access_class === "autonomous" &&
      amount > account.available - account.protected_reply_reserve + EPSILON
    ) {
      throw new CognitiveCapacityError("autonomous reservation enters reply reserve");
    }
    const available = round(account.available - amount);
    return {
      ...account,
      available,
      reserved: round(account.reserved + amount),
      protected_reply_reserve: round(
        Math.min(account.protected_reply_reserve, available),
      ),
      revision: account.revision + 1,
    };
  }

  proposeSettlement(
    account: Readonly<CognitiveEnergyAccountV1>,
    settlement: Readonly<CognitiveEnergySettlementV1>,
  ): CognitiveEnergyAccountV1 {
    const spent = finiteNonnegative(settlement.energy_spent, "energy_spent");
    const released = finiteNonnegative(
      settlement.released_reservation,
      "released_reservation",
    );
    const held = spent + released;
    if (held > account.reserved + EPSILON) {
      throw new CognitiveCapacityError("settlement exceeds reserved energy");
    }
    return {
      ...account,
      available: round(account.available + released),
      reserved: round(account.reserved - held),
      protected_reply_reserve: round(
        Math.min(account.protected_reply_reserve, account.available + released),
      ),
      revision: account.revision + 1,
    };
  }
}

export class CognitiveBudgetPlanner
  implements CognitiveBudgetPlannerPort<BudgetPlanningContext>
{
  plan(
    decision: Readonly<WakeDecisionV1>,
    account: Readonly<CognitiveEnergyAccountV1>,
    context: Readonly<BudgetPlanningContext>,
  ): CognitiveEnergyReservationV1 | null {
    if (decision.disposition !== "wake") {
      return null;
    }
    const requested = finiteNonnegative(
      context.requestedNormalizedUnits,
      "requestedNormalizedUnits",
    );
    const minimum =
      finiteNonnegative(context.mandatorySemanticUnits, "mandatorySemanticUnits") +
      finiteNonnegative(context.minimumExpressionUnits, "minimumExpressionUnits");
    const spendable = context.accessClass === "autonomous"
      ? Math.max(0, account.available - account.protected_reply_reserve)
      : account.available;
    if (minimum > spendable + EPSILON || minimum > requested + EPSILON) {
      return null;
    }
    return {
      schema_version: "1.0",
      reservation_id: context.reservationId,
      actor_id: account.actor_id,
      wake_decision_id: decision.decision_id,
      prompt_run_id: context.promptRunId,
      purpose: context.purpose,
      max_normalized_token_units: round(Math.min(requested, spendable)),
      access_class: context.accessClass,
      base_state_revision: decision.base_state_revision,
      accounting_version: context.accountingVersion,
      expires_at: context.expiresAt,
      idempotency_key: context.idempotencyKey,
    };
  }
}

function sourceKey(ref: SourceRef): string {
  return `${ref.source_type}:${ref.source_id}:${ref.quote_hash ?? ""}:${ref.observed_at ?? ""}`;
}

function uniqueSources(sources: readonly SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  const result: SourceRef[] = [];
  for (const source of sources) {
    const key = sourceKey(source);
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ ...source });
    }
  }
  if (result.length === 0) {
    throw new CognitiveCapacityError("mandatory source closure cannot be empty");
  }
  return result;
}

export class CognitiveCapacityLimiter
  implements CognitiveCapacityLimiterPort<CapacityLimitContext>
{
  limit(
    account: Readonly<CognitiveEnergyAccountV1>,
    reservation: Readonly<CognitiveEnergyReservationV1>,
    mandatorySources: readonly SourceRef[],
    context: Readonly<CapacityLimitContext>,
  ): CognitiveCapacityEnvelopeV2 {
    const mandatory = finiteNonnegative(
      context.mandatorySemanticUnits,
      "mandatorySemanticUnits",
    );
    const minimumExpression = finiteNonnegative(
      context.minimumExpressionUnits,
      "minimumExpressionUnits",
    );
    const budget = finiteNonnegative(
      reservation.max_normalized_token_units,
      "reservation budget",
    );
    if (mandatory + minimumExpression > budget + EPSILON) {
      throw new CognitiveCapacityError(
        "reservation cannot preserve mandatory closure and complete expression",
      );
    }

    let optional = finiteNonnegative(
      context.requestedOptionalSemanticUnits,
      "requestedOptionalSemanticUnits",
    );
    let deliberation = finiteNonnegative(
      context.requestedDeliberationUnits,
      "requestedDeliberationUnits",
    );
    let extraExpression = finiteNonnegative(
      context.requestedExtraExpressionUnits,
      "requestedExtraExpressionUnits",
    );
    let overflow = Math.max(
      0,
      mandatory + optional + deliberation + minimumExpression + extraExpression - budget,
    );
    const optionalReduction = Math.min(optional, overflow);
    optional -= optionalReduction;
    overflow -= optionalReduction;
    const deliberationReduction = Math.min(deliberation, overflow);
    deliberation -= deliberationReduction;
    overflow -= deliberationReduction;
    const expressionReduction = Math.min(extraExpression, overflow);
    extraExpression -= expressionReduction;

    const sources = uniqueSources(mandatorySources);
    const perRound = finiteNonnegative(
      context.deliberationUnitsPerToolRound,
      "deliberationUnitsPerToolRound",
    );
    const requestedRounds = Math.floor(
      finiteNonnegative(context.requestedToolRounds, "requestedToolRounds"),
    );
    const maxToolRounds = perRound === 0
      ? requestedRounds
      : Math.min(requestedRounds, Math.floor(deliberation / perRound));
    const envelopeSeed = JSON.stringify({
      actorId: account.actor_id,
      accountRevision: account.revision,
      reservationId: reservation.reservation_id,
      accountingVersion: reservation.accounting_version,
      mandatorySources: sources,
      mandatory,
      optional,
      deliberation,
      minimumExpression,
      extraExpression,
      maxToolRounds,
    });
    const digest = createHash("sha256").update(envelopeSeed).digest("hex");
    return {
      schema_version: "2.0",
      envelope_id: `capacity_envelope:${digest.slice(0, 32)}`,
      actor_id: account.actor_id,
      reservation_id: reservation.reservation_id,
      access_class: reservation.access_class,
      visibility: "engine_only",
      max_semantic_input_units: Math.floor(mandatory + optional),
      max_deliberation_units: Math.floor(deliberation),
      max_expression_units: Math.floor(minimumExpression + extraExpression),
      max_tool_rounds: maxToolRounds,
      mandatory_source_refs: sources,
      accounting_version: reservation.accounting_version,
      base_state_revision: reservation.base_state_revision,
    };
  }
}
