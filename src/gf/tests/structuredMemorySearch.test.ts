import assert from "node:assert/strict";
import test from "node:test";

import { StructuredMemorySearch } from "../cognition/memory/structuredMemorySearch.js";
import type {
  MemoryIndexDocumentV1,
  ObservationV1,
  SourceRef,
} from "../generated/agentPipelineTypes.js";
import { connect } from "../state/db.js";
import {
  CommitRejected,
  type WorldEvent,
} from "../state/stateManager.js";
import { computeInputClosureHash } from "../validation/derivedInputClosure.js";
import { setupRuntime, type TestRuntime } from "./helpers.js";

function event(eventId: string, occurredAt: string): WorldEvent {
  return {
    schema_version: "1.0",
    event_id: eventId,
    origin: "system",
    kind: "world.memory.fixture",
    channel: null,
    occurred_at: occurredAt,
    received_at: occurredAt,
    world_day: 1,
    world_phase: "morning",
    provenance: {
      principal_id: "world-engine",
      connector_id: "world:local",
      trust: "verified",
    },
    privacy_scope: "internal",
    causation_event_id: null,
    correlation_id: "memory-search",
    idempotency_key: `memory:${eventId}`,
    payload: { fixture: eventId },
  };
}

function seedActionOutcome(
  rt: TestRuntime,
  suffix: string,
  intent: string,
  summary: string,
  constraints: string[],
): { proposalId: string; outcomeId: string } {
  const proposalId = `action-${suffix}`;
  const outcomeId = `outcome-${suffix}`;
  rt.db.prepare(
    `
    INSERT INTO action_proposal_audit(
      proposal_id, schema_version, actor_id, policy_run_id, intent,
      source_closure_hash, base_state_revision, payload_json, proposed_at
    ) VALUES (?, '1.0', 'muelsyse', ?, ?, ?, 0, '{}', ?)
    `,
  ).run(
    proposalId,
    `run-${suffix}`,
    intent,
    "a".repeat(64),
    "2026-08-29T09:00:00+08:00",
  );
  rt.db.prepare(
    `
    INSERT INTO world_outcome_audit(
      outcome_id, schema_version, action_proposal_id, actor_id, status,
      summary, hard_constraint_classes_json, proposed_effects_json,
      adjudicator_version, rule_version, source_closure_hash,
      base_state_revision, payload_json, proposed_at
    ) VALUES (?, '1.0', ?, 'muelsyse', 'rejected', ?, ?, '[]',
              'adjudicator.v1', 'rules.v1', ?, 0, '{}', ?)
    `,
  ).run(
    outcomeId,
    proposalId,
    summary,
    JSON.stringify(constraints),
    "b".repeat(64),
    "2026-08-29T09:00:01+08:00",
  );
  return { proposalId, outcomeId };
}

function outcomeDocument(options: {
  documentId: string;
  eventId: string;
  content: string;
  entityId: string;
  proposalId: string;
  outcomeId: string;
  intent: string;
  summary: string;
  closureHash: string;
  occurredAt: string;
}): MemoryIndexDocumentV1 {
  return {
    schema_version: "1.0",
    document_id: options.documentId,
    actor_id: "muelsyse",
    memory_kind: "action_outcome",
    content: options.content,
    visibility_scope: "internal",
    epistemic_status: "verified",
    entity_ids: [options.entityId],
    relationship_ids: [],
    commitment_ids: [],
    action_outcome: {
      action_proposal_id: options.proposalId,
      outcome_id: options.outcomeId,
      action_intent: options.intent,
      outcome_status: "rejected",
      outcome_summary: options.summary,
      hard_constraint_classes: ["location"],
    },
    source_artifact_kind: "world_outcome",
    source_artifact_id: options.outcomeId,
    source_refs: [{ source_type: "event", source_id: options.eventId }],
    occurred_at: options.occurredAt,
    index_version: "memory-index.v1",
    base_state_revision: 0,
    input_closure_hash: options.closureHash,
  };
}

