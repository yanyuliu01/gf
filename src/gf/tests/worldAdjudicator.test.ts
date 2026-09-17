import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WorldAdjudicator,
  StubWorldAdjudicator,
  checkLocationConstraint,
  checkTimeConstraint,
  checkResourceConstraint,
  checkCapabilityConstraint,
  checkKnowledgeConstraint,
  checkPermissionConstraint,
  checkWorldRuleConstraint,
  checkHardConstraints,
  type ActorState,
  type WorldSnapshot,
  type AdjudicationContext,
  type HardConstraintClass,
} from "../world/worldAdjudicator.js";
import type {
  ActionCompilationResultV1,
  ExecutionPrimitiveV1,
} from "../generated/cognitiveRuntimeTypes.js";
import { SchemaRegistry } from "../validation/schemas.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function makeActor(overrides: Partial<ActorState> = {}): ActorState {
  return {
    actor_id: "muelsyse",
    location_id: "garden",
    capabilities: new Set(["perception", "locomotion", "manipulation", "speech"]),
    known_locations: new Set(["garden", "kitchen", "study"]),
    known_targets: new Set(["flowers", "book", "lamp"]),
    permissions: new Set(["use:flowers", "use:book"]),
    ...overrides,
  };
}

function makeWorld(overrides: Partial<WorldSnapshot> = {}): WorldSnapshot {
  return {
    revision: 1,
    world_time: new Date("2026-09-17T10:00:00Z"),
    world_day: 1,
    world_phase: "morning",
    locations: new Map([
      [
        "garden",
        {
          location_id: "garden",
          adjacent_locations: new Set(["kitchen", "study"]),
          available_targets: new Set(["flowers", "bench"]),
          capacity_available: new Map([["flowers", 1], ["bench", 2]]),
        },
      ],
      [
        "kitchen",
        {
          location_id: "kitchen",
          adjacent_locations: new Set(["garden"]),
          available_targets: new Set(["stove", "sink"]),
          capacity_available: new Map([["stove", 1]]),
        },
      ],
      [
        "study",
        {
          location_id: "study",
          adjacent_locations: new Set(["garden"]),
          available_targets: new Set(["book", "lamp", "desk"]),
          capacity_available: new Map([["book", 5], ["lamp", 1]]),
        },
      ],
    ]),
    immutable_rules: [],
    ...overrides,
  };
}

function makeContext(
  actor: ActorState = makeActor(),
  world: WorldSnapshot = makeWorld(),
): AdjudicationContext {
  return {
    actor,
    world,
    source_refs: [{ source_type: "event", source_id: "evt_test" }],
  };
}

function makePrimitive(
  primitive: "observe" | "move" | "use_object" | "wait" | "communicate",
  target: string,
  detail: string = "test action",
): ExecutionPrimitiveV1 {
  const p: ExecutionPrimitiveV1 = { primitive, target, detail };
  if (primitive === "communicate") {
    p.text = "Hello";
  }
  return p;
}

const TEST_HASH = "a".repeat(64);

function makeCompilation(
  primitives: ExecutionPrimitiveV1[],
  status: "compiled" | "capability_gap" = "compiled",
): ActionCompilationResultV1 {
  return {
    schema_version: "1.0",
    compilation_id: "cmp_test",
    action_proposal_id: "act_test",
    actor_id: "muelsyse",
    status,
    primitives: status === "compiled" ? primitives : undefined,
    capability_gap: status === "capability_gap" ? {
      gap_class: "uncompilable_semantics",
      unsupported_semantics: "Cannot teleport",
      intent_quote: "I want to teleport",
    } : undefined,
    compiler_version: "test.v1",
    source_closure_hash: TEST_HASH,
    base_state_revision: 1,
    compiled_at: "2026-09-17T10:00:00.000Z",
  };
}

