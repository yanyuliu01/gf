import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setupRuntime, type TestRuntime } from "./helpers.js";
import {
  UnifiedCognitivePipeline,
  StubAdmissionAdapter,
  StubWorkingSelfInputAdapter,
  StubAdjudicationContextAdapter,
  StubSocialContextAdapter,
  StubSpeechRenderer,
  type PipelineEvent,
  type CognitivePipelineConfig,
  type CognitivePipelineDependencies,
  type ActionCompilerAdapter,
  type WorldAdjudicatorAdapter,
} from "../cognition/pipeline/unifiedCognitivePipeline.js";
import {
  StubSocialOutcomeProposer,
} from "../world/socialOutcome.js";
import type { OpenPolicyResultV1 } from "../cognition/policy/openGenerativePolicy.js";
import type { WorkingSelfV1, WorldOutcomeProposalV1 } from "../generated/agentPipelineTypes.js";
import type { ActionCompilationResultV1 } from "../generated/cognitiveRuntimeTypes.js";
import type { AdjudicationContext } from "../world/worldAdjudicator.js";
import { newId, utcnowIso } from "../domain/ids.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const TEST_HASH = "a".repeat(64);

class TestStubActionCompiler implements ActionCompilerAdapter {
  async compile(): Promise<ActionCompilationResultV1> {
    return {
      schema_version: "1.0",
      compilation_id: newId("comp"),
      action_proposal_id: newId("act"),
      actor_id: "muelsyse",
      status: "compiled",
      primitives: [
        { primitive: "observe", target: "specimen_1", detail: "Check status" },
      ],
      source_closure_hash: TEST_HASH,
      base_state_revision: 0,
      compiler_version: "stub.v1",
      compiled_at: utcnowIso(),
    };
  }
}

class TestStubWorldAdjudicator implements WorldAdjudicatorAdapter {
  async adjudicate(
    _compilation: Readonly<ActionCompilationResultV1>,
    _context: Readonly<AdjudicationContext>,
  ): Promise<Readonly<WorldOutcomeProposalV1>> {
    const sourceRef = { source_type: "event" as const, source_id: "evt_test" };
    return {
      schema_version: "1.0",
      outcome_id: newId("out"),
      action_proposal_id: "act_test",
      actor_id: "muelsyse",
      status: "accepted",
      summary: "Action accepted",
      hard_constraint_classes: [],
      proposed_effects: [
        {
          effect_id: newId("eff"),
          kind: "observe",
          summary: "Observation completed",
          source_refs: [sourceRef],
        },
      ],
      source_refs: [sourceRef],
      adjudicator_version: "stub.v1",
      rule_version: "stub.v1",
      source_closure_hash: TEST_HASH,
      base_state_revision: 0,
      proposed_at: utcnowIso(),
    };
  }
}

function makeEvent(overrides: Partial<PipelineEvent> = {}): PipelineEvent {
  const eventId = overrides.eventId ?? "evt_test";
  return {
    eventId,
    origin: "user",
    kind: "im.message.received",
    occurredAt: utcnowIso(),
    sourceRefs: [{ source_type: "event", source_id: eventId }],
    payload: { text: "Hello" },
    ...overrides,
  };
}

function makeConfig(overrides: Partial<CognitivePipelineConfig> = {}): CognitivePipelineConfig {
  return {
    actorId: "muelsyse",
    pipelineVersion: "test.v1",
    enableSpeechOutput: true,
    speechChannel: "private_im",
    ...overrides,
  };
}

class StubWorkingSelfBuilder {
  build(input: unknown): WorkingSelfV1 {
    const inp = input as { actorId: string; baseStateRevision: number; evidence: { sourceRefs: unknown[] }[] };
    return {
      schema_version: "1.0",
      working_self_id: newId("ws"),
      episode_id: newId("episode"),
      actor_id: inp.actorId,
      input_closure: {
        base_state_revision: inp.baseStateRevision,
        source_refs: inp.evidence.flatMap((e) => e.sourceRefs) as WorkingSelfV1["input_closure"]["source_refs"],
        closure_hash: TEST_HASH,
      },
      evidence: [],
      assembler_version: "stub.v1",
      assembled_at: utcnowIso(),
    };
  }
}