async function seededSearchRuntime(): Promise<{
  rt: TestRuntime;
  search: StructuredMemorySearch;
  documents: MemoryIndexDocumentV1[];
  inputSources: SourceRef[];
}> {
  const rt = setupRuntime();
  const pumpEvent = event("evt-pump", "2026-08-29T09:00:00+08:00");
  const courierEvent = event("evt-courier", "2026-08-29T10:00:00+08:00");
  const conversationEvent = event("evt-conversation", "2026-08-29T11:00:00+08:00");
  for (const item of [pumpEvent, courierEvent, conversationEvent]) {
    rt.stateManager.ingestEvent(item);
  }

  const observationSources: SourceRef[] = [
    { source_type: "event", source_id: conversationEvent.event_id },
  ];
  const observationHash = computeInputClosureHash(0, observationSources);
  const observation: ObservationV1 = {
    schema_version: "1.0",
    observation_id: "observation-conversation",
    actor_id: "muelsyse",
    summary: "博士在私聊里补充了 S-4 的观察。",
    sensing_basis: "direct_message",
    subject_ids: ["s4", "doctor"],
    location_id: null,
    privacy_scope: "private_im",
    source_refs: observationSources,
    observed_at: conversationEvent.occurred_at,
    projection_version: "perception-projector.v1",
    base_state_revision: 0,
    input_closure_hash: observationHash,
  };
  rt.stateManager.submitCognitiveArtifacts(
    { observations: [observation] },
    { inputSources: observationSources },
  );

  const pumpIntent = "Repair the irrigation manifold in the sealed greenhouse";
  const pumpSummary = "Rejected because the actor was not at the greenhouse";
  const pump = seedActionOutcome(rt, "pump", pumpIntent, pumpSummary, ["location"]);
  const courierIntent = "Book a courier pickup beyond the approved depot";
  const courierSummary = "Rejected because the actor was outside the depot";
  const courier = seedActionOutcome(
    rt,
    "courier",
    courierIntent,
    courierSummary,
    ["location"],
  );

  const inputSources: SourceRef[] = [
    { source_type: "event", source_id: pumpEvent.event_id },
    { source_type: "event", source_id: courierEvent.event_id },
    { source_type: "event", source_id: conversationEvent.event_id },
  ];
  const closureHash = computeInputClosureHash(0, inputSources);
  const documents: MemoryIndexDocumentV1[] = [
    outcomeDocument({
      documentId: "memory-pump-location",
      eventId: pumpEvent.event_id,
      content: "I tried to service the irrigation assembly but could not enter the site.",
      entityId: "pump-1",
      proposalId: pump.proposalId,
      outcomeId: pump.outcomeId,
      intent: pumpIntent,
      summary: pumpSummary,
      closureHash,
      occurredAt: pumpEvent.occurred_at,
    }),
    outcomeDocument({
      documentId: "memory-courier-location",
      eventId: courierEvent.event_id,
      content: "A freight collection request stopped before dispatch from the depot.",
      entityId: "supplier-route",
      proposalId: courier.proposalId,
      outcomeId: courier.outcomeId,
      intent: courierIntent,
      summary: courierSummary,
      closureHash,
      occurredAt: courierEvent.occurred_at,
    }),
    {
      schema_version: "1.0",
      document_id: "memory-private-conversation",
      actor_id: "muelsyse",
      memory_kind: "episodic",
      content: "博士在私聊里补充了 S-4 的观察。",
      visibility_scope: "private_im",
      epistemic_status: "reported",
      entity_ids: ["s4", "doctor"],
      relationship_ids: ["relationship-doctor"],
      commitment_ids: ["commitment-s4-followup"],
      action_outcome: null,
      source_artifact_kind: "observation",
      source_artifact_id: observation.observation_id,
      source_refs: observationSources,
      occurred_at: conversationEvent.occurred_at,
      index_version: "memory-index.v1",
      base_state_revision: 0,
      input_closure_hash: closureHash,
    },
  ];
  rt.stateManager.submitMemoryIndexDocuments(documents, { inputSources });
  return {
    rt,
    search: new StructuredMemorySearch(() => connect(rt.dbPath)),
    documents,
    inputSources,
  };
}

test("migration 004 installs structured memory tables and FTS5", () => {
  const rt = setupRuntime();
  try {
    const version = rt.db
      .prepare("SELECT version FROM schema_migrations WHERE version = '004'")
      .get() as { version: string };
    assert.equal(version.version, "004");
    const names = new Set(
      (rt.db.prepare("SELECT name FROM sqlite_master").all() as { name: string }[])
        .map((row) => row.name),
    );
    assert.ok(names.has("memory_index_documents"));
    assert.ok(names.has("memory_index_outcome_constraints"));
    assert.ok(names.has("memory_index_fts"));
    assert.equal([...names].some((name) => name.toLowerCase().includes("vector")), false);
  } finally {
    rt.cleanup();
  }
});

test("shared adjudication shape survives zero lexical overlap and FTS only reranks", async () => {
  const { rt, search } = await seededSearchRuntime();
  try {
    const hits = await search.search({
      actorId: "muelsyse",
      visiblePrivacyScopes: ["internal"],
      outcomeStatuses: ["rejected"],
      hardConstraintClasses: ["location"],
      text: "irrigation",
      limit: 10,
    });
    assert.deepEqual(
      hits.map((hit) => hit.document.document_id),
      ["memory-pump-location", "memory-courier-location"],
    );
    assert.notEqual(hits[0].ftsRank, null);
    assert.equal(hits[1].ftsRank, null);
    assert.equal(
      hits[1].document.content.toLowerCase().includes("irrigation"),
      false,
    );
  } finally {
    rt.cleanup();
  }
});

test("entity, visibility, time, relationship, commitment, and epistemic filters compose", async () => {
  const { rt, search } = await seededSearchRuntime();
  try {
    const privateHit = await search.search({
      actorId: "muelsyse",
      visiblePrivacyScopes: ["private_im"],
      entityIds: ["s4"],
      relationshipIds: ["relationship-doctor"],
      commitmentIds: ["commitment-s4-followup"],
      epistemicStatuses: ["reported"],
      memoryKinds: ["episodic"],
      occurredFrom: "2026-08-29T10:30:00+08:00",
      occurredTo: "2026-08-29T11:30:00+08:00",
    });
    assert.deepEqual(
      privateHit.map((hit) => hit.document.document_id),
      ["memory-private-conversation"],
    );

    const invisible = await search.search({
      actorId: "muelsyse",
      visiblePrivacyScopes: ["internal"],
      relationshipIds: ["relationship-doctor"],
    });
    assert.deepEqual(invisible, []);
  } finally {
    rt.cleanup();
  }
});

test("memory index cannot rewrite the stored adjudication outcome", async () => {
  const { rt, documents, inputSources } = await seededSearchRuntime();
  try {
    const forged = structuredClone(documents[0]);
    forged.document_id = "memory-forged-outcome";
    if (!forged.action_outcome) throw new Error("fixture requires outcome");
    forged.action_outcome.outcome_summary = "Accepted and completed";
    assert.throws(
      () => rt.stateManager.submitMemoryIndexDocuments(
        [forged],
        { inputSources },
      ),
      CommitRejected,
    );
    const count = rt.db
      .prepare("SELECT COUNT(*) AS n FROM memory_index_documents")
      .get() as { n: number };
    assert.equal(Number(count.n), 3);
  } finally {
    rt.cleanup();
  }
});
