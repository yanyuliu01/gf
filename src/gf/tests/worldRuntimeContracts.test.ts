import { describe, it, beforeEach } from "node:test";
import * as assert from "node:assert/strict";
import { join } from "node:path";

import type {
  ResourceTypeV1,
  ResourceAccountV1,
  ResourceReservationV1,
  ProcessDefinitionV1,
  ProcessInstanceV1,
  ActivityRecordV1,
  WorldCommandV1,
  WorldStepInputV1,
  WorldStepResultV1,
} from "../generated/worldRuntimeTypes.js";
import { SchemaRegistry } from "../validation/schemas.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const SCHEMAS_DIR = join(ROOT, "schemas");

describe("World Runtime Contracts", () => {
  let schemas: SchemaRegistry;

  beforeEach(() => {
    schemas = new SchemaRegistry(SCHEMAS_DIR);
  });

  describe("ResourceTypeV1", () => {
    it("validates a stock resource type", () => {
      const resourceType: ResourceTypeV1 = {
        schema_version: "1.0",
        resource_type_id: "water",
        law: "stock",
        unit: "liter",
        min_balance: 0,
        version: "resource-types.v1",
      };
      schemas.validate("resource-type.schema.json", resourceType);
    });

    it("validates all six resource laws", () => {
      const laws: ResourceTypeV1["law"][] = [
        "stock",
        "currency",
        "capacity",
        "condition",
        "information",
        "permission",
      ];
      for (const law of laws) {
        const resourceType: ResourceTypeV1 = {
          schema_version: "1.0",
          resource_type_id: `test_${law}`,
          law,
          unit: "unit",
          version: "resource-types.v1",
        };
        schemas.validate("resource-type.schema.json", resourceType);
      }
    });
  });

  describe("ResourceAccountV1", () => {
    it("validates a resource account with location", () => {
      const account: ResourceAccountV1 = {
        schema_version: "1.0",
        account_id: "account:water:garden",
        resource_type_id: "water",
        owner_id: "ecology_dept",
        location_id: "garden",
        balance: 20.5,
        reserved: 5.0,
        revision: 42,
      };
      schemas.validate("resource-account.schema.json", account);
    });

    it("validates an account without location", () => {
      const account: ResourceAccountV1 = {
        schema_version: "1.0",
        account_id: "account:budget:dept",
        resource_type_id: "currency",
        owner_id: "ecology_dept",
        location_id: null,
        balance: 1000,
        reserved: 0,
        revision: 1,
      };
      schemas.validate("resource-account.schema.json", account);
    });
  });

  describe("ResourceReservationV1", () => {
    it("validates a capacity reservation for a process", () => {
      const reservation: ResourceReservationV1 = {
        schema_version: "1.0",
        reservation_id: "reserve:device:001",
        account_id: "account:device_time:lab",
        resource_type_id: "device_capacity",
        amount: 60,
        status: "active",
        reserved_at: "2026-09-17T10:00:00Z",
        expires_at: "2026-09-17T11:00:00Z",
        purpose: "s4_observation",
        process_instance_id: "process:obs:001",
        activity_id: null,
        idempotency_key: "reserve:device:001:v1",
        revision: 0,
      };
      schemas.validate("resource-reservation.schema.json", reservation);
    });
  });

  describe("ProcessDefinitionV1", () => {
    it("validates a cultivation process definition", () => {
      const definition: ProcessDefinitionV1 = {
        schema_version: "1.0",
        definition_id: "s4_daily_cultivation",
        version: "process-defs.v1",
        inputs: [
          { resource_type_id: "water", amount: 0.08 },
          { resource_type_id: "energy", amount: 0.02 },
        ],
        outputs: [],
        capacities: [
          { resource_type_id: "person_time", amount_per_unit_time: 15, time_unit: "minute" },
          { resource_type_id: "bench_time", amount_per_unit_time: 1440, time_unit: "minute" },
        ],
        duration_model: "fixed:1440",
        output_model: "growth_equation",
        failure_model: "stress_increase",
        precondition_rule_ids: [],
        required_permission_ids: [],
        interruptibility: "lossy",
      };
      schemas.validate("process-definition.schema.json", definition);
    });
  });

  describe("ProcessInstanceV1", () => {
    it("validates a running process instance", () => {
      const instance: ProcessInstanceV1 = {
        schema_version: "1.0",
        instance_id: "process:cult:20260917:001",
        definition_id: "s4_daily_cultivation",
        definition_version: "process-defs.v1",
        status: "running",
        progress: 0.35,
        reservations: ["reserve:bench:001", "reserve:water:001"],
        started_at: "2026-09-17T08:00:00Z",
        expected_completion_at: "2026-09-18T08:00:00Z",
        base_state_revision: 100,
        random_seed: "seed:20260917:001",
      };
      schemas.validate("process-instance.schema.json", instance);
    });

    it("validates all process statuses", () => {
      const statuses: ProcessInstanceV1["status"][] = [
        "queued",
        "reserved",
        "running",
        "paused",
        "completed",
        "failed",
        "cancelled",
        "rework_required",
      ];
      for (const status of statuses) {
        const instance: ProcessInstanceV1 = {
          schema_version: "1.0",
          instance_id: `process:test:${status}`,
          definition_id: "test",
          definition_version: "v1",
          status,
          progress: 0.5,
          base_state_revision: 1,
          random_seed: "seed",
        };
        schemas.validate("process-instance.schema.json", instance);
      }
    });
  });

  describe("ActivityRecordV1", () => {
    it("validates an actor activity record", () => {
      const activity: ActivityRecordV1 = {
        schema_version: "1.0",
        activity_id: "activity:muelsyse:001",
        actor_id: "muelsyse",
        semantic_description: "检查 S-4 的根部状态",
        status: "running",
        execution_refs: ["process:obs:001"],
        reservations: ["reserve:cognition:001"],
        interruptibility: "safe",
        started_at: "2026-09-17T10:00:00Z",
        expected_boundary_at: "2026-09-17T10:05:00Z",
        source_refs: [{ source_type: "event", source_id: "evt:wake:001" }],
        revision: 1,
      };
      schemas.validate("activity-record.schema.json", activity);
    });
  });

  describe("WorldCommandV1", () => {
    it("validates a move command", () => {
      const command: WorldCommandV1 = {
        schema_version: "1.0",
        command_id: "cmd:move:001",
        primitive: "move_actor",
        target_id: "garden",
        parameters: { from: "office" },
        actor_id: "muelsyse",
        source_refs: [{ source_type: "event", source_id: "evt:policy:001" }],
      };
      schemas.validate("world-command.schema.json", command);
    });

    it("validates all world command primitives", () => {
      const primitives: WorldCommandV1["primitive"][] = [
        "reserve_resource",
        "release_resource",
        "transfer_resource",
        "start_process",
        "pause_process",
        "resume_process",
        "cancel_process",
        "move_actor",
        "start_activity",
        "complete_activity",
        "cancel_activity",
        "observe",
        "communicate",
        "wait",
        "use_object",
      ];
      for (const primitive of primitives) {
        const command: WorldCommandV1 = {
          schema_version: "1.0",
          command_id: `cmd:${primitive}`,
          primitive,
          target_id: "target",
          parameters: {},
          actor_id: "actor",
          source_refs: [{ source_type: "event", source_id: "evt" }],
        };
        schemas.validate("world-command.schema.json", command);
      }
    });
  });

  describe("WorldStepInputV1", () => {
    it("validates a step input with commands", () => {
      const input: WorldStepInputV1 = {
        schema_version: "1.0",
        from_time: "2026-09-17T10:00:00Z",
        until_time: "2026-09-17T10:05:00Z",
        base_state_revision: 100,
        commands: [
          {
            schema_version: "1.0",
            command_id: "cmd:001",
            primitive: "observe",
            target_id: "S-4",
            parameters: {},
            actor_id: "muelsyse",
            source_refs: [{ source_type: "event", source_id: "evt" }],
          },
        ],
        source_refs: [{ source_type: "event", source_id: "evt:wake" }],
        rule_set_version: "world-rules.v1",
        random_seed: "seed:20260917",
        idempotency_key: "step:20260917:100",
      };
      schemas.validate("world-step-input.schema.json", input);
    });
  });

  describe("WorldStepResultV1", () => {
    it("validates a step result with events and deltas", () => {
      const result: WorldStepResultV1 = {
        schema_version: "1.0",
        base_state_revision: 100,
        proposed_events: [
          {
            event_kind: "life.activity.completed",
            summary: "完成了 S-4 检查",
            occurred_at: "2026-09-17T10:05:00Z",
            location_id: "garden",
            entity_ids: ["S-4"],
            salience: 0.8,
            source_refs: [{ source_type: "event", source_id: "evt:step" }],
          },
        ],
        resource_deltas: [
          {
            account_id: "account:energy",
            resource_type_id: "energy",
            delta: -1,
            reason: "observation_cost",
          },
        ],
        process_deltas: [],
        activity_deltas: [
          {
            activity_id: "activity:001",
            from_status: "running",
            to_status: "completed",
          },
        ],
        next_event_time: "2026-09-17T12:00:00Z",
        input_hash: "a".repeat(64),
        audit: {
          engine_version: "world-engine.v1",
          rule_set_version: "world-rules.v1",
          random_draws: [
            { coordinate: "moisture_reading", value: 0.65 },
          ],
        },
      };
      schemas.validate("world-step-result.schema.json", result);
    });
  });

  describe("docs/16 semantic compliance", () => {
    it("resource laws match the six categories from docs/16", () => {
      const expectedLaws = [
        "stock",
        "currency",
        "capacity",
        "condition",
        "information",
        "permission",
      ];
      const resourceType: ResourceTypeV1 = {
        schema_version: "1.0",
        resource_type_id: "test",
        law: "stock",
        unit: "unit",
        version: "v1",
      };
      for (const law of expectedLaws) {
        resourceType.law = law as ResourceTypeV1["law"];
        schemas.validate("resource-type.schema.json", resourceType);
      }
    });

    it("process status lifecycle matches docs/16 workflow", () => {
      const expectedStatuses = [
        "queued",
        "reserved",
        "running",
        "completed",
        "failed",
        "rework_required",
        "paused",
        "cancelled",
      ];
      const instance: ProcessInstanceV1 = {
        schema_version: "1.0",
        instance_id: "test",
        definition_id: "test",
        definition_version: "v1",
        status: "queued",
        progress: 0,
        base_state_revision: 0,
        random_seed: "seed",
      };
      for (const status of expectedStatuses) {
        instance.status = status as ProcessInstanceV1["status"];
        schemas.validate("process-instance.schema.json", instance);
      }
    });

    it("activity statuses are execution lifecycle not semantic candidates", () => {
      const activityStatuses = ["running", "waiting", "paused", "completed", "cancelled"];
      const activity: ActivityRecordV1 = {
        schema_version: "1.0",
        activity_id: "test",
        actor_id: "test",
        semantic_description: "test activity",
        status: "running",
        interruptibility: "none",
        started_at: "2026-09-17T00:00:00Z",
        source_refs: [{ source_type: "event", source_id: "evt" }],
        revision: 0,
      };
      for (const status of activityStatuses) {
        activity.status = status as ActivityRecordV1["status"];
        schemas.validate("activity-record.schema.json", activity);
      }
    });
  });
});
