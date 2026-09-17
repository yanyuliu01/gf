/**
 * M21-009: World Engine Tests.
 *
 * Tests the pure TypeScript discrete-event stepper:
 * - Process queues and advancement
 * - Bounded seeded distributions
 * - Completion/failure/rework
 * - Next-event calculation
 * - Byte stability (WM-P07)
 * - No model calls inside step
 */

import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  WorldEngine,
  StubWorldEngine,
  type WorldSnapshot,
} from "../world/worldEngine.js";
import type {
  WorldStepInputV1,
  WorldCommandV1,
  ProcessDefinitionV1,
  ProcessInstanceV1,
  ActivityRecordV1,
  ResourceAccountV1,
} from "../generated/worldRuntimeTypes.js";
import { newId, utcnowIso } from "../domain/ids.js";

function makeSnapshot(overrides: Partial<WorldSnapshot> = {}): WorldSnapshot {
  return {
    revision: 0,
    accounts: new Map(),
    processes: new Map(),
    activities: new Map(),
    processDefinitions: new Map(),
    currentTime: utcnowIso(),
    ...overrides,
  };
}

function makeInput(overrides: Partial<WorldStepInputV1> = {}): WorldStepInputV1 {
  return {
    schema_version: "1.0",
    from_time: "2026-09-17T10:00:00Z",
    until_time: "2026-09-17T10:30:00Z",
    base_state_revision: 0,
    commands: [],
    source_refs: [{ source_type: "event", source_id: newId("evt") }],
    rule_set_version: "v1.0",
    random_seed: "test_seed_12345",
    idempotency_key: newId("step"),
    ...overrides,
  };
}

function makeCommand(overrides: Partial<WorldCommandV1> = {}): WorldCommandV1 {
  return {
    schema_version: "1.0",
    command_id: newId("cmd"),
    primitive: "observe",
    target_id: "target_1",
    parameters: {},
    actor_id: "muelsyse",
    source_refs: [{ source_type: "event", source_id: newId("evt") }],
    ...overrides,
  };
}

