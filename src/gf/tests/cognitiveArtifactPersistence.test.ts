import assert from "node:assert/strict";
import test from "node:test";

import {
  PerceptionProjector,
  type PerceptionCandidate,
} from "../cognition/perception/perceptionProjector.js";
import type { BeliefProposalV1 } from "../generated/agentPipelineTypes.js";
import {
  CommitRejected,
  type WorldEvent,
} from "../state/stateManager.js";
import { setupRuntime } from "./helpers.js";

function worldEvent(eventId: string, summary: string): WorldEvent {
  return {
    schema_version: "1.0",
    event_id: eventId,
    origin: "system",
    kind: "world.s4.changed",
    channel: null,
    occurred_at: "2026-08-29T09:00:00+08:00",
    received_at: "2026-08-29T09:00:00+08:00",
    world_day: 1,
    world_phase: "morning",
    provenance: {
      principal_id: "world-engine",
      connector_id: "world:local",
      trust: "verified",
    },
    privacy_scope: "internal",
    causation_event_id: null,
    correlation_id: "s4-cycle",
    idempotency_key: `world:${eventId}`,
    payload: { summary },
  };
}

function candidate(
  eventId: string,
  summary: string,
  visibility: PerceptionCandidate["visibility"],
): PerceptionCandidate {
  return {
    summary,
    occurred_at: "2026-08-29T09:00:00+08:00",
    privacy_scope: "internal",
    subject_ids: ["s4"],
    source_refs: [{ source_type: "event", source_id: eventId }],
    provenance: {
      kind: "world_event",
      principal_id: "world-engine",
      trust: "verified",
    },
    visibility,
  };
}

function projection(candidates: PerceptionCandidate[]) {
  return new PerceptionProjector().project({
    actor_id: "muelsyse",
    actor_location_id: "ecology-garden",
    private_channel_ids: [],
    public_channel_ids: [],
    device_feed_ids: [],
    authorized_record_ids: [],
    candidates,
    projected_at: "2026-08-29T09:00:01+08:00",
    projection_version: "perception-projector.v1",
    base_state_revision: 0,
  });
}

function belief(
  inputClosureHash: string,
  sourceEventId: string,
  overrides: Partial<BeliefProposalV1> = {},
): BeliefProposalV1 {
  return {
    schema_version: "1.0",
    proposal_id: "belief-s4-water",
    actor_id: "muelsyse",
    content: "S-4 的卷叶可能与根区供水不足有关，但仍需复核。",
    status: "proposed",
    epistemic_status: "inferred",
    source_refs: [{ source_type: "event", source_id: sourceEventId }],
    proposal_version: "belief-proposal.v1",
    base_state_revision: 0,
    input_closure_hash: inputClosureHash,
    proposed_at: "2026-08-29T09:00:02+08:00",
    ...overrides,
  };
}

