/**
 * M21-001: Commitment/Schedule Driver.
 *
 * Converts accepted obligations into due production demand and emits:
 * - conflict: when two commitments compete for the same capacity
 * - overdue: when a commitment passes its due_at time without fulfillment
 * - fulfilled: when a commitment's condition is satisfied
 * - broken: when a commitment becomes impossible to fulfill
 * - released: when a commitment is explicitly released by mutual agreement
 *
 * Per docs/invariants/19 B2-B3: Commitments are projections derived from the
 * ledger, not authoritative objects. The ledger utterance is the fact, status
 * is recomputed rather than written by any proposer.
 */

import type { CommitmentV1, SourceRef } from "../generated/agentPipelineTypes.js";
import { createHash } from "node:crypto";
import { newId, utcnowIso } from "../domain/ids.js";
import {
  computeInputClosureHash,
  normalizeSourceRefs,
} from "../validation/derivedInputClosure.js";

export type CommitmentEventKind =
  | "conflict"
  | "overdue"
  | "fulfilled"
  | "broken"
  | "released";

export interface CommitmentEvent {
  eventId: string;
  eventKind: CommitmentEventKind;
  commitmentIds: readonly string[];
  content: string;
  occurredAt: string;
  sourceRefs: readonly SourceRef[];
}

export interface ProductionDemand {
  demandId: string;
  commitmentId: string;
  requiredOutputTypeId: string;
  requiredAmount: number;
  dueAt: string | null;
  priority: number;
  sourceRefs: readonly SourceRef[];
}

export interface ScheduleConflict {
  conflictId: string;
  commitmentIds: readonly string[];
  capacityTypeId: string;
  intervalStart: string;
  intervalEnd: string;
  totalDemand: number;
  availableCapacity: number;
  sourceRefs: readonly SourceRef[];
}

export interface CommitmentLedgerEntry {
  entryId: string;
  commitmentId: string;
  subjectId: string;
  objectId: string;
  content: string;
  condition: string | null;
  dueAt: string | null;
  createdAt: string;
  sourceRefs: readonly SourceRef[];
}

export interface FulfillmentEvidence {
  commitmentId: string;
  eventRefs: readonly SourceRef[];
  fulfilledAt: string;
}

export interface ReleaseEvidence {
  commitmentId: string;
  releasedBy: string;
  eventRefs: readonly SourceRef[];
  releasedAt: string;
}

export interface BrokenEvidence {
  commitmentId: string;
  reason: string;
  eventRefs: readonly SourceRef[];
  brokenAt: string;
}

export interface DriverConfig {
  driverVersion: string;
  idempotencyWindow: number;
}

export interface DriverState {
  ledgerEntries: Map<string, CommitmentLedgerEntry>;
  fulfillments: Map<string, FulfillmentEvidence>;
  releases: Map<string, ReleaseEvidence>;
  broken: Map<string, BrokenEvidence>;
  processedEventKeys: Set<string>;
  revision: number;
}

export interface EvaluationContext {
  currentTime: string;
  baseStateRevision: number;
  processCompletions: Map<string, { outputTypeId: string; amount: number; completedAt: string }>;
  capacityAvailability: Map<string, { available: number; reserved: number }>;
}

export interface EvaluationResult {
  events: readonly CommitmentEvent[];
  demands: readonly ProductionDemand[];
  conflicts: readonly ScheduleConflict[];
  updatedState: DriverState;
}

export class CommitmentDriver {
  private state: DriverState;
  private config: DriverConfig;

  constructor(config: DriverConfig) {
    this.config = config;
    this.state = {
      ledgerEntries: new Map(),
      fulfillments: new Map(),
      releases: new Map(),
      broken: new Map(),
      processedEventKeys: new Set(),
      revision: 0,
    };
  }

  getState(): Readonly<DriverState> {
    return this.state;
  }

  recordCommitment(entry: CommitmentLedgerEntry): void {
    const eventKey = this.computeEventKey("record", entry.entryId);
    if (this.state.processedEventKeys.has(eventKey)) return;

    this.state.ledgerEntries.set(entry.commitmentId, { ...entry });
    this.state.processedEventKeys.add(eventKey);
    this.state.revision++;
  }

  recordFulfillment(evidence: FulfillmentEvidence): void {
    const eventKey = this.computeEventKey("fulfill", evidence.commitmentId);
    if (this.state.processedEventKeys.has(eventKey)) return;

    this.state.fulfillments.set(evidence.commitmentId, { ...evidence });
    this.state.processedEventKeys.add(eventKey);
    this.state.revision++;
  }

  recordRelease(evidence: ReleaseEvidence): void {
    const eventKey = this.computeEventKey("release", evidence.commitmentId);
    if (this.state.processedEventKeys.has(eventKey)) return;

    this.state.releases.set(evidence.commitmentId, { ...evidence });
    this.state.processedEventKeys.add(eventKey);
    this.state.revision++;
  }

