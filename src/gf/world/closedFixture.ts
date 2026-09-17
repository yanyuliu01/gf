/**
 * M21-010: Closed Fixture for World Simulation.
 *
 * Implements the full pipeline: WorldClock -> WorldEngine.step -> StateManager
 * commit -> Perception -> CognitiveGate. Activity/Process work advances without
 * continuous Policy calls. Offline and stepwise execution match.
 *
 * Uses OWN-001-approved docs/16 engineering defaults:
 * - simulation_fixture_v1 normalized Day-0 values
 * - A2-A5 (action/NPC/ordinary-day/failure) semantics
 * - S-4 cultivation/observation process definitions
 */

import type {
  ResourceTypeV1,
  ResourceAccountV1,
  ProcessDefinitionV1,
  ProcessInstanceV1,
  ActivityRecordV1,
  WorldStepInputV1,
  WorldStepResultV1,
  WorldCommandV1,
  SourceRef,
} from "../generated/worldRuntimeTypes.js";
import type { ObservationV1 } from "../generated/agentPipelineTypes.js";
import type { WakeDecisionV1 } from "../generated/cognitiveRuntimeTypes.js";
import { WorldEngine, type WorldSnapshot } from "./worldEngine.js";
import { ResourceLedger, type LedgerConfig } from "./resourceLedger.js";
import {
  PerceptionProjector,
  type PerceptionCandidate,
  type PerceptionProjectionInput,
} from "../cognition/perception/perceptionProjector.js";
import {
  ChangeAggregator,
  CognitiveGate,
  CognitiveAdmissionPipeline,
  type CommittedAdmissionChange,
  type CognitiveAdmissionInput,
  type CognitiveAdmissionResult,
  type CognitiveGateParameters,
  type CurrentActivityAdmissionContext,
} from "../cognition/admission/cognitiveAdmission.js";
import type { DatabaseSync } from "../state/db.js";
import { newId, utcnowIso } from "../domain/ids.js";

export interface WorldClockState {
  currentTime: string;
  currentDay: number;
  currentPhase: "morning" | "afternoon" | "evening" | "night";
  stepCount: number;
}

export interface FixtureConfig {
  actorId: string;
  actorLocationId: string;
  startTime: string;
  stepDurationMinutes: number;
  maxSteps: number;
  randomSeed: string;
  fixtureVersion: string;
}

export interface StepResult {
  clockBefore: WorldClockState;
  clockAfter: WorldClockState;
  worldStepResult: WorldStepResultV1;
  admissionResult: CognitiveAdmissionResult | null;
  woke: boolean;
  observations: ObservationV1[];
  decision: WakeDecisionV1 | null;
}

export interface FixtureRunResult {
  steps: StepResult[];
  totalSteps: number;
  wakeCount: number;
  ignoreCount: number;
  accumulateCount: number;
  finalClock: WorldClockState;
  processCompletions: number;
  processFailures: number;
}

const NDD = 100;
const RCU = 10;