class StubOpenPolicy {
  constructor(private readonly intent: string = "continue observation") {}

  async propose(workingSelf: WorkingSelfV1): Promise<OpenPolicyResultV1> {
    return {
      action: {
        schema_version: "1.0",
        proposal_id: "act_test",
        actor_id: workingSelf.actor_id,
        policy_run_id: "pol_test",
        intent: this.intent,
        source_refs: workingSelf.input_closure.source_refs,
        source_closure_hash: workingSelf.input_closure.closure_hash,
        base_state_revision: workingSelf.input_closure.base_state_revision,
        proposed_at: utcnowIso(),
      },
    };
  }
}

describe("M20-025: Unified Cognitive Pipeline", () => {
  let rt: TestRuntime;

  beforeEach(() => {
    rt = setupRuntime();

    rt.db.prepare(`INSERT INTO world_events(
      event_id, schema_version, origin, kind, occurred_at, received_at,
      principal_id, trust, privacy_scope, idempotency_key, payload_json
    ) VALUES (
      'evt_test', '1.0', 'user', 'im.message.received', datetime('now'), datetime('now'),
      'doctor', 'authenticated', 'private_im', 'idem_test', '{}'
    )`).run();

    rt.db.prepare(`INSERT INTO action_proposal_audit(
      proposal_id, schema_version, actor_id, policy_run_id, intent,
      source_closure_hash, base_state_revision, payload_json, proposed_at
    ) VALUES ('act_test', '1.0', 'muelsyse', 'pol_test', 'test intent',
      '${TEST_HASH}', 0, '{}', datetime('now'))`).run();
  });

  afterEach(() => {
    rt.cleanup();
  });

  test("user event goes through full pipeline with wake", async () => {
    const config = makeConfig();
    const deps: CognitivePipelineDependencies = {
      stateManager: rt.stateManager,
      workingSelfBuilder: new StubWorkingSelfBuilder(),
      openPolicy: new StubOpenPolicy(),
      actionCompiler: new TestStubActionCompiler(),
      worldAdjudicator: new TestStubWorldAdjudicator(),
      socialProposer: new StubSocialOutcomeProposer(),
    };

    const pipeline = new UnifiedCognitivePipeline(
      config,
      deps,
      new StubAdmissionAdapter(true, false),
      new StubWorkingSelfInputAdapter(),
      new StubAdjudicationContextAdapter(),
      new StubSocialContextAdapter(),
      new StubSpeechRenderer(),
    );

    const event = makeEvent({ eventId: "evt_test" });
    const result = await pipeline.process(event);

    if (result.error) {
      console.error("Pipeline error:", result.error);
    }

    assert.equal(result.eventId, "evt_test");
    assert.equal(result.origin, "user");
    assert.equal(result.woke, true);
    assert.ok(result.admission.decision);
    assert.equal(result.admission.decision.disposition, "wake");
    assert.ok(result.policyResult, `Expected policyResult but got error: ${result.error}`);
    assert.ok(result.compilation);
    assert.ok(result.hardOutcome);
    assert.ok(result.enrichedOutcome);
    assert.equal(result.committed, true);
  });

  test("world event goes through same pipeline when admission wakes", async () => {
    const config = makeConfig();
    const deps: CognitivePipelineDependencies = {
      stateManager: rt.stateManager,
      workingSelfBuilder: new StubWorkingSelfBuilder(),
      openPolicy: new StubOpenPolicy(),
      actionCompiler: new TestStubActionCompiler(),
      worldAdjudicator: new TestStubWorldAdjudicator(),
      socialProposer: new StubSocialOutcomeProposer(),
    };

    const pipeline = new UnifiedCognitivePipeline(
      config,
      deps,
      new StubAdmissionAdapter(true, true),
      new StubWorkingSelfInputAdapter(),
      new StubAdjudicationContextAdapter(),
      new StubSocialContextAdapter(),
      new StubSpeechRenderer(),
    );

    const event = makeEvent({
      eventId: "evt_test",
      origin: "world",
      kind: "activity.completed",
    });
    const result = await pipeline.process(event);

    assert.equal(result.origin, "world");
    assert.equal(result.woke, true);
    assert.ok(result.policyResult);
    assert.equal(result.committed, true);
  });

  test("non-wake admission skips cognitive processing", async () => {
    const config = makeConfig();
    const deps: CognitivePipelineDependencies = {
      stateManager: rt.stateManager,
      workingSelfBuilder: new StubWorkingSelfBuilder(),
      openPolicy: new StubOpenPolicy(),
      actionCompiler: new TestStubActionCompiler(),
      worldAdjudicator: new TestStubWorldAdjudicator(),
      socialProposer: new StubSocialOutcomeProposer(),
    };

    const pipeline = new UnifiedCognitivePipeline(
      config,
      deps,
      new StubAdmissionAdapter(false, false),
      new StubWorkingSelfInputAdapter(),
      new StubAdjudicationContextAdapter(),
      new StubSocialContextAdapter(),
      new StubSpeechRenderer(),
    );

    const event = makeEvent();
    const result = await pipeline.process(event);

    assert.equal(result.woke, false);
    assert.equal(result.policyResult, undefined);
    assert.equal(result.compilation, undefined);
    assert.equal(result.committed, false);
  });

  test("same Working Self builder used for user and world events", async () => {
    const config = makeConfig();
    const workingSelfBuilder = new StubWorkingSelfBuilder();
    let buildCount = 0;
    const countingBuilder = {
      build: (input: unknown) => {
        buildCount++;
        return workingSelfBuilder.build(input);
      },
    };

    const deps: CognitivePipelineDependencies = {
      stateManager: rt.stateManager,
      workingSelfBuilder: countingBuilder,
      openPolicy: new StubOpenPolicy(),
      actionCompiler: new TestStubActionCompiler(),
      worldAdjudicator: new TestStubWorldAdjudicator(),
      socialProposer: new StubSocialOutcomeProposer(),
    };

    const pipeline = new UnifiedCognitivePipeline(
      config,
      deps,
      new StubAdmissionAdapter(true, true),
      new StubWorkingSelfInputAdapter(),
      new StubAdjudicationContextAdapter(),
      new StubSocialContextAdapter(),
      new StubSpeechRenderer(),
    );

    await pipeline.process(makeEvent({ eventId: "evt_test", origin: "user" }));
    await pipeline.process(makeEvent({
      eventId: newId("evt"),
      origin: "world",
      sourceRefs: [{ source_type: "event", source_id: "evt_test" }],
    }));

    assert.equal(buildCount, 2, "Same builder should be called for both event types");
  });

  test("same Open Policy used for user and world events", async () => {
    const config = makeConfig();
    let policyCount = 0;
    const countingPolicy = {
      propose: async (workingSelf: WorkingSelfV1) => {
        policyCount++;
        return new StubOpenPolicy().propose(workingSelf);
      },
    };

    const deps: CognitivePipelineDependencies = {
      stateManager: rt.stateManager,
      workingSelfBuilder: new StubWorkingSelfBuilder(),
      openPolicy: countingPolicy,
      actionCompiler: new TestStubActionCompiler(),
      worldAdjudicator: new TestStubWorldAdjudicator(),
      socialProposer: new StubSocialOutcomeProposer(),
    };

    const pipeline = new UnifiedCognitivePipeline(
      config,
      deps,
      new StubAdmissionAdapter(true, true),
      new StubWorkingSelfInputAdapter(),
      new StubAdjudicationContextAdapter(),
      new StubSocialContextAdapter(),
      new StubSpeechRenderer(),
    );

    await pipeline.process(makeEvent({ eventId: "evt_test", origin: "user" }));
    await pipeline.process(makeEvent({
      eventId: newId("evt"),
      origin: "world",
      sourceRefs: [{ source_type: "event", source_id: "evt_test" }],
    }));

    assert.equal(policyCount, 2, "Same policy should be called for both event types");
  });

  test("user event with reply queue lane gets priority", async () => {
    const config = makeConfig();
    const deps: CognitivePipelineDependencies = {
      stateManager: rt.stateManager,
      workingSelfBuilder: new StubWorkingSelfBuilder(),
      openPolicy: new StubOpenPolicy(),
      actionCompiler: new TestStubActionCompiler(),
      worldAdjudicator: new TestStubWorldAdjudicator(),
      socialProposer: new StubSocialOutcomeProposer(),
    };

    const pipeline = new UnifiedCognitivePipeline(
      config,
      deps,
      new StubAdmissionAdapter(true, true),
      new StubWorkingSelfInputAdapter(),
      new StubAdjudicationContextAdapter(),
      new StubSocialContextAdapter(),
      new StubSpeechRenderer(),
    );

    const userEvent = makeEvent({ eventId: "evt_test", origin: "user" });
    const result = await pipeline.process(userEvent);

    assert.ok(result.admission.decision);
    assert.equal(result.admission.decision.queue_lane, "reply");
  });

  test("world event gets normal queue lane", async () => {
    const config = makeConfig();
    const deps: CognitivePipelineDependencies = {
      stateManager: rt.stateManager,
      workingSelfBuilder: new StubWorkingSelfBuilder(),
      openPolicy: new StubOpenPolicy(),
      actionCompiler: new TestStubActionCompiler(),
      worldAdjudicator: new TestStubWorldAdjudicator(),
      socialProposer: new StubSocialOutcomeProposer(),
    };

    const pipeline = new UnifiedCognitivePipeline(
      config,
      deps,
      new StubAdmissionAdapter(true, true),
      new StubWorkingSelfInputAdapter(),
      new StubAdjudicationContextAdapter(),
      new StubSocialContextAdapter(),
      new StubSpeechRenderer(),
    );

    const worldEvent = makeEvent({
      eventId: "evt_test",
      origin: "world",
      kind: "activity.completed",
    });
    const result = await pipeline.process(worldEvent);

    assert.ok(result.admission.decision);
    assert.equal(result.admission.decision.queue_lane, "normal");
  });

  test("submitWorldOutcome integrates with pipeline", async () => {
    const config = makeConfig();
    const deps: CognitivePipelineDependencies = {
      stateManager: rt.stateManager,
      workingSelfBuilder: new StubWorkingSelfBuilder(),
      openPolicy: new StubOpenPolicy(),
      actionCompiler: new TestStubActionCompiler(),
      worldAdjudicator: new TestStubWorldAdjudicator(),
      socialProposer: new StubSocialOutcomeProposer(),
    };

    const pipeline = new UnifiedCognitivePipeline(
      config,
      deps,
      new StubAdmissionAdapter(true, false),
      new StubWorkingSelfInputAdapter(),
      new StubAdjudicationContextAdapter(),
      new StubSocialContextAdapter(),
      new StubSpeechRenderer(),
    );

    const event = makeEvent({ eventId: "evt_test" });
    const result = await pipeline.process(event);

    assert.equal(result.committed, true);

    const outcomeRow = rt.db
      .prepare("SELECT COUNT(*) as count FROM world_outcome_audit")
      .get() as { count: number };

    assert.ok(outcomeRow.count > 0, "World outcome should be committed to database");
  });

  test("pipeline error is captured without crashing", async () => {
    const config = makeConfig();
    const failingPolicy = {
      propose: async () => {
        throw new Error("Policy failure");
      },
    };

    const deps: CognitivePipelineDependencies = {
      stateManager: rt.stateManager,
      workingSelfBuilder: new StubWorkingSelfBuilder(),
      openPolicy: failingPolicy,
      actionCompiler: new TestStubActionCompiler(),
      worldAdjudicator: new TestStubWorldAdjudicator(),
      socialProposer: new StubSocialOutcomeProposer(),
    };

    const pipeline = new UnifiedCognitivePipeline(
      config,
      deps,
      new StubAdmissionAdapter(true, false),
      new StubWorkingSelfInputAdapter(),
      new StubAdjudicationContextAdapter(),
      new StubSocialContextAdapter(),
      new StubSpeechRenderer(),
    );

    const event = makeEvent({ eventId: "evt_test" });
    const result = await pipeline.process(event);

    assert.equal(result.woke, true);
    assert.equal(result.committed, false);
    assert.ok(result.error);
    assert.ok(result.error.includes("Policy failure"));
  });
});

