import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupRuntime, type TestRuntime, userEvent } from "./helpers.js";
import {
  UnifiedSpeechOutput,
  StubUnifiedSpeechOutput,
  hasCommunicationIntent,
  extractTextFromPlan,
  type SpeechIntent,
  type UnifiedSpeechConfig,
} from "../delivery/unifiedSpeech.js";
import type { OpenActionProposalV1 } from "../generated/agentPipelineTypes.js";
import { newId, utcnowIso } from "../domain/ids.js";

const TEST_HASH = "a".repeat(64);

function makeConfig(overrides: Partial<UnifiedSpeechConfig> = {}): UnifiedSpeechConfig {
  return {
    actorId: "muelsyse",
    channel: "private_im",
    proactiveEnabled: false,
    speechVersion: "test.v1",
    ...overrides,
  };
}

function makeActionProposal(
  intent: string = "communicate with doctor",
  plan: string[] = ["Hello, how can I help?"],
): OpenActionProposalV1 {
  return {
    schema_version: "1.0",
    proposal_id: newId("act"),
    actor_id: "muelsyse",
    policy_run_id: newId("pol"),
    intent,
    plan,
    source_refs: [{ source_type: "event", source_id: "evt_test" }],
    source_closure_hash: TEST_HASH,
    base_state_revision: 0,
    proposed_at: utcnowIso(),
  };
}

function makeSpeechIntent(
  trigger: "reactive" | "proactive" = "reactive",
  intent: string = "communicate with doctor",
): SpeechIntent {
  const proposal = makeActionProposal(intent);
  return {
    trigger,
    recipientPrincipalId: "doctor",
    text: proposal.plan?.[0] ?? "Hello",
    sourceRefs: proposal.source_refs,
    actionProposal: proposal,
    capabilityRevision: 0,
  };
}

describe("hasCommunicationIntent", () => {
  test("recognizes communicate", () => {
    assert.equal(hasCommunicationIntent("communicate with doctor"), true);
    assert.equal(hasCommunicationIntent("COMMUNICATE status update"), true);
  });

  test("recognizes reply", () => {
    assert.equal(hasCommunicationIntent("reply to message"), true);
    assert.equal(hasCommunicationIntent("send a reply"), true);
  });

  test("recognizes respond", () => {
    assert.equal(hasCommunicationIntent("respond to inquiry"), true);
  });

  test("recognizes say/tell/ask", () => {
    assert.equal(hasCommunicationIntent("say hello"), true);
    assert.equal(hasCommunicationIntent("tell doctor about status"), true);
    assert.equal(hasCommunicationIntent("ask for clarification"), true);
  });

  test("recognizes notify/inform/message", () => {
    assert.equal(hasCommunicationIntent("notify about completion"), true);
    assert.equal(hasCommunicationIntent("inform the user"), true);
    assert.equal(hasCommunicationIntent("message the doctor"), true);
  });

  test("rejects non-communication intents", () => {
    assert.equal(hasCommunicationIntent("observe specimen"), false);
    assert.equal(hasCommunicationIntent("move to lab"), false);
    assert.equal(hasCommunicationIntent("wait for results"), false);
    assert.equal(hasCommunicationIntent("continue observation"), false);
  });
});

describe("extractTextFromPlan", () => {
  test("returns first plan item", () => {
    assert.equal(extractTextFromPlan(["Hello", "Second"]), "Hello");
  });

  test("returns null for empty plan", () => {
    assert.equal(extractTextFromPlan([]), null);
  });

  test("returns null for undefined plan", () => {
    assert.equal(extractTextFromPlan(undefined), null);
  });
});