export function createDay0ResourceTypes(): ResourceTypeV1[] {
  return [
    {
      schema_version: "1.0",
      resource_type_id: "clean_water",
      law: "stock",
      unit: "liter",
      min_balance: 0,
      version: "v1",
    },
    {
      schema_version: "1.0",
      resource_type_id: "energy",
      law: "capacity",
      unit: "kWh",
      version: "v1",
    },
    {
      schema_version: "1.0",
      resource_type_id: "cultivation_supplies",
      law: "stock",
      unit: "batch",
      min_balance: 0,
      version: "v1",
    },
    {
      schema_version: "1.0",
      resource_type_id: "pump_spare_parts",
      law: "stock",
      unit: "item",
      min_balance: 0,
      version: "v1",
    },
    {
      schema_version: "1.0",
      resource_type_id: "budget",
      law: "currency",
      unit: "credit",
      version: "v1",
    },
    {
      schema_version: "1.0",
      resource_type_id: "researcher_time",
      law: "capacity",
      unit: "person-minute",
      version: "v1",
    },
    {
      schema_version: "1.0",
      resource_type_id: "technician_time",
      law: "capacity",
      unit: "technician-minute",
      version: "v1",
    },
    {
      schema_version: "1.0",
      resource_type_id: "director_time",
      law: "capacity",
      unit: "minute",
      version: "v1",
    },
    {
      schema_version: "1.0",
      resource_type_id: "bench_time",
      law: "capacity",
      unit: "bench-minute",
      version: "v1",
    },
    {
      schema_version: "1.0",
      resource_type_id: "device_time",
      law: "capacity",
      unit: "device-minute",
      version: "v1",
    },
    {
      schema_version: "1.0",
      resource_type_id: "pump_health",
      law: "condition",
      unit: "ratio",
      min_balance: 0,
      max_balance: 1,
      version: "v1",
    },
    {
      schema_version: "1.0",
      resource_type_id: "device_health",
      law: "condition",
      unit: "ratio",
      min_balance: 0,
      max_balance: 1,
      version: "v1",
    },
    {
      schema_version: "1.0",
      resource_type_id: "s4_health",
      law: "condition",
      unit: "ratio",
      min_balance: 0,
      max_balance: 1,
      version: "v1",
    },
    {
      schema_version: "1.0",
      resource_type_id: "s4_stress",
      law: "condition",
      unit: "ratio",
      min_balance: 0,
      max_balance: 1,
      version: "v1",
    },
    {
      schema_version: "1.0",
      resource_type_id: "body_energy",
      law: "condition",
      unit: "ratio",
      min_balance: 0,
      max_balance: 1,
      version: "v1",
    },
    {
      schema_version: "1.0",
      resource_type_id: "sleep_pressure",
      law: "condition",
      unit: "ratio",
      min_balance: 0,
      max_balance: 1,
      version: "v1",
    },
    {
      schema_version: "1.0",
      resource_type_id: "cognition_capacity",
      law: "capacity",
      unit: "cognition-minute",
      version: "v1",
    },
    {
      schema_version: "1.0",
      resource_type_id: "manifestation_load",
      law: "capacity",
      unit: "load-unit",
      version: "v1",
    },
    {
      schema_version: "1.0",
      resource_type_id: "observation_data",
      law: "information",
      unit: "artifact",
      version: "v1",
    },
  ];
}

export function createDay0Accounts(): Omit<ResourceAccountV1, "revision">[] {
  return [
    {
      schema_version: "1.0",
      account_id: "acc_garden_water",
      resource_type_id: "clean_water",
      owner_id: "ecology_garden",
      balance: 3.0 * NDD,
      reserved: 0,
    },
    {
      schema_version: "1.0",
      account_id: "acc_daily_energy",
      resource_type_id: "energy",
      owner_id: "ecology_dept",
      balance: 1.25 * NDD,
      reserved: 0,
    },
    {
      schema_version: "1.0",
      account_id: "acc_cultivation_supplies",
      resource_type_id: "cultivation_supplies",
      owner_id: "ecology_dept",
      balance: 12,
      reserved: 0,
    },
    {
      schema_version: "1.0",
      account_id: "acc_pump_spares",
      resource_type_id: "pump_spare_parts",
      owner_id: "ecology_garden",
      balance: 1,
      reserved: 0,
    },
    {
      schema_version: "1.0",
      account_id: "acc_dept_budget",
      resource_type_id: "budget",
      owner_id: "ecology_dept",
      balance: 40 * RCU,
      reserved: 0,
    },
    {
      schema_version: "1.0",
      account_id: "acc_researcher_time",
      resource_type_id: "researcher_time",
      owner_id: "ecology_dept",
      balance: 1440,
      reserved: 0,
    },
    {
      schema_version: "1.0",
      account_id: "acc_technician_time",
      resource_type_id: "technician_time",
      owner_id: "rhine_facilities",
      balance: 240,
      reserved: 0,
    },
    {
      schema_version: "1.0",
      account_id: "acc_director_time",
      resource_type_id: "director_time",
      owner_id: "muelsyse",
      balance: 300,
      reserved: 0,
    },
    {
      schema_version: "1.0",
      account_id: "acc_bench_time",
      resource_type_id: "bench_time",
      owner_id: "ecology_garden",
      balance: 960,
      reserved: 0,
    },
    {
      schema_version: "1.0",
      account_id: "acc_device_time",
      resource_type_id: "device_time",
      owner_id: "ecology_garden",
      balance: 600,
      reserved: 0,
    },
    {
      schema_version: "1.0",
      account_id: "acc_pump_health",
      resource_type_id: "pump_health",
      owner_id: "ecology_garden",
      balance: 0.62,
      reserved: 0,
    },
    {
      schema_version: "1.0",
      account_id: "acc_device_health",
      resource_type_id: "device_health",
      owner_id: "ecology_garden",
      balance: 0.78,
      reserved: 0,
    },
    {
      schema_version: "1.0",
      account_id: "acc_s4_health",
      resource_type_id: "s4_health",
      owner_id: "ecology_garden",
      balance: 0.48,
      reserved: 0,
    },
    {
      schema_version: "1.0",
      account_id: "acc_s4_stress",
      resource_type_id: "s4_stress",
      owner_id: "ecology_garden",
      balance: 0.35,
      reserved: 0,
    },
    {
      schema_version: "1.0",
      account_id: "acc_body_energy",
      resource_type_id: "body_energy",
      owner_id: "muelsyse",
      balance: 0.72,
      reserved: 0,
    },
    {
      schema_version: "1.0",
      account_id: "acc_sleep_pressure",
      resource_type_id: "sleep_pressure",
      owner_id: "muelsyse",
      balance: 0.28,
      reserved: 0,
    },
    {
      schema_version: "1.0",
      account_id: "acc_cognition",
      resource_type_id: "cognition_capacity",
      owner_id: "muelsyse",
      balance: 480,
      reserved: 0,
    },
    {
      schema_version: "1.0",
      account_id: "acc_manifestation",
      resource_type_id: "manifestation_load",
      owner_id: "muelsyse",
      balance: 100,
      reserved: 0,
    },
  ];
}