  recordBroken(evidence: BrokenEvidence): void {
    const eventKey = this.computeEventKey("broken", evidence.commitmentId);
    if (this.state.processedEventKeys.has(eventKey)) return;

    this.state.broken.set(evidence.commitmentId, { ...evidence });
    this.state.processedEventKeys.add(eventKey);
    this.state.revision++;
  }

  evaluate(context: EvaluationContext): EvaluationResult {
    const events: CommitmentEvent[] = [];
    const demands: ProductionDemand[] = [];
    const conflicts: ScheduleConflict[] = [];

    for (const [commitmentId, entry] of this.state.ledgerEntries) {
      if (this.state.fulfillments.has(commitmentId)) continue;
      if (this.state.releases.has(commitmentId)) continue;
      if (this.state.broken.has(commitmentId)) continue;

      const overdueEvent = this.checkOverdue(entry, context);
      if (overdueEvent) {
        events.push(overdueEvent);
        continue;
      }

      const fulfillmentEvent = this.checkFulfillment(entry, context);
      if (fulfillmentEvent) {
        events.push(fulfillmentEvent);
        continue;
      }

      const demand = this.deriveProductionDemand(entry, context);
      if (demand) {
        demands.push(demand);
      }
    }

    const capacityConflicts = this.detectCapacityConflicts(demands, context);
    for (const conflict of capacityConflicts) {
      conflicts.push(conflict);
      events.push({
        eventId: newId("cevt"),
        eventKind: "conflict",
        commitmentIds: conflict.commitmentIds,
        content: `Capacity conflict for ${conflict.capacityTypeId}: demand ${conflict.totalDemand} exceeds available ${conflict.availableCapacity}`,
        occurredAt: context.currentTime,
        sourceRefs: conflict.sourceRefs,
      });
    }

    return {
      events,
      demands,
      conflicts,
      updatedState: { ...this.state },
    };
  }

  projectCommitment(
    entry: CommitmentLedgerEntry,
    context: EvaluationContext,
  ): CommitmentV1 {
    type EventSourceRef = { source_type: "event"; source_id: string };
    let status: CommitmentV1["status"] = "active";
    let fulfillmentEventRefs: EventSourceRef[] = [];
    let brokenEventRefs: EventSourceRef[] = [];
    let releasedEventRefs: EventSourceRef[] = [];

    const fulfillment = this.state.fulfillments.get(entry.commitmentId);
    const broken = this.state.broken.get(entry.commitmentId);
    const release = this.state.releases.get(entry.commitmentId);

    if (fulfillment) {
      status = "fulfilled";
      fulfillmentEventRefs = fulfillment.eventRefs
        .filter((r): r is EventSourceRef => r.source_type === "event")
        .map((r) => ({ source_type: "event" as const, source_id: r.source_id }));
    } else if (broken) {
      status = "broken";
      brokenEventRefs = broken.eventRefs
        .filter((r): r is EventSourceRef => r.source_type === "event")
        .map((r) => ({ source_type: "event" as const, source_id: r.source_id }));
    } else if (release) {
      status = "released";
      releasedEventRefs = release.eventRefs
        .filter((r): r is EventSourceRef => r.source_type === "event")
        .map((r) => ({ source_type: "event" as const, source_id: r.source_id }));
    } else if (entry.dueAt && new Date(entry.dueAt) < new Date(context.currentTime)) {
      status = "broken";
      brokenEventRefs = [{ source_type: "event" as const, source_id: newId("evt") }];
    }

    const sourceRefs = normalizeSourceRefs(entry.sourceRefs);
    const inputClosureHash = computeInputClosureHash(context.baseStateRevision, sourceRefs);

    return {
      schema_version: "1.0",
      commitment_id: entry.commitmentId,
      subject_id: entry.subjectId,
      object_id: entry.objectId,
      content: entry.content,
      condition: entry.condition,
      due_at: entry.dueAt,
      status,
      source_refs: sourceRefs,
      fulfillment_event_refs: fulfillmentEventRefs,
      broken_event_refs: brokenEventRefs,
      released_event_refs: releasedEventRefs,
      debt_id: null,
      derived_from_ledger: true,
      projection_scope: "adjudication_audit_only",
      projection_version: this.config.driverVersion,
      base_state_revision: context.baseStateRevision,
      input_closure_hash: inputClosureHash,
      derived_at: context.currentTime,
    };
  }

  private checkOverdue(
    entry: CommitmentLedgerEntry,
    context: EvaluationContext,
  ): CommitmentEvent | null {
    if (!entry.dueAt) return null;

    const dueTime = new Date(entry.dueAt).getTime();
    const currentTime = new Date(context.currentTime).getTime();

    if (currentTime <= dueTime) return null;

    const eventKey = this.computeEventKey("overdue", entry.commitmentId);
    if (this.state.processedEventKeys.has(eventKey)) return null;

    this.state.processedEventKeys.add(eventKey);

    return {
      eventId: newId("cevt"),
      eventKind: "overdue",
      commitmentIds: [entry.commitmentId],
      content: `Commitment overdue: ${entry.content}`,
      occurredAt: context.currentTime,
      sourceRefs: entry.sourceRefs,
    };
  }

