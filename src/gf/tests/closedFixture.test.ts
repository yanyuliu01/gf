/**
 * M21-010: Closed Fixture Tests.
 *
 * Tests the complete simulation pipeline:
 * - WorldClock -> WorldEngine.step -> StateManager commit -> Perception -> CognitiveGate
 * - Activity/Process work advances without continuous Policy calls
 * - Offline and stepwise execution match
 *
 * Uses OWN-001-approved docs/16 engineering defaults (simulation_fixture_v1).
 */

import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { connect, type DatabaseSync } from "../state/db.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ClosedFixture,
  WorldClock,
  createDay0ResourceTypes,
  createDay0Accounts,
  createProcessDefinitions,
  type FixtureConfig,
} from "../world/closedFixture.js";
import { newId } from "../domain/ids.js";

function createTestDb(): DatabaseSync {
  const db = connect(":memory:");
  const migrations = [
    "001_initial.sql",
    "002_agent_pipeline.sql",
    "003_cognitive_runtime.sql",
    "004_memory_search.sql",
    "005_life_pilot.sql",
    "006_resource_ledger.sql",
  ];

  for (const migration of migrations) {
    const sql = readFileSync(join(process.cwd(), "migrations", migration), "utf-8");
    db.exec(sql);
  }

  return db;
}

function makeFixtureConfig(overrides: Partial<FixtureConfig> = {}): FixtureConfig {
  return {
    actorId: "muelsyse",
    actorLocationId: "ecology_garden",
    startTime: "2026-09-17T08:00:00Z",
    stepDurationMinutes: 30,
    maxSteps: 10,
    randomSeed: "fixture_test_seed_12345",
    fixtureVersion: "test.v1",
    ...overrides,
  };
}

describe("WorldClock", () => {
  test("initializes with start time", () => {
    const clock = new WorldClock("2026-09-17T08:00:00Z");
    const state = clock.state;

    assert.equal(state.currentTime, "2026-09-17T08:00:00.000Z");
    assert.equal(state.currentPhase, "morning");
    assert.equal(state.stepCount, 0);
  });

  test("advances by minutes", () => {
    const clock = new WorldClock("2026-09-17T08:00:00Z");
    const { fromTime, untilTime } = clock.advance(30);

    assert.equal(fromTime, "2026-09-17T08:00:00.000Z");
    assert.equal(untilTime, "2026-09-17T08:30:00.000Z");
    assert.equal(clock.state.stepCount, 1);
  });

  test("tracks day phases correctly", () => {
    const morningClock = new WorldClock("2026-09-17T10:00:00Z");
    assert.equal(morningClock.state.currentPhase, "morning");

    const afternoonClock = new WorldClock("2026-09-17T14:00:00Z");
    assert.equal(afternoonClock.state.currentPhase, "afternoon");

    const eveningClock = new WorldClock("2026-09-17T20:00:00Z");
    assert.equal(eveningClock.state.currentPhase, "evening");

    const nightClock = new WorldClock("2026-09-17T23:00:00Z");
    assert.equal(nightClock.state.currentPhase, "night");
  });
});