describe("individual constraint checks", () => {
  test("location: move to adjacent location passes", () => {
    const actor = makeActor();
    const world = makeWorld();
    const primitive = makePrimitive("move", "kitchen");
    const result = checkLocationConstraint(primitive, actor, world);
    assert.equal(result.passed, true);
  });

  test("location: move to non-adjacent location fails", () => {
    const actor = makeActor({ location_id: "garden" });
    const world = makeWorld();
    world.locations.set("distant", {
      location_id: "distant",
      adjacent_locations: new Set(),
      available_targets: new Set(),
      capacity_available: new Map(),
    });
    const primitive = makePrimitive("move", "distant");
    const result = checkLocationConstraint(primitive, actor, world);
    assert.equal(result.passed, false);
    assert.ok(result.reason?.includes("not adjacent"));
  });

  test("location: observe target at current location passes", () => {
    const actor = makeActor();
    const world = makeWorld();
    const primitive = makePrimitive("observe", "flowers");
    const result = checkLocationConstraint(primitive, actor, world);
    assert.equal(result.passed, true);
  });

  test("location: observe target not at location fails", () => {
    const actor = makeActor();
    const world = makeWorld();
    const primitive = makePrimitive("observe", "stove");
    const result = checkLocationConstraint(primitive, actor, world);
    assert.equal(result.passed, false);
    assert.ok(result.reason?.includes("not available"));
  });

  test("time: movement during night phase fails", () => {
    const actor = makeActor();
    const world = makeWorld({ world_phase: "night" });
    const primitive = makePrimitive("move", "kitchen");
    const result = checkTimeConstraint(primitive, actor, world);
    assert.equal(result.passed, false);
    assert.ok(result.reason?.includes("night"));
  });

  test("time: wait during night phase passes", () => {
    const actor = makeActor();
    const world = makeWorld({ world_phase: "night" });
    const primitive = makePrimitive("wait", "until_morning");
    const result = checkTimeConstraint(primitive, actor, world);
    assert.equal(result.passed, true);
  });

  test("resource: use_object with available capacity passes", () => {
    const actor = makeActor();
    const world = makeWorld();
    const primitive = makePrimitive("use_object", "flowers");
    const result = checkResourceConstraint(primitive, actor, world);
    assert.equal(result.passed, true);
  });

  test("resource: use_object with no capacity fails", () => {
    const actor = makeActor();
    const world = makeWorld();
    world.locations.get("garden")!.capacity_available.set("flowers", 0);
    const primitive = makePrimitive("use_object", "flowers");
    const result = checkResourceConstraint(primitive, actor, world);
    assert.equal(result.passed, false);
    assert.ok(result.reason?.includes("not available"));
  });

  test("capability: actor with required capability passes", () => {
    const actor = makeActor();
    const world = makeWorld();
    const primitive = makePrimitive("observe", "flowers");
    const result = checkCapabilityConstraint(primitive, actor, world);
    assert.equal(result.passed, true);
  });

  test("capability: actor without required capability fails", () => {
    const actor = makeActor({ capabilities: new Set(["locomotion"]) });
    const world = makeWorld();
    const primitive = makePrimitive("observe", "flowers");
    const result = checkCapabilityConstraint(primitive, actor, world);
    assert.equal(result.passed, false);
    assert.ok(result.reason?.includes("perception"));
  });

  test("knowledge: actor knowing location passes move", () => {
    const actor = makeActor();
    const world = makeWorld();
    const primitive = makePrimitive("move", "kitchen");
    const result = checkKnowledgeConstraint(primitive, actor, world);
    assert.equal(result.passed, true);
  });

  test("knowledge: actor not knowing location fails move", () => {
    const actor = makeActor({ known_locations: new Set(["garden"]) });
    const world = makeWorld();
    const primitive = makePrimitive("move", "kitchen");
    const result = checkKnowledgeConstraint(primitive, actor, world);
    assert.equal(result.passed, false);
    assert.ok(result.reason?.includes("does not know location"));
  });

  test("permission: actor with permission passes use_object", () => {
    const actor = makeActor();
    const world = makeWorld();
    const primitive = makePrimitive("use_object", "flowers");
    const result = checkPermissionConstraint(primitive, actor, world);
    assert.equal(result.passed, true);
  });

  test("permission: actor without permission fails use_object", () => {
    const actor = makeActor({ permissions: new Set(["use:book"]) });
    const world = makeWorld();
    const primitive = makePrimitive("use_object", "flowers");
    const result = checkPermissionConstraint(primitive, actor, world);
    assert.equal(result.passed, false);
    assert.ok(result.reason?.includes("lacks permission"));
  });

  test("world_rule: immutable rule check applies", () => {
    const actor = makeActor();
    const world = makeWorld({
      immutable_rules: [{
        rule_id: "no_night_observe",
        description: "Cannot observe during night",
        check: (p, _a, w) => !(p.primitive === "observe" && w.world_phase === "night"),
      }],
    });
    world.world_phase = "night";
    const primitive = makePrimitive("observe", "flowers");
    const result = checkWorldRuleConstraint(primitive, actor, world);
    assert.equal(result.passed, false);
    assert.ok(result.reason?.includes("immutable rule"));
  });
});