describe("World Engine", () => {
  let engine: WorldEngine;

  beforeEach(() => {
    engine = new WorldEngine({ engineVersion: "test.v1" });
  });

  describe("Basic Step Execution", () => {
    test("step with no commands returns empty result", () => {
      const input = makeInput();
      const snapshot = makeSnapshot();

      const result = engine.step(input, snapshot);

      assert.equal(result.schema_version, "1.0");
      assert.equal(result.base_state_revision, input.base_state_revision);
      assert.equal(result.resource_deltas.length, 0);
      assert.equal(result.process_deltas.length, 0);
      assert.equal(result.activity_deltas.length, 0);
      assert.ok(result.input_hash.length === 64);
      assert.ok(result.audit);
    });

    test("step records engine version in audit", () => {
      const input = makeInput();
      const snapshot = makeSnapshot();

      const result = engine.step(input, snapshot);

      assert.equal(result.audit.engine_version, "test.v1");
      assert.equal(result.audit.rule_set_version, input.rule_set_version);
    });
  });

  describe("Command Execution", () => {
    test("observe command creates observation event", () => {
      const input = makeInput({
        commands: [
          makeCommand({
            primitive: "observe",
            target_id: "s4_plant",
          }),
        ],
      });
      const snapshot = makeSnapshot();

      const result = engine.step(input, snapshot);

      assert.equal(result.proposed_events.length, 1);
      assert.equal(result.proposed_events[0].event_kind, "observation.made");
      assert.ok(result.proposed_events[0].entity_ids?.includes("s4_plant"));
    });

    test("transfer_resource creates balanced deltas", () => {
      const accounts = new Map<string, ResourceAccountV1>([
        [
          "acc_from",
          {
            schema_version: "1.0",
            account_id: "acc_from",
            resource_type_id: "water",
            owner_id: "ecology",
            balance: 100,
            reserved: 0,
            revision: 0,
          },
        ],
        [
          "acc_to",
          {
            schema_version: "1.0",
            account_id: "acc_to",
            resource_type_id: "water",
            owner_id: "ecology",
            balance: 50,
            reserved: 0,
            revision: 0,
          },
        ],
      ]);

      const input = makeInput({
        commands: [
          makeCommand({
            primitive: "transfer_resource",
            target_id: "acc_from",
            parameters: {
              from_account_id: "acc_from",
              to_account_id: "acc_to",
              amount: 30,
            },
          }),
        ],
      });
      const snapshot = makeSnapshot({ accounts });

      const result = engine.step(input, snapshot);

      assert.equal(result.resource_deltas.length, 2);

      const fromDelta = result.resource_deltas.find((d) => d.account_id === "acc_from");
      const toDelta = result.resource_deltas.find((d) => d.account_id === "acc_to");

      assert.ok(fromDelta);
      assert.ok(toDelta);
      assert.equal(fromDelta.delta, -30);
      assert.equal(toDelta.delta, 30);
    });

    test("start_process transitions queued to running", () => {
      const processes = new Map<string, ProcessInstanceV1>([
        [
          "proc_1",
          {
            schema_version: "1.0",
            instance_id: "proc_1",
            definition_id: "cultivation",
            definition_version: "v1",
            status: "queued",
            progress: 0,
            base_state_revision: 0,
            random_seed: "seed_1",
          },
        ],
      ]);

      const input = makeInput({
        commands: [
          makeCommand({
            primitive: "start_process",
            target_id: "proc_1",
          }),
        ],
      });
      const snapshot = makeSnapshot({ processes });

      const result = engine.step(input, snapshot);

      assert.equal(result.process_deltas.length, 1);
      assert.equal(result.process_deltas[0].instance_id, "proc_1");
      assert.equal(result.process_deltas[0].from_status, "queued");
      assert.equal(result.process_deltas[0].to_status, "running");

      assert.equal(result.proposed_events.length, 1);
      assert.equal(result.proposed_events[0].event_kind, "process.started");
    });

    test("move_actor creates movement event", () => {
      const input = makeInput({
        commands: [
          makeCommand({
            primitive: "move_actor",
            target_id: "ecology_garden",
            actor_id: "muelsyse",
          }),
        ],
      });
      const snapshot = makeSnapshot();

      const result = engine.step(input, snapshot);

      assert.equal(result.proposed_events.length, 1);
      assert.equal(result.proposed_events[0].event_kind, "actor.moved");
      assert.equal(result.proposed_events[0].location_id, "ecology_garden");
    });
  });

  describe("Process Advancement", () => {
    test("running process advances progress", () => {
      const processDefinitions = new Map<string, ProcessDefinitionV1>([
        [
          "cultivation",
          {
            schema_version: "1.0",
            definition_id: "cultivation",
            version: "v1",
            inputs: [],
            outputs: [],
            capacities: [],
            duration_model: "60 minutes",
            output_model: "standard",
            failure_model: "1%",
            interruptibility: "safe",
          },
        ],
      ]);

      const processes = new Map<string, ProcessInstanceV1>([
        [
          "proc_1",
          {
            schema_version: "1.0",
            instance_id: "proc_1",
            definition_id: "cultivation",
            definition_version: "v1",
            status: "running",
            progress: 0,
            base_state_revision: 0,
            random_seed: "seed_1",
          },
        ],
      ]);

      const input = makeInput();
      const snapshot = makeSnapshot({ processDefinitions, processes });

      const result = engine.step(input, snapshot);

      const progressDelta = result.process_deltas.find(
        (d) => d.instance_id === "proc_1" && d.to_status === "running",
      );
      assert.ok(progressDelta);
      assert.ok(progressDelta.progress! > 0);
      assert.ok(progressDelta.progress! < 1);
    });

    test("process completes when progress reaches 1", () => {
      const processDefinitions = new Map<string, ProcessDefinitionV1>([
        [
          "quick_task",
          {
            schema_version: "1.0",
            definition_id: "quick_task",
            version: "v1",
            inputs: [],
            outputs: [{ resource_type_id: "data", amount: 1 }],
            capacities: [],
            duration_model: "10 minutes",
            output_model: "standard",
            failure_model: "0%",
            interruptibility: "safe",
          },
        ],
      ]);

      const processes = new Map<string, ProcessInstanceV1>([
        [
          "proc_1",
          {
            schema_version: "1.0",
            instance_id: "proc_1",
            definition_id: "quick_task",
            definition_version: "v1",
            status: "running",
            progress: 0.9,
            base_state_revision: 0,
            random_seed: "seed_1",
          },
        ],
      ]);

      const input = makeInput();
      const snapshot = makeSnapshot({ processDefinitions, processes });

      const result = engine.step(input, snapshot);

      const completedDelta = result.process_deltas.find(
        (d) => d.instance_id === "proc_1" && d.to_status === "completed",
      );
      assert.ok(completedDelta);
      assert.equal(completedDelta.progress, 1);

      const completedEvent = result.proposed_events.find(
        (e) => e.event_kind === "process.completed",
      );
      assert.ok(completedEvent);
    });

    test("paused process does not advance", () => {
      const processDefinitions = new Map<string, ProcessDefinitionV1>([
        [
          "cultivation",
          {
            schema_version: "1.0",
            definition_id: "cultivation",
            version: "v1",
            inputs: [],
            outputs: [],
            capacities: [],
            duration_model: "60 minutes",
            output_model: "standard",
            failure_model: "1%",
            interruptibility: "safe",
          },
        ],
      ]);

      const processes = new Map<string, ProcessInstanceV1>([
        [
          "proc_1",
          {
            schema_version: "1.0",
            instance_id: "proc_1",
            definition_id: "cultivation",
            definition_version: "v1",
            status: "paused",
            progress: 0.5,
            base_state_revision: 0,
            random_seed: "seed_1",
          },
        ],
      ]);

      const input = makeInput();
      const snapshot = makeSnapshot({ processDefinitions, processes });

      const result = engine.step(input, snapshot);

      const pausedDelta = result.process_deltas.find((d) => d.instance_id === "proc_1");
      assert.equal(pausedDelta, undefined);
    });
  });

  describe("Next Event Calculation", () => {
    test("computes next event time from running processes", () => {
      const processes = new Map<string, ProcessInstanceV1>([
        [
          "proc_1",
          {
            schema_version: "1.0",
            instance_id: "proc_1",
            definition_id: "cultivation",
            definition_version: "v1",
            status: "running",
            progress: 0.5,
            expected_completion_at: "2026-09-17T12:00:00Z",
            base_state_revision: 0,
            random_seed: "seed_1",
          },
        ],
        [
          "proc_2",
          {
            schema_version: "1.0",
            instance_id: "proc_2",
            definition_id: "observation",
            definition_version: "v1",
            status: "running",
            progress: 0.8,
            expected_completion_at: "2026-09-17T11:00:00Z",
            base_state_revision: 0,
            random_seed: "seed_2",
          },
        ],
      ]);

      const input = makeInput();
      const snapshot = makeSnapshot({ processes });

      const result = engine.step(input, snapshot);

      assert.equal(result.next_event_time, "2026-09-17T11:00:00.000Z");
    });

    test("returns null when no pending events", () => {
      const input = makeInput();
      const snapshot = makeSnapshot();

      const result = engine.step(input, snapshot);

      assert.equal(result.next_event_time, null);
    });
  });

  describe("Random Number Determinism", () => {
    test("audit records random draws", () => {
      const processDefinitions = new Map<string, ProcessDefinitionV1>([
        [
          "variable_task",
          {
            schema_version: "1.0",
            definition_id: "variable_task",
            version: "v1",
            inputs: [],
            outputs: [],
            capacities: [],
            duration_model: "30-60 minutes",
            output_model: "standard",
            failure_model: "5%",
            interruptibility: "safe",
          },
        ],
      ]);

      const processes = new Map<string, ProcessInstanceV1>([
        [
          "proc_1",
          {
            schema_version: "1.0",
            instance_id: "proc_1",
            definition_id: "variable_task",
            definition_version: "v1",
            status: "running",
            progress: 0.95,
            base_state_revision: 0,
            random_seed: "seed_1",
          },
        ],
      ]);

      const input = makeInput();
      const snapshot = makeSnapshot({ processDefinitions, processes });

      const result = engine.step(input, snapshot);

      assert.ok(result.audit.random_draws.length > 0);
      for (const draw of result.audit.random_draws) {
        assert.ok(typeof draw.coordinate === "string");
        assert.ok(typeof draw.value === "number");
        assert.ok(draw.value >= 0 && draw.value <= 1);
      }
    });
  });
});