test("StateManager atomically persists subjective artifacts without copying world truth", () => {
  const rt = setupRuntime();
  try {
    const event = worldEvent("evt-s4-visible", "S-4 叶缘卷曲");
    rt.stateManager.ingestEvent(event);
    const perceived = projection([
      candidate(event.event_id, "S-4 的叶缘出现轻微卷曲。", {
        kind: "co_located",
        location_id: "ecology-garden",
      }),
    ]);
    const proposal = belief(perceived.input_closure_hash, event.event_id);

    const result = rt.stateManager.submitCognitiveArtifacts(
      {
        observations: perceived.observations,
        beliefProposals: [proposal],
      },
      { inputSources: perceived.source_refs },
    );
    assert.equal(result.committed, true);
    assert.equal(result.replay, false);
    assert.deepEqual(result.observationIds, [perceived.observations[0].observation_id]);
    assert.deepEqual(result.beliefProposalIds, [proposal.proposal_id]);

    assert.equal(count(rt, "observations"), 1);
    assert.equal(count(rt, "observation_sources"), 1);
    assert.equal(count(rt, "belief_proposals"), 1);
    assert.equal(count(rt, "belief_proposal_sources"), 1);
    assert.equal(count(rt, "derived_input_closures"), 2);
    assert.equal(count(rt, "derived_input_sources"), 2);
    assert.equal(count(rt, "world_events"), 1);
    assert.equal(count(rt, "claims"), 0);
    assert.equal(count(rt, "operation_commits"), 0);
    assert.equal(rt.state.currentRevision(), 0);

    const storedObservation = rt.db
      .prepare("SELECT actor_id, summary, payload_json FROM observations")
      .get() as { actor_id: string; summary: string; payload_json: string };
    assert.equal(storedObservation.actor_id, "muelsyse");
    assert.equal(storedObservation.summary, perceived.observations[0].summary);
    assert.deepEqual(
      JSON.parse(storedObservation.payload_json),
      perceived.observations[0],
    );

    const replay = rt.stateManager.submitCognitiveArtifacts(
      {
        observations: perceived.observations,
        beliefProposals: [proposal],
      },
      { inputSources: perceived.source_refs },
    );
    assert.equal(replay.committed, false);
    assert.equal(replay.replay, true);
    assert.equal(count(rt, "observations"), 1);
    assert.equal(count(rt, "belief_proposals"), 1);
  } finally {
    rt.cleanup();
  }
});

test("stored but unseen world events cannot enter subjective persistence", () => {
  const rt = setupRuntime();
  try {
    const visible = worldEvent("evt-visible", "可见卷叶");
    const hidden = worldEvent("evt-hidden", "隐藏泵压");
    rt.stateManager.ingestEvent(visible);
    rt.stateManager.ingestEvent(hidden);
    const perceived = projection([
      candidate(visible.event_id, "我看到 S-4 卷叶。", {
        kind: "co_located",
        location_id: "ecology-garden",
      }),
      candidate(hidden.event_id, "泵压下降。", { kind: "hidden" }),
    ]);
    const leakedBelief = belief(
      perceived.input_closure_hash,
      hidden.event_id,
    );

    assert.throws(
      () => rt.stateManager.submitCognitiveArtifacts(
        {
          observations: perceived.observations,
          beliefProposals: [leakedBelief],
        },
        { inputSources: perceived.source_refs },
      ),
      CommitRejected,
    );
    assert.equal(count(rt, "observations"), 0);
    assert.equal(count(rt, "belief_proposals"), 0);
    assert.equal(count(rt, "derived_input_closures"), 0);
    assert.equal(count(rt, "world_events"), 2);
    assert.equal(rt.state.currentRevision(), 0);
  } finally {
    rt.cleanup();
  }
});

test("belief acceptance and forged input hashes fail before persistence", () => {
  const rt = setupRuntime();
  try {
    const event = worldEvent("evt-s4", "S-4 叶缘卷曲");
    rt.stateManager.ingestEvent(event);
    const perceived = projection([
      candidate(event.event_id, "我看到 S-4 卷叶。", {
        kind: "co_located",
        location_id: "ecology-garden",
      }),
    ]);

    assert.throws(
      () => rt.stateManager.submitCognitiveArtifacts(
        {
          beliefProposals: [belief(
            perceived.input_closure_hash,
            event.event_id,
            { status: "accepted" },
          )],
        },
        { inputSources: perceived.source_refs },
      ),
      CommitRejected,
    );

    const forgedObservation = {
      ...perceived.observations[0],
      input_closure_hash: "f".repeat(64),
    };
    assert.throws(
      () => rt.stateManager.submitCognitiveArtifacts(
        { observations: [forgedObservation] },
        { inputSources: perceived.source_refs },
      ),
      CommitRejected,
    );
    assert.equal(count(rt, "observations"), 0);
    assert.equal(count(rt, "belief_proposals"), 0);
  } finally {
    rt.cleanup();
  }
});

function count(rt: ReturnType<typeof setupRuntime>, table: string): number {
  const row = rt.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
    n: number;
  };
  return Number(row.n);
}