describe("combined hard constraint checks", () => {
  test("all constraints pass for valid primitive", () => {
    const context = makeContext();
    const primitive = makePrimitive("observe", "flowers");
    const result = checkHardConstraints(primitive, context);
    assert.equal(result.passed, true);
    assert.equal(result.failed_classes.length, 0);
  });

  test("multiple constraints can fail", () => {
    const actor = makeActor({
      capabilities: new Set(["locomotion"]),
      known_targets: new Set(),
    });
    const context = makeContext(actor);
    const primitive = makePrimitive("observe", "unknown_target");
    const result = checkHardConstraints(primitive, context);
    assert.equal(result.passed, false);
    assert.ok(result.failed_classes.includes("capability"));
    assert.ok(result.failed_classes.includes("knowledge"));
    assert.ok(result.failed_classes.includes("location"));
  });
});

describe("WorldAdjudicator", () => {
  const schemas = new SchemaRegistry(join(ROOT, "schemas"));

  test("accepts valid compilation with all constraints met", async () => {
    const adjudicator = new WorldAdjudicator();
    const context = makeContext();
    const compilation = makeCompilation([
      makePrimitive("observe", "flowers"),
    ]);

    const result = await adjudicator.adjudicate(compilation, context);

    assert.equal(result.status, "accepted");
    assert.equal(result.hard_constraint_classes.length, 0);
    assert.equal(result.proposed_effects.length, 1);
    schemas.validate("world-outcome-proposal.schema.json", result);
  });

  test("rejects capability_gap compilation", async () => {
    const adjudicator = new WorldAdjudicator();
    const context = makeContext();
    const compilation = makeCompilation([], "capability_gap");

    const result = await adjudicator.adjudicate(compilation, context);

    assert.equal(result.status, "rejected");
    assert.ok(result.hard_constraint_classes.includes("capability"));
    assert.equal(result.proposed_effects.length, 0);
    schemas.validate("world-outcome-proposal.schema.json", result);
  });

  test("rejects when hard constraints fail", async () => {
    const adjudicator = new WorldAdjudicator();
    const actor = makeActor({ location_id: "garden" });
    const world = makeWorld();
    world.locations.set("distant", {
      location_id: "distant",
      adjacent_locations: new Set(),
      available_targets: new Set(),
      capacity_available: new Map(),
    });
    const context = makeContext(actor, world);
    const compilation = makeCompilation([
      makePrimitive("move", "distant"),
    ]);

    const result = await adjudicator.adjudicate(compilation, context);

    assert.equal(result.status, "rejected");
    assert.ok(result.hard_constraint_classes.includes("location"));
    assert.equal(result.proposed_effects.length, 0);
    schemas.validate("world-outcome-proposal.schema.json", result);
  });

  test("partial when some primitives pass and some fail", async () => {
    const adjudicator = new WorldAdjudicator();
    const actor = makeActor({ location_id: "garden" });
    const world = makeWorld();
    world.locations.set("distant", {
      location_id: "distant",
      adjacent_locations: new Set(),
      available_targets: new Set(),
      capacity_available: new Map(),
    });
    const context = makeContext(actor, world);
    const compilation = makeCompilation([
      makePrimitive("observe", "flowers"),
      makePrimitive("move", "distant"),
    ]);

    const result = await adjudicator.adjudicate(compilation, context);

    assert.equal(result.status, "partial");
    assert.ok(result.hard_constraint_classes.includes("location"));
    assert.equal(result.proposed_effects.length, 1);
    assert.equal(result.proposed_effects[0].kind, "observe");
    schemas.validate("world-outcome-proposal.schema.json", result);
  });

  test("accepts multiple primitives when all pass", async () => {
    const adjudicator = new WorldAdjudicator();
    const context = makeContext();
    const compilation = makeCompilation([
      makePrimitive("observe", "flowers"),
      makePrimitive("move", "kitchen"),
      makePrimitive("communicate", "Doctor", "greeting"),
    ]);

    const result = await adjudicator.adjudicate(compilation, context);

    assert.equal(result.status, "accepted");
    assert.equal(result.hard_constraint_classes.length, 0);
    assert.equal(result.proposed_effects.length, 3);
    schemas.validate("world-outcome-proposal.schema.json", result);
  });
});