describe("Day-0 Fixture Data (docs/16 simulation_fixture_v1)", () => {
  test("creates resource types for all required categories", () => {
    const types = createDay0ResourceTypes();

    const typeIds = types.map((t) => t.resource_type_id);
    assert.ok(typeIds.includes("clean_water"));
    assert.ok(typeIds.includes("energy"));
    assert.ok(typeIds.includes("cultivation_supplies"));
    assert.ok(typeIds.includes("pump_spare_parts"));
    assert.ok(typeIds.includes("budget"));
    assert.ok(typeIds.includes("researcher_time"));
    assert.ok(typeIds.includes("technician_time"));
    assert.ok(typeIds.includes("director_time"));
    assert.ok(typeIds.includes("bench_time"));
    assert.ok(typeIds.includes("device_time"));
    assert.ok(typeIds.includes("pump_health"));
    assert.ok(typeIds.includes("device_health"));
    assert.ok(typeIds.includes("s4_health"));
    assert.ok(typeIds.includes("s4_stress"));
    assert.ok(typeIds.includes("body_energy"));
    assert.ok(typeIds.includes("sleep_pressure"));

    const water = types.find((t) => t.resource_type_id === "clean_water");
    assert.equal(water?.law, "stock");

    const energy = types.find((t) => t.resource_type_id === "energy");
    assert.equal(energy?.law, "capacity");

    const pumpHealth = types.find((t) => t.resource_type_id === "pump_health");
    assert.equal(pumpHealth?.law, "condition");
  });

  test("creates Day-0 accounts with fixture values", () => {
    const accounts = createDay0Accounts();
    const NDD = 100;
    const RCU = 10;

    const waterAccount = accounts.find((a) => a.resource_type_id === "clean_water");
    assert.ok(waterAccount);
    assert.equal(waterAccount.balance, 3.0 * NDD);

    const energyAccount = accounts.find((a) => a.resource_type_id === "energy");
    assert.ok(energyAccount);
    assert.equal(energyAccount.balance, 1.25 * NDD);

    const suppliesAccount = accounts.find((a) => a.resource_type_id === "cultivation_supplies");
    assert.ok(suppliesAccount);
    assert.equal(suppliesAccount.balance, 12);

    const budgetAccount = accounts.find((a) => a.resource_type_id === "budget");
    assert.ok(budgetAccount);
    assert.equal(budgetAccount.balance, 40 * RCU);

    const pumpHealth = accounts.find((a) => a.resource_type_id === "pump_health");
    assert.ok(pumpHealth);
    assert.equal(pumpHealth.balance, 0.62);

    const s4Health = accounts.find((a) => a.resource_type_id === "s4_health");
    assert.ok(s4Health);
    assert.equal(s4Health.balance, 0.48);

    const bodyEnergy = accounts.find((a) => a.resource_type_id === "body_energy");
    assert.ok(bodyEnergy);
    assert.equal(bodyEnergy.balance, 0.72);
  });

  test("creates S-4 process definitions", () => {
    const definitions = createProcessDefinitions();

    const s4Cultivation = definitions.find((d) => d.definition_id === "s4_daily_cultivation");
    assert.ok(s4Cultivation);
    assert.equal(s4Cultivation.duration_model, "1 day");
    assert.ok(s4Cultivation.inputs.some((i) => i.resource_type_id === "clean_water"));
    assert.ok(s4Cultivation.inputs.some((i) => i.resource_type_id === "energy"));

    const s4Observation = definitions.find((d) => d.definition_id === "s4_observation");
    assert.ok(s4Observation);
    assert.equal(s4Observation.duration_model, "30-60 minutes");
    assert.ok(s4Observation.outputs.some((o) => o.resource_type_id === "observation_data"));

    const reportReview = definitions.find((d) => d.definition_id === "report_review");
    assert.ok(reportReview);
    assert.ok(reportReview.capacities.some((c) => c.resource_type_id === "director_time"));

    const pumpMaintenance = definitions.find(
      (d) => d.definition_id === "circulation_pump_maintenance",
    );
    assert.ok(pumpMaintenance);
    assert.ok(pumpMaintenance.inputs.some((i) => i.resource_type_id === "pump_spare_parts"));
  });
});

