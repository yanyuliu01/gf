/**
 * World Engine (M21-009).
 *
 * Pure TypeScript discrete-event stepper for world simulation.
 * Key properties:
 * - Same state/commands/rules/seed produces byte-stable output (WM-P07)
 * - No database writes inside step() (WM-P13)
 * - No model calls inside step()
 * - Returns proposals for StateManager to commit atomically
 *
 * The engine computes the next world state based on:
 * - Current world snapshot (resources, processes, activities)
 * - Pending world commands
 * - Rule set version
 * - Deterministic random seed
 */

import type {
  WorldStepInputV1,
  WorldStepResultV1,
  WorldCommandV1,
  ResourceDeltaV1,
  ProcessDeltaV1,
  ActivityDeltaV1,
  WorldEventProposalV1,
  WorldStepAuditV1,
  ProcessDefinitionV1,
  ProcessInstanceV1,
  ActivityRecordV1,
  ResourceAccountV1,
  SourceRef,
} from "../generated/worldRuntimeTypes.js";
import { createHash } from "node:crypto";
import { newId } from "../domain/ids.js";

export interface WorldSnapshot {
  revision: number;
  accounts: ReadonlyMap<string, ResourceAccountV1>;
  processes: ReadonlyMap<string, ProcessInstanceV1>;
  activities: ReadonlyMap<string, ActivityRecordV1>;
  processDefinitions: ReadonlyMap<string, ProcessDefinitionV1>;
  currentTime: string;
}

export interface SeededRandom {
  nextFloat(coordinate: string): number;
  nextInt(coordinate: string, min: number, max: number): number;
  draws: { coordinate: string; value: number }[];
}

function createSeededRandom(seed: string): SeededRandom {
  const seedBuffer = createHash("sha256").update(seed).digest();
  let state = seedBuffer.readUInt32BE(0);
  const draws: { coordinate: string; value: number }[] = [];

  function hash(coordinate: string): number {
    const coordHash = createHash("sha256")
      .update(seed)
      .update(coordinate)
      .digest();
    return coordHash.readUInt32BE(0);
  }

  return {
    nextFloat(coordinate: string): number {
      state = hash(coordinate);
      const value = state / 0xffffffff;
      draws.push({ coordinate, value });
      return value;
    },
    nextInt(coordinate: string, min: number, max: number): number {
      const float = this.nextFloat(coordinate);
      const value = Math.floor(float * (max - min + 1)) + min;
      return value;
    },
    draws,
  };
}