  private checkFulfillment(
    entry: CommitmentLedgerEntry,
    context: EvaluationContext,
  ): CommitmentEvent | null {
    if (!entry.condition) return null;

    const conditionMet = this.evaluateCondition(entry.condition, context);
    if (!conditionMet) return null;

    const eventKey = this.computeEventKey("fulfilled", entry.commitmentId);
    if (this.state.processedEventKeys.has(eventKey)) return null;

    this.state.processedEventKeys.add(eventKey);
    this.state.fulfillments.set(entry.commitmentId, {
      commitmentId: entry.commitmentId,
      eventRefs: [{ source_type: "event", source_id: newId("evt") }],
      fulfilledAt: context.currentTime,
    });

    return {
      eventId: newId("cevt"),
      eventKind: "fulfilled",
      commitmentIds: [entry.commitmentId],
      content: `Commitment fulfilled: ${entry.content}`,
      occurredAt: context.currentTime,
      sourceRefs: entry.sourceRefs,
    };
  }

  private evaluateCondition(
    condition: string,
    context: EvaluationContext,
  ): boolean {
    const match = condition.match(/^deliver:(\w+):(\d+)$/);
    if (!match) return false;

    const [, outputTypeId, requiredAmountStr] = match;
    const requiredAmount = parseInt(requiredAmountStr, 10);

    let deliveredAmount = 0;
    for (const [, completion] of context.processCompletions) {
      if (completion.outputTypeId === outputTypeId) {
        deliveredAmount += completion.amount;
      }
    }

    return deliveredAmount >= requiredAmount;
  }

  private deriveProductionDemand(
    entry: CommitmentLedgerEntry,
    context: EvaluationContext,
  ): ProductionDemand | null {
    if (!entry.condition) return null;

    const match = entry.condition.match(/^deliver:(\w+):(\d+)$/);
    if (!match) return null;

    const [, outputTypeId, requiredAmountStr] = match;
    const requiredAmount = parseInt(requiredAmountStr, 10);

    let deliveredAmount = 0;
    for (const [, completion] of context.processCompletions) {
      if (completion.outputTypeId === outputTypeId) {
        deliveredAmount += completion.amount;
      }
    }

    const remainingAmount = requiredAmount - deliveredAmount;
    if (remainingAmount <= 0) return null;

    const priority = entry.dueAt ? this.computePriority(entry.dueAt, context.currentTime) : 50;

    return {
      demandId: newId("dem"),
      commitmentId: entry.commitmentId,
      requiredOutputTypeId: outputTypeId,
      requiredAmount: remainingAmount,
      dueAt: entry.dueAt,
      priority,
      sourceRefs: entry.sourceRefs,
    };
  }

  private computePriority(dueAt: string, currentTime: string): number {
    const dueTime = new Date(dueAt).getTime();
    const current = new Date(currentTime).getTime();
    const hoursUntilDue = (dueTime - current) / (1000 * 60 * 60);

    if (hoursUntilDue < 0) return 100;
    if (hoursUntilDue < 24) return 90;
    if (hoursUntilDue < 72) return 70;
    if (hoursUntilDue < 168) return 50;
    return 30;
  }

  private detectCapacityConflicts(
    demands: readonly ProductionDemand[],
    context: EvaluationContext,
  ): ScheduleConflict[] {
    const conflicts: ScheduleConflict[] = [];
    const demandsByCapacity = new Map<string, ProductionDemand[]>();

    for (const demand of demands) {
      const capacityTypeId = demand.requiredOutputTypeId;
      if (!demandsByCapacity.has(capacityTypeId)) {
        demandsByCapacity.set(capacityTypeId, []);
      }
      demandsByCapacity.get(capacityTypeId)!.push(demand);
    }

    for (const [capacityTypeId, capacityDemands] of demandsByCapacity) {
      const availability = context.capacityAvailability.get(capacityTypeId);
      if (!availability) continue;

      const totalDemand = capacityDemands.reduce((sum, d) => sum + d.requiredAmount, 0);
      if (totalDemand <= availability.available - availability.reserved) continue;

      const sourceRefs: SourceRef[] = capacityDemands.flatMap((d) => [...d.sourceRefs]);

      conflicts.push({
        conflictId: newId("cfl"),
        commitmentIds: capacityDemands.map((d) => d.commitmentId),
        capacityTypeId,
        intervalStart: context.currentTime,
        intervalEnd: capacityDemands[0]?.dueAt ?? context.currentTime,
        totalDemand,
        availableCapacity: availability.available - availability.reserved,
        sourceRefs: normalizeSourceRefs(sourceRefs),
      });
    }

    return conflicts;
  }

  private computeEventKey(action: string, entityId: string): string {
    return `${action}:${entityId}`;
  }
}
