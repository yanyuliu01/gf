/**
 * GENERATED FILE. DO NOT EDIT.
 * Source: schemas/agent-pipeline.schema.json and schemas/common.schema.json
 * Regenerate with: npm run generate:types
 */

export type Id = string;

export type Timestamp = string;

export type PrivacyScope = "internal" | "private_im" | "public_allowed";

export interface SourceRef {
  "source_type": "message" | "event" | "claim" | "external_action" | "canon";
  "source_id": Id;
  "quote_hash"?: string | null;
  "observed_at"?: Timestamp | null;
}

export type SourceRefs = SourceRef[];

export type Sha256Hash = string;

export interface ObservationV1 {
  "schema_version": "1.0";
  "observation_id": Id;
  "actor_id": Id;
  "summary": string;
  "sensing_basis": "co_located" | "direct_message" | "public_channel" | "device_feed" | "npc_report" | "authorized_record";
  "subject_ids"?: Id[];
  "location_id"?: Id | null;
  "privacy_scope"?: PrivacyScope;
  "source_refs": SourceRefs;
  "observed_at": Timestamp;
  "projection_version": Id;
  "base_state_revision": number;
  "input_closure_hash": Sha256Hash;
}

export interface MemoryEvidenceV1 {
  "memory_id": Id;
  "kind": "episodic" | "belief" | "relationship_evidence" | "open_loop" | "self_statement" | "cognitive_episode";
  "summary": string;
  "source_refs": SourceRefs;
  "as_of": Timestamp;
}

export interface InputClosureV1 {
  "source_refs": SourceRefs;
  "closure_hash": Sha256Hash;
  "base_state_revision": number;
}

export interface MemoryBundleV1 {
  "schema_version": "1.0";
  "bundle_id": Id;
  "actor_id": Id;
  "evidence": MemoryEvidenceV1[];
  "supporting_memory_ids": Id[];
  "counter_memory_ids": Id[];
  "input_closure": InputClosureV1;
  "retrieval_version": Id;
  "retrieved_at": Timestamp;
}

export interface WorkingSelfEvidenceV1 {
  "evidence_id": Id;
  "role": "current_input" | "safety" | "current_fact" | "commitment_evidence" | "activity" | "memory" | "belief" | "open_loop" | "counter_evidence" | "persona" | "lived_evidence";
  "narrative": string;
  "source_refs": SourceRefs;
  "as_of"?: Timestamp | null;
}

export interface WorkingSelfV1 {
  "schema_version": "1.0";
  "working_self_id": Id;
  "episode_id": Id;
  "actor_id": Id;
  "evidence": WorkingSelfEvidenceV1[];
  "input_closure": InputClosureV1;
  "assembler_version": Id;
  "assembled_at": Timestamp;
}

export interface OpenActionProposalV1 {
  "schema_version": "1.0";
  "proposal_id": Id;
  "actor_id": Id;
  "policy_run_id": Id;
  "intent": string;
  "plan"?: string[];
  "source_refs": SourceRefs;
  "source_closure_hash": Sha256Hash;
  "base_state_revision": number;
  "proposed_at": Timestamp;
}

export interface ProposedWorldEffectV1 {
  "effect_id": Id;
  "kind": string;
  "summary": string;
  "source_refs": SourceRefs;
  "privacy_scope"?: PrivacyScope;
}

export interface WorldOutcomeProposalV1 {
  "schema_version": "1.0";
  "outcome_id": Id;
  "action_proposal_id": Id;
  "actor_id": Id;
  "status": "accepted" | "partial" | "rejected" | "deferred" | "interrupted";
  "summary": string;
  "hard_constraint_classes": ("location" | "time" | "resource" | "capability" | "knowledge" | "permission" | "world_rule")[];
  "proposed_effects": ProposedWorldEffectV1[];
  "source_refs": SourceRefs;
  "adjudicator_version": Id;
  "rule_version": Id;
  "source_closure_hash": Sha256Hash;
  "base_state_revision": number;
  "proposed_at": Timestamp;
}