function computeInputHash(input: WorldStepInputV1): string {
  const canonical = JSON.stringify({
    from_time: input.from_time,
    until_time: input.until_time,
    base_state_revision: input.base_state_revision,
    commands: input.commands,
    rule_set_version: input.rule_set_version,
    random_seed: input.random_seed,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export interface EngineConfig {
  engineVersion: string;
}

/**
 * World Engine for discrete-event simulation.
 *
 * Pure computation: step() takes input and returns proposal.
 * No side effects, no database writes, no model calls.
 */
export class WorldEngine {
  constructor(private readonly config: EngineConfig) {}

  /**
   * Execute one world step.
   *
   * This is a pure computation that produces a WorldStepResultV1 proposal.
   * The caller (StateManager) is responsible for committing the result.
   *
   * Invariant WM-P13: step() does not write state. Same input -> same output.
   */
  step(input: WorldStepInputV1, snapshot: WorldSnapshot): WorldStepResultV1 {
    const rng = createSeededRandom(input.random_seed);
    const inputHash = computeInputHash(input);

    const resourceDeltas: ResourceDeltaV1[] = [];
    const processDeltas: ProcessDeltaV1[] = [];
    const activityDeltas: ActivityDeltaV1[] = [];
    const proposedEvents: WorldEventProposalV1[] = [];

    for (const command of input.commands) {
      const result = this.executeCommand(command, snapshot, rng, input.from_time);
      resourceDeltas.push(...result.resourceDeltas);
      processDeltas.push(...result.processDeltas);
      activityDeltas.push(...result.activityDeltas);
      proposedEvents.push(...result.proposedEvents);
    }

    const advanceResult = this.advanceProcesses(
      snapshot,
      rng,
      input.from_time,
      input.until_time,
    );
    resourceDeltas.push(...advanceResult.resourceDeltas);
    processDeltas.push(...advanceResult.processDeltas);
    activityDeltas.push(...advanceResult.activityDeltas);
    proposedEvents.push(...advanceResult.proposedEvents);

    const nextEventTime = this.computeNextEventTime(snapshot, input.until_time);

    const audit: WorldStepAuditV1 = {
      engine_version: this.config.engineVersion,
      rule_set_version: input.rule_set_version,
      random_draws: rng.draws,
    };

    return {
      schema_version: "1.0",
      base_state_revision: input.base_state_revision,
      proposed_events: proposedEvents,
      resource_deltas: resourceDeltas,
      process_deltas: processDeltas,
      activity_deltas: activityDeltas,
      next_event_time: nextEventTime,
      input_hash: inputHash,
      audit,
    };
  }

  private executeCommand(
    command: WorldCommandV1,
    snapshot: WorldSnapshot,
    rng: SeededRandom,
    currentTime: string,
  ): {
    resourceDeltas: ResourceDeltaV1[];
    processDeltas: ProcessDeltaV1[];
    activityDeltas: ActivityDeltaV1[];
    proposedEvents: WorldEventProposalV1[];
  } {
    const resourceDeltas: ResourceDeltaV1[] = [];
    const processDeltas: ProcessDeltaV1[] = [];
    const activityDeltas: ActivityDeltaV1[] = [];
    const proposedEvents: WorldEventProposalV1[] = [];

    switch (command.primitive) {
      case "reserve_resource": {
        break;
      }

      case "release_resource": {
        break;
      }

      case "transfer_resource": {
        const params = command.parameters as {
          from_account_id: string;
          to_account_id: string;
          amount: number;
        };
        const fromAccount = snapshot.accounts.get(params.from_account_id);
        const toAccount = snapshot.accounts.get(params.to_account_id);

        if (fromAccount && toAccount && params.amount > 0) {
          resourceDeltas.push({
            account_id: params.from_account_id,
            resource_type_id: fromAccount.resource_type_id,
            delta: -params.amount,
            reason: `transfer to ${params.to_account_id}`,
          });
          resourceDeltas.push({
            account_id: params.to_account_id,
            resource_type_id: toAccount.resource_type_id,
            delta: params.amount,
            reason: `transfer from ${params.from_account_id}`,
          });
        }
        break;
      }

      case "start_process": {
        const process = snapshot.processes.get(command.target_id);
        if (process && process.status === "queued") {
          processDeltas.push({
            instance_id: command.target_id,
            from_status: "queued",
            to_status: "running",
            progress: 0,
          });

          proposedEvents.push({
            event_kind: "process.started",
            summary: `Process ${command.target_id} started`,
            occurred_at: currentTime,
            source_refs: [...command.source_refs],
          });
        }
        break;
      }

      case "pause_process": {
        const process = snapshot.processes.get(command.target_id);
        if (process && process.status === "running") {
          processDeltas.push({
            instance_id: command.target_id,
            from_status: "running",
            to_status: "paused",
            progress: process.progress,
          });
        }
        break;
      }

      case "resume_process": {
        const process = snapshot.processes.get(command.target_id);
        if (process && process.status === "paused") {
          processDeltas.push({
            instance_id: command.target_id,
            from_status: "paused",
            to_status: "running",
            progress: process.progress,
          });
        }
        break;
      }

      case "cancel_process": {
        const process = snapshot.processes.get(command.target_id);
        if (process && (process.status === "running" || process.status === "paused")) {
          processDeltas.push({
            instance_id: command.target_id,
            from_status: process.status,
            to_status: "cancelled",
            progress: process.progress,
          });
        }
        break;
      }

      case "start_activity": {
        const params = command.parameters as {
          semantic_description: string;
          interruptibility?: string;
        };
        activityDeltas.push({
          activity_id: command.target_id,
          from_status: "running",
          to_status: "running",
        });

        proposedEvents.push({
          event_kind: "activity.started",
          summary: params.semantic_description ?? `Activity ${command.target_id} started`,
          occurred_at: currentTime,
          source_refs: [...command.source_refs],
        });
        break;
      }

      case "complete_activity": {
        const activity = snapshot.activities.get(command.target_id);
        if (activity && activity.status === "running") {
          activityDeltas.push({
            activity_id: command.target_id,
            from_status: "running",
            to_status: "completed",
          });

          proposedEvents.push({
            event_kind: "activity.completed",
            summary: `Activity ${command.target_id} completed`,
            occurred_at: currentTime,
            source_refs: [...command.source_refs],
          });
        }
        break;
      }

      case "cancel_activity": {
        const activity = snapshot.activities.get(command.target_id);
        if (activity && (activity.status === "running" || activity.status === "waiting")) {
          activityDeltas.push({
            activity_id: command.target_id,
            from_status: activity.status,
            to_status: "cancelled",
          });
        }
        break;
      }

      case "move_actor": {
        proposedEvents.push({
          event_kind: "actor.moved",
          summary: `Actor ${command.actor_id} moved to ${command.target_id}`,
          occurred_at: currentTime,
          location_id: command.target_id,
          source_refs: [...command.source_refs],
        });
        break;
      }

      case "observe": {
        proposedEvents.push({
          event_kind: "observation.made",
          summary: `Observation of ${command.target_id}`,
          occurred_at: currentTime,
          entity_ids: [command.target_id],
          source_refs: [...command.source_refs],
        });
        break;
      }

      case "communicate": {
        proposedEvents.push({
          event_kind: "communication.sent",
          summary: `Communication to ${command.target_id}`,
          occurred_at: currentTime,
          entity_ids: [command.actor_id, command.target_id],
          source_refs: [...command.source_refs],
        });
        break;
      }

      case "wait": {
        break;
      }

      case "use_object": {
        proposedEvents.push({
          event_kind: "object.used",
          summary: `Used object ${command.target_id}`,
          occurred_at: currentTime,
          entity_ids: [command.target_id],
          source_refs: [...command.source_refs],
        });
        break;
      }

      default: {
        const _exhaustive: never = command.primitive;
        throw new Error(`Unknown command primitive: ${_exhaustive}`);
      }
    }

    return { resourceDeltas, processDeltas, activityDeltas, proposedEvents };
  }

  private advanceProcesses(
    snapshot: WorldSnapshot,
    rng: SeededRandom,
    fromTime: string,
    untilTime: string,
  ): {
    resourceDeltas: ResourceDeltaV1[];
    processDeltas: ProcessDeltaV1[];
    activityDeltas: ActivityDeltaV1[];
    proposedEvents: WorldEventProposalV1[];
  } {
    const resourceDeltas: ResourceDeltaV1[] = [];
    const processDeltas: ProcessDeltaV1[] = [];
    const activityDeltas: ActivityDeltaV1[] = [];
    const proposedEvents: WorldEventProposalV1[] = [];

    const fromMs = new Date(fromTime).getTime();
    const untilMs = new Date(untilTime).getTime();
    const dtMinutes = (untilMs - fromMs) / 60000;

    for (const [instanceId, process] of snapshot.processes) {
      if (process.status !== "running") continue;

      const definition = snapshot.processDefinitions.get(process.definition_id);
      if (!definition) continue;

      const progressIncrement = this.computeProgressIncrement(
        definition,
        dtMinutes,
        rng,
        instanceId,
      );

      const newProgress = Math.min(1, process.progress + progressIncrement);

      if (newProgress >= 1) {
        const failureRoll = rng.nextFloat(`${instanceId}:failure`);
        const failureThreshold = this.getFailureThreshold(definition);

        if (failureRoll < failureThreshold) {
          processDeltas.push({
            instance_id: instanceId,
            from_status: "running",
            to_status: "failed",
            progress: newProgress,
          });

          proposedEvents.push({
            event_kind: "process.failed",
            summary: `Process ${instanceId} failed`,
            occurred_at: untilTime,
            source_refs: [{ source_type: "event", source_id: newId("evt") }],
          });
        } else {
          processDeltas.push({
            instance_id: instanceId,
            from_status: "running",
            to_status: "completed",
            progress: 1,
          });

          for (const output of definition.outputs) {
            resourceDeltas.push({
              account_id: `output_${instanceId}`,
              resource_type_id: output.resource_type_id,
              delta: output.amount,
              reason: `process ${instanceId} output`,
            });
          }

          proposedEvents.push({
            event_kind: "process.completed",
            summary: `Process ${instanceId} completed`,
            occurred_at: untilTime,
            source_refs: [{ source_type: "event", source_id: newId("evt") }],
          });
        }
      } else if (newProgress > process.progress) {
        processDeltas.push({
          instance_id: instanceId,
          from_status: "running",
          to_status: "running",
          progress: newProgress,
        });
      }
    }

    return { resourceDeltas, processDeltas, activityDeltas, proposedEvents };
  }

  private computeProgressIncrement(
    definition: ProcessDefinitionV1,
    dtMinutes: number,
    rng: SeededRandom,
    instanceId: string,
  ): number {
    const durationModel = definition.duration_model;

    const durationMatch = durationModel.match(/^(\d+)-(\d+)\s*(minute|hour|day)s?$/i);
    if (durationMatch) {
      const min = parseInt(durationMatch[1], 10);
      const max = parseInt(durationMatch[2], 10);
      const unit = durationMatch[3].toLowerCase();

      let multiplier = 1;
      if (unit === "hour") multiplier = 60;
      else if (unit === "day") multiplier = 1440;

      const baseDuration = rng.nextInt(`${instanceId}:duration`, min, max) * multiplier;
      return dtMinutes / baseDuration;
    }

    const fixedMatch = durationModel.match(/^(\d+)\s*(minute|hour|day)s?$/i);
    if (fixedMatch) {
      const value = parseInt(fixedMatch[1], 10);
      const unit = fixedMatch[2].toLowerCase();

      let multiplier = 1;
      if (unit === "hour") multiplier = 60;
      else if (unit === "day") multiplier = 1440;

      return dtMinutes / (value * multiplier);
    }

    return dtMinutes / 60;
  }

  private getFailureThreshold(definition: ProcessDefinitionV1): number {
    const model = definition.failure_model;

    const match = model.match(/^(\d+(?:\.\d+)?)\s*%?$/);
    if (match) {
      const value = parseFloat(match[1]);
      return value > 1 ? value / 100 : value;
    }

    return 0.01;
  }

  private computeNextEventTime(
    snapshot: WorldSnapshot,
    currentTime: string,
  ): string | null {
    const times: Date[] = [];

    for (const process of snapshot.processes.values()) {
      if (process.status === "running" && process.expected_completion_at) {
        times.push(new Date(process.expected_completion_at));
      }
    }

    for (const activity of snapshot.activities.values()) {
      if (
        (activity.status === "running" || activity.status === "waiting") &&
        activity.expected_boundary_at
      ) {
        times.push(new Date(activity.expected_boundary_at));
      }
    }

    if (times.length === 0) return null;

    const earliest = new Date(Math.min(...times.map((t) => t.getTime())));
    const current = new Date(currentTime);

    if (earliest <= current) return null;

    return earliest.toISOString();
  }
}

/**
 * Stub world engine for testing.
 */
export class StubWorldEngine extends WorldEngine {
  constructor() {
    super({ engineVersion: "stub.v1" });
  }
}