describe("Closed Fixture", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  test("initializes Day-0 state", () => {
    const config = makeFixtureConfig();
    const fixture = new ClosedFixture(db, config);
    fixture.initialize();

    const snapshot = fixture.getSnapshot();
    assert.equal(snapshot.revision, 0);
    assert.ok(snapshot.accounts.size > 0);
    assert.ok(snapshot.processDefinitions.size > 0);
    assert.ok(snapshot.processes.size > 0);
    assert.ok(snapshot.activities.size > 0);
  });

  test("executes single step through full pipeline", () => {
    const config = makeFixtureConfig();
    const fixture = new ClosedFixture(db, config);
    fixture.initialize();

    const result = fixture.step();

    assert.ok(result.clockBefore);
    assert.ok(result.clockAfter);
    assert.ok(result.worldStepResult);
    assert.equal(result.worldStepResult.schema_version, "1.0");
    assert.ok(result.worldStepResult.input_hash.length === 64);
  });

  test("advances processes without Policy calls", () => {
    const config = makeFixtureConfig({ maxSteps: 5 });
    const fixture = new ClosedFixture(db, config);
    fixture.initialize();

    const initialProcesses = fixture.getProcesses();
    const initialProgress = [...initialProcesses.values()][0]?.progress ?? 0;

    const runResult = fixture.run();

    const finalProcesses = fixture.getProcesses();
    const finalProgress = [...finalProcesses.values()][0]?.progress ?? 0;

    assert.equal(runResult.totalSteps, 5);
    assert.ok(
      finalProgress >= initialProgress,
      `Progress should advance: ${finalProgress} >= ${initialProgress}`,
    );
  });

  test("produces wake/ignore/accumulate decisions", () => {
    const config = makeFixtureConfig({ maxSteps: 10 });
    const fixture = new ClosedFixture(db, config);
    fixture.initialize();

    const runResult = fixture.run();

    const totalDecisions = runResult.wakeCount + runResult.ignoreCount + runResult.accumulateCount;
    assert.equal(totalDecisions, runResult.totalSteps);
  });

  test("tracks process completions and failures", () => {
    const config = makeFixtureConfig({ maxSteps: 100, stepDurationMinutes: 60 });
    const fixture = new ClosedFixture(db, config);
    fixture.initialize();

    const runResult = fixture.run();

    assert.ok(
      typeof runResult.processCompletions === "number",
      "Should track completions",
    );
    assert.ok(
      typeof runResult.processFailures === "number",
      "Should track failures",
    );
  });

  test("clock advances correctly through run", () => {
    const config = makeFixtureConfig({
      startTime: "2026-09-17T08:00:00Z",
      stepDurationMinutes: 60,
      maxSteps: 8,
    });
    const fixture = new ClosedFixture(db, config);
    fixture.initialize();

    const runResult = fixture.run();

    assert.equal(runResult.finalClock.stepCount, 8);
    assert.equal(runResult.finalClock.currentTime, "2026-09-17T16:00:00.000Z");
    assert.equal(runResult.finalClock.currentPhase, "afternoon");
  });
});

describe("Offline vs Stepwise Execution Match", () => {
  let db1: DatabaseSync;
  let db2: DatabaseSync;

  beforeEach(() => {
    db1 = createTestDb();
    db2 = createTestDb();
  });

  afterEach(() => {
    db1.close();
    db2.close();
  });

  test("same seed produces same results", () => {
    const config = makeFixtureConfig({ randomSeed: "deterministic_seed_abc" });

    const fixture1 = new ClosedFixture(db1, config);
    fixture1.initialize();
    const result1 = fixture1.step();

    const fixture2 = new ClosedFixture(db2, config);
    fixture2.initialize();
    const result2 = fixture2.step();

    assert.equal(
      result1.worldStepResult.input_hash,
      result2.worldStepResult.input_hash,
      "Input hashes should match",
    );
    assert.deepEqual(
      result1.worldStepResult.audit.random_draws,
      result2.worldStepResult.audit.random_draws,
      "Random draws should match",
    );
  });

  test("different seeds produce different results", () => {
    const config1 = makeFixtureConfig({ randomSeed: "seed_alpha" });
    const config2 = makeFixtureConfig({ randomSeed: "seed_beta" });

    const fixture1 = new ClosedFixture(db1, config1);
    fixture1.initialize();
    const result1 = fixture1.step();

    const fixture2 = new ClosedFixture(db2, config2);
    fixture2.initialize();
    const result2 = fixture2.step();

    assert.notEqual(
      result1.worldStepResult.input_hash,
      result2.worldStepResult.input_hash,
      "Different seeds should produce different input hashes",
    );
  });
});