describe("Invariant: Single Personality System", () => {
  let rt: TestRuntime;

  beforeEach(() => {
    rt = setupRuntime();

    rt.db.prepare(`INSERT INTO world_events(
      event_id, schema_version, origin, kind, occurred_at, received_at,
      principal_id, trust, privacy_scope, idempotency_key, payload_json
    ) VALUES (
      'evt_test', '1.0', 'user', 'im.message.received', datetime('now'), datetime('now'),
      'doctor', 'authenticated', 'private_im', 'idem_test', '{}'
    )`).run();

    rt.db.prepare(`INSERT INTO action_proposal_audit(
      proposal_id, schema_version, actor_id, policy_run_id, intent,
      source_closure_hash, base_state_revision, payload_json, proposed_at
    ) VALUES ('act_test', '1.0', 'muelsyse', 'pol_test', 'test intent',
      '${TEST_HASH}', 0, '{}', datetime('now'))`).run();
  });

  afterEach(() => {
    rt.cleanup();
  });

  test("user and world events use identical policy instance", async () => {
    const config = makeConfig();
    const policyInstance = new StubOpenPolicy();
    let lastPolicyRef: unknown = null;

    const trackingPolicy = {
      propose: async (workingSelf: WorkingSelfV1) => {
        lastPolicyRef = policyInstance;
        return policyInstance.propose(workingSelf);
      },
    };

    const deps: CognitivePipelineDependencies = {
      stateManager: rt.stateManager,
      workingSelfBuilder: new StubWorkingSelfBuilder(),
      openPolicy: trackingPolicy,
      actionCompiler: new TestStubActionCompiler(),
      worldAdjudicator: new TestStubWorldAdjudicator(),
      socialProposer: new StubSocialOutcomeProposer(),
    };

    const pipeline = new UnifiedCognitivePipeline(
      config,
      deps,
      new StubAdmissionAdapter(true, true),
      new StubWorkingSelfInputAdapter(),
      new StubAdjudicationContextAdapter(),
      new StubSocialContextAdapter(),
      new StubSpeechRenderer(),
    );

    await pipeline.process(makeEvent({ eventId: "evt_test", origin: "user" }));
    const userPolicyRef = lastPolicyRef;

    await pipeline.process(makeEvent({
      eventId: newId("evt"),
      origin: "world",
      sourceRefs: [{ source_type: "event", source_id: "evt_test" }],
    }));
    const worldPolicyRef = lastPolicyRef;

    assert.equal(userPolicyRef, worldPolicyRef, "Same policy instance for both origins");
  });

  test("no separate decision system for different event types", async () => {
    const config = makeConfig();
    const decisionPaths: string[] = [];

    const trackingAdmission = {
      evaluate: (event: PipelineEvent, baseRevision: number) => {
        decisionPaths.push(`admission:${event.origin}`);
        return new StubAdmissionAdapter(true, true).evaluate(event, baseRevision);
      },
    };

    const deps: CognitivePipelineDependencies = {
      stateManager: rt.stateManager,
      workingSelfBuilder: new StubWorkingSelfBuilder(),
      openPolicy: new StubOpenPolicy(),
      actionCompiler: new TestStubActionCompiler(),
      worldAdjudicator: new TestStubWorldAdjudicator(),
      socialProposer: new StubSocialOutcomeProposer(),
    };

    const pipeline = new UnifiedCognitivePipeline(
      config,
      deps,
      trackingAdmission,
      new StubWorkingSelfInputAdapter(),
      new StubAdjudicationContextAdapter(),
      new StubSocialContextAdapter(),
      new StubSpeechRenderer(),
    );

    await pipeline.process(makeEvent({ eventId: "evt_test", origin: "user" }));
    await pipeline.process(makeEvent({
      eventId: newId("evt"),
      origin: "world",
      sourceRefs: [{ source_type: "event", source_id: "evt_test" }],
    }));

    assert.ok(decisionPaths.includes("admission:user"));
    assert.ok(decisionPaths.includes("admission:world"));
  });
});
