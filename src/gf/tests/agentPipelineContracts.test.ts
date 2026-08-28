import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type {
  MemoryBundleV1,
  ObservationV1,
  OpenActionProposalV1,
  SourceRef,
  WorkingSelfV1,
  WorldOutcomeProposalV1,
} from "../generated/agentPipelineTypes.js";
import { SchemaRegistry } from "../validation/schemas.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const fixture = JSON.parse(
  readFileSync(
    join(ROOT, "tests", "contracts", "agent-pipeline.valid.json"),
    "utf8",
  ),
) as Record<string, unknown>;

const contracts = {
  observation: "observation.schema.json",
  memory_bundle: "memory-bundle.schema.json",
  working_self: "working-self.schema.json",
  open_action_proposal: "open-action-proposal.schema.json",
  world_outcome_proposal: "world-outcome-proposal.schema.json",
} as const;

function keys(refs: readonly SourceRef[]): Set<string> {
  return new Set(refs.map((ref) => `${ref.source_type}:${ref.source_id}`));
}

test("final agent pipeline fixtures satisfy versioned schemas", () => {
  const registry = new SchemaRegistry(join(ROOT, "schemas"));
  for (const [fixtureKey, schemaName] of Object.entries(contracts)) {
    registry.validate(schemaName, fixture[fixtureKey]);
  }

  const observation = fixture.observation as ObservationV1;
  const memory = fixture.memory_bundle as MemoryBundleV1;
  const workingSelf = fixture.working_self as WorkingSelfV1;
  const action = fixture.open_action_proposal as OpenActionProposalV1;
  const outcome = fixture.world_outcome_proposal as WorldOutcomeProposalV1;
  assert.equal(observation.actor_id, memory.actor_id);
  assert.equal(memory.actor_id, workingSelf.actor_id);
  assert.equal(workingSelf.actor_id, action.actor_id);
  assert.equal(action.proposal_id, outcome.action_proposal_id);
});

test("Working Self and open action remain source-closed", () => {
  const workingSelf = fixture.working_self as WorkingSelfV1;
  const action = fixture.open_action_proposal as OpenActionProposalV1;
  const closure = keys(workingSelf.input_closure.source_refs);

  for (const evidence of workingSelf.evidence) {
    for (const source of keys(evidence.source_refs)) {
      assert.ok(closure.has(source));
    }
  }
  for (const source of keys(action.source_refs)) {
    assert.ok(closure.has(source));
  }
  assert.equal(
    action.source_closure_hash,
    workingSelf.input_closure.closure_hash,
  );
});

test("contracts reject hidden state, finite actions, and claimed success", () => {
  const registry = new SchemaRegistry(join(ROOT, "schemas"));

  const workingSelf = structuredClone(
    fixture.working_self as Record<string, unknown>,
  );
  workingSelf.affect_state = { valence: -0.4 };
  assert.equal(registry.isValid("working-self.schema.json", workingSelf), false);

  const action = structuredClone(
    fixture.open_action_proposal as Record<string, unknown>,
  );
  action.action_type = "observe";
  assert.equal(
    registry.isValid("open-action-proposal.schema.json", action),
    false,
  );

  const outcome = structuredClone(
    fixture.world_outcome_proposal as WorldOutcomeProposalV1,
  );
  outcome.proposed_effects = [];
  assert.equal(
    registry.isValid("world-outcome-proposal.schema.json", outcome),
    false,
  );
});