export function createProcessDefinitions(): ProcessDefinitionV1[] {
  return [
    {
      schema_version: "1.0",
      definition_id: "s4_daily_cultivation",
      version: "v1",
      inputs: [
        { resource_type_id: "clean_water", amount: 0.08 * NDD },
        { resource_type_id: "energy", amount: 0.02 * NDD },
      ],
      outputs: [],
      capacities: [
        { resource_type_id: "researcher_time", amount_per_unit_time: 15, time_unit: "day" },
        { resource_type_id: "bench_time", amount_per_unit_time: 1440, time_unit: "day" },
      ],
      duration_model: "1 day",
      output_model: "s4_growth_equation",
      failure_model: "10%",
      interruptibility: "lossy",
    },
    {
      schema_version: "1.0",
      definition_id: "s4_observation",
      version: "v1",
      inputs: [],
      outputs: [{ resource_type_id: "observation_data", amount: 1 }],
      capacities: [
        { resource_type_id: "researcher_time", amount_per_unit_time: 30, time_unit: "hour" },
        { resource_type_id: "device_time", amount_per_unit_time: 20, time_unit: "hour" },
        { resource_type_id: "cognition_capacity", amount_per_unit_time: 15, time_unit: "hour" },
      ],
      duration_model: "30-60 minutes",
      output_model: "noisy_observation",
      failure_model: "5%",
      interruptibility: "safe",
    },
    {
      schema_version: "1.0",
      definition_id: "report_review",
      version: "v1",
      inputs: [{ resource_type_id: "observation_data", amount: 1 }],
      outputs: [],
      capacities: [
        { resource_type_id: "director_time", amount_per_unit_time: 45, time_unit: "hour" },
      ],
      duration_model: "30-90 minutes",
      output_model: "approval_decision",
      failure_model: "2%",
      interruptibility: "safe",
    },
    {
      schema_version: "1.0",
      definition_id: "circulation_pump_maintenance",
      version: "v1",
      inputs: [{ resource_type_id: "pump_spare_parts", amount: 1 }],
      outputs: [],
      capacities: [
        { resource_type_id: "technician_time", amount_per_unit_time: 120, time_unit: "hour" },
      ],
      duration_model: "2-4 hours",
      output_model: "health_restoration",
      failure_model: "5%",
      interruptibility: "none",
    },
  ];
}