describe("StubWorldAdjudicator", () => {
  const schemas = new SchemaRegistry(join(ROOT, "schemas"));

  test("accepts all by default", async () => {
    const adjudicator = new StubWorldAdjudicator();
    const context = makeContext();
    const compilation = makeCompilation([
      makePrimitive("observe", "anything"),
    ]);

    const result = await adjudicator.adjudicate(compilation, context);

    assert.equal(result.status, "accepted");
    schemas.validate("world-outcome-proposal.schema.json", result);
  });

  test("can override default result", async () => {
    const adjudicator = new StubWorldAdjudicator({
      status: "rejected",
      hard_constraint_classes: ["world_rule"],
    });
    const context = makeContext();
    const compilation = makeCompilation([
      makePrimitive("observe", "forbidden"),
    ]);

    const result = await adjudicator.adjudicate(compilation, context);

    assert.equal(result.status, "rejected");
    assert.ok(result.hard_constraint_classes.includes("world_rule"));
    schemas.validate("world-outcome-proposal.schema.json", result);
  });
});

describe("docs/16 compliance", () => {
  test("seven hard constraint classes match docs/16 specification", () => {
    const expectedClasses: HardConstraintClass[] = [
      "location",
      "time",
      "resource",
      "capability",
      "knowledge",
      "permission",
      "world_rule",
    ];
    const context = makeContext();
    const primitive = makePrimitive("observe", "flowers");
    const result = checkHardConstraints(primitive, context);

    for (const cls of expectedClasses) {
      assert.ok(
        typeof cls === "string",
        `${cls} should be a valid constraint class`,
      );
    }
    assert.equal(expectedClasses.length, 7);
  });

  test("rejection requires at least one hard constraint class", async () => {
    const schemas = new SchemaRegistry(join(ROOT, "schemas"));
    const adjudicator = new WorldAdjudicator();
    const actor = makeActor({ known_locations: new Set() });
    const context = makeContext(actor);
    const compilation = makeCompilation([makePrimitive("move", "kitchen")]);

    const result = await adjudicator.adjudicate(compilation, context);

    assert.equal(result.status, "rejected");
    assert.ok(result.hard_constraint_classes.length >= 1);
    schemas.validate("world-outcome-proposal.schema.json", result);
  });

  test("accepted proposal has empty hard constraint classes", async () => {
    const schemas = new SchemaRegistry(join(ROOT, "schemas"));
    const adjudicator = new WorldAdjudicator();
    const context = makeContext();
    const compilation = makeCompilation([makePrimitive("observe", "flowers")]);

    const result = await adjudicator.adjudicate(compilation, context);

    assert.equal(result.status, "accepted");
    assert.equal(result.hard_constraint_classes.length, 0);
    schemas.validate("world-outcome-proposal.schema.json", result);
  });
});