describe("M20-026: Unified Speech Output", () => {
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
  });

  afterEach(() => {
    rt.cleanup();
  });

  test("reactive speech submits through StateManager", () => {
    const config = makeConfig({ proactiveEnabled: false });
    const speechOutput = new UnifiedSpeechOutput(config, rt.stateManager);

    const event = userEvent("Hello");
    rt.stateManager.ingestEvent(event);
    const scene = rt.scenes.createOpenScene();
    const message = rt.db
      .prepare("SELECT message_id FROM messages WHERE event_id = ?")
      .get(event.event_id) as { message_id: string };

    const proposal = makeActionProposal("communicate status");
    proposal.source_refs = [{ source_type: "message", source_id: message.message_id }];
    const intent: SpeechIntent = {
      trigger: "reactive",
      recipientPrincipalId: "doctor",
      text: "Hello there",
      sourceRefs: proposal.source_refs,
      actionProposal: proposal,
      capabilityRevision: 0,
    };

    const result = speechOutput.submit(intent, event, scene.scene_id as string);

    assert.equal(result.submitted, true);
    assert.ok(result.speechId);
    assert.ok(result.outboxIds);
    assert.ok(result.outboxIds.length > 0);
  });

  test("proactive speech blocked when disabled", () => {
    const config = makeConfig({ proactiveEnabled: false });
    const speechOutput = new UnifiedSpeechOutput(config, rt.stateManager);

    const intent = makeSpeechIntent("proactive");
    const event = userEvent("Hello");
    rt.stateManager.ingestEvent(event);

    const result = speechOutput.submit(intent, event, newId("scene"));

    assert.equal(result.submitted, false);
    assert.equal(result.blocked, "proactive_disabled");
  });

  test("proactive speech submits when enabled", () => {
    const config = makeConfig({ proactiveEnabled: true });
    const speechOutput = new UnifiedSpeechOutput(config, rt.stateManager);

    const event = userEvent("Hello");
    rt.stateManager.ingestEvent(event);
    const scene = rt.scenes.createOpenScene();
    const message = rt.db
      .prepare("SELECT message_id FROM messages WHERE event_id = ?")
      .get(event.event_id) as { message_id: string };

    const proposal = makeActionProposal("communicate status");
    proposal.source_refs = [{ source_type: "message", source_id: message.message_id }];
    const intent: SpeechIntent = {
      trigger: "proactive",
      recipientPrincipalId: "doctor",
      text: "Hello there",
      sourceRefs: proposal.source_refs,
      actionProposal: proposal,
      capabilityRevision: 0,
    };

    const result = speechOutput.submit(intent, event, scene.scene_id as string);

    assert.equal(result.submitted, true);
    assert.ok(result.speechId);
  });

  test("empty text is blocked", () => {
    const config = makeConfig({ proactiveEnabled: true });
    const speechOutput = new UnifiedSpeechOutput(config, rt.stateManager);

    const intent = makeSpeechIntent("reactive");
    intent.text = "   ";
    const event = userEvent("Hello");
    rt.stateManager.ingestEvent(event);

    const result = speechOutput.submit(intent, event, newId("scene"));

    assert.equal(result.submitted, false);
    assert.equal(result.blocked, "empty_text");
  });

  test("non-communication intent is blocked", () => {
    const config = makeConfig({ proactiveEnabled: true });
    const speechOutput = new UnifiedSpeechOutput(config, rt.stateManager);

    const intent = makeSpeechIntent("reactive", "observe specimen");
    const event = userEvent("Hello");
    rt.stateManager.ingestEvent(event);

    const result = speechOutput.submit(intent, event, newId("scene"));

    assert.equal(result.submitted, false);
    assert.equal(result.blocked, "no_intent");
  });

  test("createIntentFromPolicy returns intent for communication", () => {
    const config = makeConfig();
    const speechOutput = new UnifiedSpeechOutput(config, rt.stateManager);

    const proposal = makeActionProposal("communicate status");
    const intent = speechOutput.createIntentFromPolicy(
      proposal,
      "reactive",
      "doctor",
      0,
    );

    assert.ok(intent);
    assert.equal(intent.trigger, "reactive");
    assert.equal(intent.recipientPrincipalId, "doctor");
    assert.equal(intent.text, proposal.plan?.[0]);
  });

  test("createIntentFromPolicy returns null for non-communication", () => {
    const config = makeConfig();
    const speechOutput = new UnifiedSpeechOutput(config, rt.stateManager);

    const proposal = makeActionProposal("observe specimen");
    const intent = speechOutput.createIntentFromPolicy(
      proposal,
      "reactive",
      "doctor",
      0,
    );

    assert.equal(intent, null);
  });
});