export class WorldClock {
  private _currentTime: Date;
  private _stepCount: number = 0;

  constructor(startTime: string) {
    this._currentTime = new Date(startTime);
  }

  get state(): WorldClockState {
    const hour = this._currentTime.getUTCHours();
    let phase: WorldClockState["currentPhase"];
    if (hour >= 6 && hour < 12) phase = "morning";
    else if (hour >= 12 && hour < 18) phase = "afternoon";
    else if (hour >= 18 && hour < 22) phase = "evening";
    else phase = "night";

    const startOfYear = new Date(Date.UTC(this._currentTime.getUTCFullYear(), 0, 1));
    const dayOfYear = Math.floor(
      (this._currentTime.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000),
    ) + 1;

    return {
      currentTime: this._currentTime.toISOString(),
      currentDay: dayOfYear,
      currentPhase: phase,
      stepCount: this._stepCount,
    };
  }

  advance(minutes: number): { fromTime: string; untilTime: string } {
    const fromTime = this._currentTime.toISOString();
    this._currentTime = new Date(this._currentTime.getTime() + minutes * 60 * 1000);
    this._stepCount++;
    return { fromTime, untilTime: this._currentTime.toISOString() };
  }

  advanceTo(targetTime: string): { fromTime: string; untilTime: string } {
    const fromTime = this._currentTime.toISOString();
    this._currentTime = new Date(targetTime);
    this._stepCount++;
    return { fromTime, untilTime: targetTime };
  }
}

export class ClosedFixture {
  private readonly worldClock: WorldClock;
  private readonly worldEngine: WorldEngine;
  private readonly ledger: ResourceLedger;
  private readonly perceptionProjector: PerceptionProjector;
  private readonly admissionPipeline: CognitiveAdmissionPipeline;
  private readonly config: FixtureConfig;

  private processDefinitions: Map<string, ProcessDefinitionV1>;
  private processInstances: Map<string, ProcessInstanceV1>;
  private activities: Map<string, ActivityRecordV1>;
  private accounts: Map<string, ResourceAccountV1>;
  private stateRevision: number = 0;

  private readonly gateParameters: CognitiveGateParameters = {
    parameterVersion: "v1.0",
    wakeSalience: 0.5,
    accumulateSalience: 0.2,
    accumulatedWakeCount: 3,
    accumulatedWakeSalience: 0.8,
  };

  constructor(
    db: DatabaseSync,
    config: FixtureConfig,
  ) {
    this.config = config;
    this.worldClock = new WorldClock(config.startTime);
    this.worldEngine = new WorldEngine({ engineVersion: config.fixtureVersion });
    this.ledger = new ResourceLedger(db, {
      enforceNonNegative: true,
      enforceBalancedTransfers: true,
      ledgerVersion: "1.0",
    });
    this.perceptionProjector = new PerceptionProjector();
    this.admissionPipeline = new CognitiveAdmissionPipeline(
      new ChangeAggregator(),
      this.perceptionProjector,
      new CognitiveGate(),
    );

    this.processDefinitions = new Map();
    this.processInstances = new Map();
    this.activities = new Map();
    this.accounts = new Map();
  }

  initialize(): void {
    for (const resourceType of createDay0ResourceTypes()) {
      this.ledger.registerResourceType(resourceType);
    }

    for (const account of createDay0Accounts()) {
      this.ledger.createAccount(account);
      this.accounts.set(account.account_id, {
        ...account,
        revision: 0,
      });
    }

    for (const definition of createProcessDefinitions()) {
      this.processDefinitions.set(definition.definition_id, definition);
    }

    const cultivationInstance: ProcessInstanceV1 = {
      schema_version: "1.0",
      instance_id: newId("proc"),
      definition_id: "s4_daily_cultivation",
      definition_version: "v1",
      status: "running",
      progress: 0.2,
      base_state_revision: 0,
      random_seed: this.config.randomSeed,
      started_at: this.config.startTime,
    };
    this.processInstances.set(cultivationInstance.instance_id, cultivationInstance);

    const observationActivity: ActivityRecordV1 = {
      schema_version: "1.0",
      activity_id: newId("act"),
      actor_id: this.config.actorId,
      semantic_description: "Monitoring S-4 cultivation process",
      status: "running",
      interruptibility: "safe",
      started_at: this.config.startTime,
      source_refs: [{ source_type: "event", source_id: newId("evt") }],
      revision: 0,
    };
    this.activities.set(observationActivity.activity_id, observationActivity);
  }