describe("Property Tests (WM-P07: Determinism)", () => {
  let engine: WorldEngine;

  beforeEach(() => {
    engine = new WorldEngine({ engineVersion: "test.v1" });
  });

  test("same input produces identical output (byte stability)", () => {
    const processDefinitions = new Map<string, ProcessDefinitionV1>([
      [
        "cultivation",
        {
          schema_version: "1.0",
          definition_id: "cultivation",
          version: "v1",
          inputs: [],
          outputs: [{ resource_type_id: "observation", amount: 1 }],
          capacities: [],
          duration_model: "60 minutes",
          output_model: "standard",
          failure_model: "10%",
          interruptibility: "safe",
        },
      ],
    ]);

    const processes = new Map<string, ProcessInstanceV1>([
      [
        "proc_1",
        {
          schema_version: "1.0",
          instance_id: "proc_1",
          definition_id: "cultivation",
          definition_version: "v1",
          status: "running",
          progress: 0.4,
          base_state_revision: 0,
          random_seed: "deterministic_seed",
        },
      ],
    ]);

    const input: WorldStepInputV1 = {
      schema_version: "1.0",
      from_time: "2026-09-17T10:00:00Z",
      until_time: "2026-09-17T10:30:00Z",
      base_state_revision: 0,
      commands: [
        {
          schema_version: "1.0",
          command_id: "cmd_fixed",
          primitive: "observe",
          target_id: "s4_plant",
          parameters: {},
          actor_id: "muelsyse",
          source_refs: [{ source_type: "event", source_id: "evt_fixed" }],
        },
      ],
      source_refs: [{ source_type: "event", source_id: "evt_fixed" }],
      rule_set_version: "v1.0",
      random_seed: "deterministic_seed_12345",
      idempotency_key: "step_fixed",
    };

    const snapshot = makeSnapshot({ processDefinitions, processes });

    const result1 = engine.step(input, snapshot);
    const result2 = engine.step(input, snapshot);

    const json1 = JSON.stringify(result1);
    const json2 = JSON.stringify(result2);

    assert.equal(json1, json2, "Results must be byte-identical");
    assert.equal(result1.input_hash, result2.input_hash);
    assert.deepEqual(result1.audit.random_draws, result2.audit.random_draws);
  });

  test("different seeds produce different outputs", () => {
    const processDefinitions = new Map<string, ProcessDefinitionV1>([
      [
        "variable_task",
        {
          schema_version: "1.0",
          definition_id: "variable_task",
          version: "v1",
          inputs: [],
          outputs: [],
          capacities: [],
          duration_model: "30-60 minutes",
          output_model: "standard",
          failure_model: "50%",
          interruptibility: "safe",
        },
      ],
    ]);

    const processes = new Map<string, ProcessInstanceV1>([
      [
        "proc_1",
        {
          schema_version: "1.0",
          instance_id: "proc_1",
          definition_id: "variable_task",
          definition_version: "v1",
          status: "running",
          progress: 0.98,
          base_state_revision: 0,
          random_seed: "seed_1",
        },
      ],
    ]);

    const snapshot = makeSnapshot({ processDefinitions, processes });

    const input1 = makeInput({ random_seed: "seed_A" });
    const input2 = makeInput({ random_seed: "seed_B" });

    const result1 = engine.step(input1, snapshot);
    const result2 = engine.step(input2, snapshot);

    assert.notEqual(result1.input_hash, result2.input_hash);
    assert.notDeepEqual(result1.audit.random_draws, result2.audit.random_draws);
  });

  test("input hash changes with different commands", () => {
    const snapshot = makeSnapshot();

    const input1 = makeInput({ commands: [] });
    const input2 = makeInput({
      commands: [makeCommand({ primitive: "observe", target_id: "obj_1" })],
    });

    const result1 = engine.step(input1, snapshot);
    const result2 = engine.step(input2, snapshot);

    assert.notEqual(result1.input_hash, result2.input_hash);
  });
});

describe("StubWorldEngine", () => {
  test("stub engine uses stub version", () => {
    const engine = new StubWorldEngine();
    const input = makeInput();
    const snapshot = makeSnapshot();

    const result = engine.step(input, snapshot);

    assert.equal(result.audit.engine_version, "stub.v1");
  });
});