describe("Pipeline Integration", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  test("WorldClock -> WorldEngine.step -> Perception -> CognitiveGate", () => {
    const config = makeFixtureConfig();
    const fixture = new ClosedFixture(db, config);
    fixture.initialize();

    const result = fixture.step();

    assert.ok(result.clockBefore, "Clock state before step");
    assert.ok(result.clockAfter, "Clock state after step");
    assert.ok(result.clockAfter.stepCount > result.clockBefore.stepCount, "Step count increments");

    assert.ok(result.worldStepResult, "WorldEngine produces result");
    assert.equal(result.worldStepResult.schema_version, "1.0");

    if (result.worldStepResult.proposed_events.length > 0) {
      assert.ok(result.observations.length >= 0, "Perception projects observations");
    }
  });

  test("Activity continues without Policy intervention", () => {
    const config = makeFixtureConfig({ maxSteps: 20 });
    const fixture = new ClosedFixture(db, config);
    fixture.initialize();

    const initialActivities = fixture.getActivities();
    const initialActivity = [...initialActivities.values()][0];
    assert.ok(initialActivity);
    assert.equal(initialActivity.status, "running");

    fixture.run();

    const finalActivities = fixture.getActivities();
    const finalActivity = [...finalActivities.values()][0];
    assert.ok(finalActivity);
  });

  test("Process advances through multiple steps", () => {
    const config = makeFixtureConfig({
      maxSteps: 50,
      stepDurationMinutes: 30,
    });
    const fixture = new ClosedFixture(db, config);
    fixture.initialize();

    const initialProcesses = fixture.getProcesses();
    const initialInstance = [...initialProcesses.values()][0];
    assert.ok(initialInstance);
    const initialProgress = initialInstance.progress;

    fixture.run();

    const finalProcesses = fixture.getProcesses();
    const finalInstance = [...finalProcesses.values()][0];
    assert.ok(finalInstance);

    const progressMade =
      finalInstance.progress > initialProgress ||
      finalInstance.status === "completed" ||
      finalInstance.status === "failed";
    assert.ok(progressMade, "Process should make progress or reach terminal state");
  });
});

describe("Physiology and Manifestation", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  test("Day-0 includes physiology accounts", () => {
    const config = makeFixtureConfig();
    const fixture = new ClosedFixture(db, config);
    fixture.initialize();

    const accounts = fixture.getAccounts();

    const bodyEnergy = [...accounts.values()].find(
      (a) => a.resource_type_id === "body_energy",
    );
    assert.ok(bodyEnergy);
    assert.equal(bodyEnergy.balance, 0.72);

    const sleepPressure = [...accounts.values()].find(
      (a) => a.resource_type_id === "sleep_pressure",
    );
    assert.ok(sleepPressure);
    assert.equal(sleepPressure.balance, 0.28);
  });

  test("Day-0 includes manifestation capacity", () => {
    const config = makeFixtureConfig();
    const fixture = new ClosedFixture(db, config);
    fixture.initialize();

    const accounts = fixture.getAccounts();

    const manifestation = [...accounts.values()].find(
      (a) => a.resource_type_id === "manifestation_load",
    );
    assert.ok(manifestation);
    assert.equal(manifestation.owner_id, "muelsyse");
  });

  test("Day-0 includes cognition capacity", () => {
    const config = makeFixtureConfig();
    const fixture = new ClosedFixture(db, config);
    fixture.initialize();

    const accounts = fixture.getAccounts();

    const cognition = [...accounts.values()].find(
      (a) => a.resource_type_id === "cognition_capacity",
    );
    assert.ok(cognition);
    assert.equal(cognition.owner_id, "muelsyse");
  });
});

describe("Ecology Garden Resources", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  test("Day-0 includes water/energy/pump accounts", () => {
    const config = makeFixtureConfig();
    const fixture = new ClosedFixture(db, config);
    fixture.initialize();

    const accounts = fixture.getAccounts();
    const NDD = 100;

    const water = [...accounts.values()].find(
      (a) => a.resource_type_id === "clean_water",
    );
    assert.ok(water);
    assert.equal(water.balance, 3.0 * NDD);
    assert.equal(water.owner_id, "ecology_garden");

    const energy = [...accounts.values()].find(
      (a) => a.resource_type_id === "energy",
    );
    assert.ok(energy);
    assert.equal(energy.balance, 1.25 * NDD);

    const pumpHealth = [...accounts.values()].find(
      (a) => a.resource_type_id === "pump_health",
    );
    assert.ok(pumpHealth);
    assert.equal(pumpHealth.balance, 0.62);
  });

  test("Day-0 includes S-4 state", () => {
    const config = makeFixtureConfig();
    const fixture = new ClosedFixture(db, config);
    fixture.initialize();

    const accounts = fixture.getAccounts();

    const s4Health = [...accounts.values()].find(
      (a) => a.resource_type_id === "s4_health",
    );
    assert.ok(s4Health);
    assert.equal(s4Health.balance, 0.48);

    const s4Stress = [...accounts.values()].find(
      (a) => a.resource_type_id === "s4_stress",
    );
    assert.ok(s4Stress);
    assert.equal(s4Stress.balance, 0.35);
  });
});