  private buildSnapshot(): WorldSnapshot {
    return {
      revision: this.stateRevision,
      accounts: this.accounts,
      processes: this.processInstances,
      activities: this.activities,
      processDefinitions: this.processDefinitions,
      currentTime: this.worldClock.state.currentTime,
    };
  }

  private buildStepInput(
    fromTime: string,
    untilTime: string,
    commands: WorldCommandV1[] = [],
  ): WorldStepInputV1 {
    return {
      schema_version: "1.0",
      from_time: fromTime,
      until_time: untilTime,
      base_state_revision: this.stateRevision,
      commands,
      source_refs: [{ source_type: "event", source_id: newId("evt") }],
      rule_set_version: "v1.0",
      random_seed: `${this.config.randomSeed}_step_${this.worldClock.state.stepCount}`,
      idempotency_key: newId("step"),
    };
  }

  private applyStepResult(result: WorldStepResultV1): void {
    for (const delta of result.process_deltas) {
      const instance = this.processInstances.get(delta.instance_id);
      if (instance) {
        this.processInstances.set(delta.instance_id, {
          ...instance,
          status: delta.to_status,
          progress: delta.progress ?? instance.progress,
        });
      }
    }

    for (const delta of result.activity_deltas) {
      const activity = this.activities.get(delta.activity_id);
      if (activity) {
        this.activities.set(delta.activity_id, {
          ...activity,
          status: delta.to_status,
          revision: activity.revision + 1,
        });
      }
    }

    this.stateRevision++;
  }

  private createPerceptionCandidates(
    result: WorldStepResultV1,
    occurredAt: string,
  ): PerceptionCandidate[] {
    return result.proposed_events.map((event) => ({
      summary: event.summary,
      occurred_at: event.occurred_at,
      privacy_scope: "internal" as const,
      subject_ids: event.entity_ids,
      source_refs: event.source_refs,
      provenance: {
        kind: "world_event" as const,
        principal_id: "world_engine",
        trust: "verified" as const,
      },
      visibility: event.location_id
        ? { kind: "co_located" as const, location_id: event.location_id }
        : { kind: "co_located" as const, location_id: this.config.actorLocationId },
    }));
  }

  private createAdmissionChanges(
    candidates: PerceptionCandidate[],
    result: WorldStepResultV1,
  ): CommittedAdmissionChange[] {
    return candidates.map((candidate, index) => ({
      changeId: newId("chg"),
      aggregationKey: `world_step_${this.stateRevision}_${index}`,
      eventKind: result.proposed_events[index]?.event_kind ?? "unknown",
      entityIds: result.proposed_events[index]?.entity_ids ?? [],
      locationIds: result.proposed_events[index]?.location_id
        ? [result.proposed_events[index].location_id!]
        : [],
      salience: result.proposed_events[index]?.salience ?? 0.5,
      boundaryHint: "observable_change" as const,
      recursiveInternal: false,
      perceptionCandidate: candidate,
    }));
  }

