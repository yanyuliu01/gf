import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type {
  AttentionIntentV1,
  CognitiveCapacityEnvelopeV2,
  CognitiveEpisodeEvidenceV2,
  SelfExperienceProposalV2,
} from "../generated/cognitiveRuntimeTypes.js";
import { SchemaRegistry } from "../validation/schemas.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const fixture = JSON.parse(
  readFileSync(
    join(ROOT, "tests", "contracts", "cognitive-runtime.valid.json"),
    "utf8",
  ),
) as Record<string, unknown>;

const contracts = {
  wake_candidate: "wake-candidate.schema.json",
  wake_decision: "wake-decision.schema.json",
  attention_intent: "attention-intent.schema.json",
  attention_subscription: "attention-subscription.schema.json",
  inference_usage_receipt: "inference-usage-receipt.schema.json",
  experienced_usage_breakdown: "experienced-usage-breakdown.schema.json",
  cognitive_energy_account: "cognitive-energy-account.schema.json",
  cognitive_energy_reservation: "cognitive-energy-reservation.schema.json",
  cognitive_energy_settlement: "cognitive-energy-settlement.schema.json",
  cognitive_capacity_envelope: "cognitive-capacity-envelope.schema.json",
  cognitive_episode_evidence: "cognitive-episode-evidence.schema.json",
  self_experience_proposal: "self-experience-proposal.schema.json",
} as const;

test("cognitive runtime fixtures satisfy every versioned schema", () => {
  const registry = new SchemaRegistry(join(ROOT, "schemas"));
  for (const [fixtureKey, schemaName] of Object.entries(contracts)) {
    registry.validate(schemaName, fixture[fixtureKey]);
  }
});

test("generated types preserve open subjective text and engine-only capacity", () => {
  const intent = fixture.attention_intent as AttentionIntentV1;
  const experience = fixture.self_experience_proposal as SelfExperienceProposalV2;
  const episode = fixture.cognitive_episode_evidence as CognitiveEpisodeEvidenceV2;
  const envelope = fixture.cognitive_capacity_envelope as CognitiveCapacityEnvelopeV2;

  assert.equal(typeof intent.future_change, "string");
  assert.equal(typeof experience.narrative, "string");
  assert.equal(episode.prompt_run_id, experience.policy_run_id);
  assert.equal(envelope.visibility, "engine_only");
  assert.equal("fatigue_level" in experience, false);
  assert.equal("account_snapshot" in episode, false);
});

test("schemas reject perception bypass and hidden-state labels", () => {
  const registry = new SchemaRegistry(join(ROOT, "schemas"));
  const subscription = structuredClone(
    fixture.attention_subscription as Record<string, unknown>,
  );
  subscription.perception_only = false;
  assert.equal(
    registry.isValid("attention-subscription.schema.json", subscription),
    false,
  );

  const experience = structuredClone(
    fixture.self_experience_proposal as Record<string, unknown>,
  );
  experience.fatigue_level = "high";
  assert.equal(
    registry.isValid("self-experience-proposal.schema.json", experience),
    false,
  );
});