describe("Same path invariant", () => {
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
  });

  afterEach(() => {
    rt.cleanup();
  });

  test("reactive and proactive use same SurfaceMessage structure", () => {
    const config = makeConfig({ proactiveEnabled: true });
    const speechOutput = new UnifiedSpeechOutput(config, rt.stateManager);

    const event = userEvent("Hello");
    rt.stateManager.ingestEvent(event);
    const scene = rt.scenes.createOpenScene();
    const message = rt.db
      .prepare("SELECT message_id FROM messages WHERE event_id = ?")
      .get(event.event_id) as { message_id: string };

    const proposal = makeActionProposal("communicate status");
    proposal.source_refs = [{ source_type: "message", source_id: message.message_id }];

    const reactiveIntent: SpeechIntent = {
      trigger: "reactive",
      recipientPrincipalId: "doctor",
      text: "Reactive reply",
      sourceRefs: proposal.source_refs,
      actionProposal: proposal,
      capabilityRevision: 0,
    };
    const proactiveIntent: SpeechIntent = {
      trigger: "proactive",
      recipientPrincipalId: "doctor",
      text: "Proactive message",
      sourceRefs: proposal.source_refs,
      actionProposal: proposal,
      capabilityRevision: 0,
    };

    const reactiveResult = speechOutput.submit(
      reactiveIntent,
      event,
      scene.scene_id as string,
    );
    const proactiveResult = speechOutput.submit(
      proactiveIntent,
      event,
      scene.scene_id as string,
    );

    assert.equal(reactiveResult.submitted, true);
    assert.equal(proactiveResult.submitted, true);
    assert.ok(reactiveResult.speechId?.startsWith("sp_"));
    assert.ok(proactiveResult.speechId?.startsWith("sp_"));
  });

  test("both types go through outbox", () => {
    const config = makeConfig({ proactiveEnabled: true });
    const speechOutput = new UnifiedSpeechOutput(config, rt.stateManager);

    const event = userEvent("Hello");
    rt.stateManager.ingestEvent(event);
    const scene = rt.scenes.createOpenScene();
    const message = rt.db
      .prepare("SELECT message_id FROM messages WHERE event_id = ?")
      .get(event.event_id) as { message_id: string };

    const proposal = makeActionProposal("communicate status");
    proposal.source_refs = [{ source_type: "message", source_id: message.message_id }];

    const reactiveIntent: SpeechIntent = {
      trigger: "reactive",
      recipientPrincipalId: "doctor",
      text: "Reactive reply",
      sourceRefs: proposal.source_refs,
      actionProposal: proposal,
      capabilityRevision: 0,
    };
    const proactiveIntent: SpeechIntent = {
      trigger: "proactive",
      recipientPrincipalId: "doctor",
      text: "Proactive message",
      sourceRefs: proposal.source_refs,
      actionProposal: proposal,
      capabilityRevision: 0,
    };

    const reactiveResult = speechOutput.submit(
      reactiveIntent,
      event,
      scene.scene_id as string,
    );
    const proactiveResult = speechOutput.submit(
      proactiveIntent,
      event,
      scene.scene_id as string,
    );

    assert.ok(reactiveResult.outboxIds);
    assert.ok(proactiveResult.outboxIds);
    assert.ok(reactiveResult.outboxIds.length > 0);
    assert.ok(proactiveResult.outboxIds.length > 0);

    const outboxRows = rt.db
      .prepare("SELECT outbox_id FROM outbox")
      .all() as { outbox_id: string }[];

    assert.ok(outboxRows.length >= 2, "Both should have outbox entries");
  });
});

describe("StubUnifiedSpeechOutput", () => {
  test("records submitted intents", () => {
    const stub = new StubUnifiedSpeechOutput();

    const intent1 = makeSpeechIntent("reactive");
    const intent2 = makeSpeechIntent("proactive");
    const event = {
      schema_version: "1.0",
      event_id: "evt_test",
      origin: "user" as const,
      kind: "test",
      occurred_at: utcnowIso(),
      received_at: utcnowIso(),
      provenance: { principal_id: "doctor", trust: "authenticated" },
      privacy_scope: "private_im",
      idempotency_key: "test",
      payload: {},
    };

    stub.submit(intent1, event, newId("scene"));
    stub.submit(intent2, event, newId("scene"));

    const submitted = stub.getSubmittedIntents();
    assert.equal(submitted.length, 2);
    assert.equal(submitted[0].trigger, "reactive");
    assert.equal(submitted[1].trigger, "proactive");
  });

  test("can simulate blocked state", () => {
    const stub = new StubUnifiedSpeechOutput(false, "proactive_disabled");

    const intent = makeSpeechIntent("proactive");
    const event = {
      schema_version: "1.0",
      event_id: "evt_test",
      origin: "user" as const,
      kind: "test",
      occurred_at: utcnowIso(),
      received_at: utcnowIso(),
      provenance: { principal_id: "doctor", trust: "authenticated" },
      privacy_scope: "private_im",
      idempotency_key: "test",
      payload: {},
    };

    const result = stub.submit(intent, event, newId("scene"));

    assert.equal(result.submitted, false);
    assert.equal(result.blocked, "proactive_disabled");
  });
});