  private runAdmission(
    changes: CommittedAdmissionChange[],
    windowStart: string,
    windowEnd: string,
  ): CognitiveAdmissionResult | null {
    if (changes.length === 0) return null;

    const currentActivity: CurrentActivityAdmissionContext = {
      activityId: [...this.activities.keys()][0] ?? "default_activity",
      continuation: "automatic",
      sourceRefs: [{ source_type: "event", source_id: newId("evt") }],
    };

    const input: CognitiveAdmissionInput = {
      changes,
      aggregation: {
        windowStartedAt: windowStart,
        windowEndedAt: windowEnd,
        accumulatorVersion: "v1.0",
      },
      perception: {
        actor_id: this.config.actorId,
        actor_location_id: this.config.actorLocationId,
        private_channel_ids: [],
        public_channel_ids: [],
        device_feed_ids: ["ecology_garden_sensors"],
        authorized_record_ids: [],
        projected_at: windowEnd,
        projection_version: "v1.0",
        base_state_revision: this.stateRevision,
      },
      gate: {
        currentActivity,
        hardInterrupts: [],
        activeSubscriptions: [],
        previousAccumulations: [],
        parameters: this.gateParameters,
        gateVersion: "v1.0",
        decidedAt: windowEnd,
      },
    };

    return this.admissionPipeline.evaluate(input);
  }

  step(commands: WorldCommandV1[] = []): StepResult {
    const clockBefore = { ...this.worldClock.state };
    const { fromTime, untilTime } = this.worldClock.advance(this.config.stepDurationMinutes);
    const clockAfter = { ...this.worldClock.state };

    const snapshot = this.buildSnapshot();
    const stepInput = this.buildStepInput(fromTime, untilTime, commands);
    const worldStepResult = this.worldEngine.step(stepInput, snapshot);

    this.applyStepResult(worldStepResult);

    const candidates = this.createPerceptionCandidates(worldStepResult, untilTime);
    const changes = this.createAdmissionChanges(candidates, worldStepResult);
    const admissionResult = this.runAdmission(changes, fromTime, untilTime);

    return {
      clockBefore,
      clockAfter,
      worldStepResult,
      admissionResult,
      woke: admissionResult?.decision?.disposition === "wake",
      observations: [...(admissionResult?.observations ?? [])],
      decision: admissionResult?.decision ?? null,
    };
  }

  run(): FixtureRunResult {
    const steps: StepResult[] = [];
    let wakeCount = 0;
    let ignoreCount = 0;
    let accumulateCount = 0;
    let processCompletions = 0;
    let processFailures = 0;

    for (let i = 0; i < this.config.maxSteps; i++) {
      const result = this.step();
      steps.push(result);

      if (result.decision) {
        switch (result.decision.disposition) {
          case "wake":
            wakeCount++;
            break;
          case "ignore":
            ignoreCount++;
            break;
          case "accumulate":
            accumulateCount++;
            break;
        }
      } else {
        ignoreCount++;
      }

      for (const delta of result.worldStepResult.process_deltas) {
        if (delta.to_status === "completed") processCompletions++;
        if (delta.to_status === "failed") processFailures++;
      }
    }

    return {
      steps,
      totalSteps: steps.length,
      wakeCount,
      ignoreCount,
      accumulateCount,
      finalClock: this.worldClock.state,
      processCompletions,
      processFailures,
    };
  }

  runOfflineAggregated(totalMinutes: number): WorldStepResultV1 {
    const clockBefore = this.worldClock.state.currentTime;
    const { fromTime, untilTime } = this.worldClock.advance(totalMinutes);
    const snapshot = this.buildSnapshot();
    const stepInput = this.buildStepInput(fromTime, untilTime, []);
    return this.worldEngine.step(stepInput, snapshot);
  }

  runStepwise(totalMinutes: number, stepSize: number): WorldStepResultV1[] {
    const results: WorldStepResultV1[] = [];
    const numSteps = Math.ceil(totalMinutes / stepSize);

    for (let i = 0; i < numSteps; i++) {
      const { fromTime, untilTime } = this.worldClock.advance(stepSize);
      const snapshot = this.buildSnapshot();
      const stepInput = this.buildStepInput(fromTime, untilTime, []);
      const result = this.worldEngine.step(stepInput, snapshot);
      this.applyStepResult(result);
      results.push(result);
    }

    return results;
  }

  getSnapshot(): WorldSnapshot {
    return this.buildSnapshot();
  }

  getAccounts(): Map<string, ResourceAccountV1> {
    return new Map(this.accounts);
  }

  getProcesses(): Map<string, ProcessInstanceV1> {
    return new Map(this.processInstances);
  }

  getActivities(): Map<string, ActivityRecordV1> {
    return new Map(this.activities);
  }
}
