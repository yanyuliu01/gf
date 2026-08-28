/**
 * GENERATED FILE. DO NOT EDIT.
 * Source: schemas/cognitive-runtime.schema.json and schemas/common.schema.json
 * Regenerate with: npm run generate:types
 */

export type Id = string;

export type Timestamp = string;

export interface SourceRef {
  "source_type": "message" | "event" | "claim" | "external_action" | "canon";
  "source_id": Id;
  "quote_hash"?: string | null;
  "observed_at"?: Timestamp | null;
}

export type SourceRefs = SourceRef[];

export type Sha256Hash = string;

export type CognitivePurpose = "appraisal" | "policy" | "npc_policy" | "surface" | "reflection";

export type CognitiveAccessClass = "autonomous" | "reply" | "safety";

export interface WakeCandidateV1 {
  "schema_version": "1.0";
  "candidate_id": Id;
  "actor_id": Id;
  "committed_revision": number;
  "observation_refs": SourceRefs;
  "boundary_kind": "observable_change" | "activity_boundary" | "runtime_hard_interrupt" | "attention_match" | "accumulated_signal";
  "occurred_at": Timestamp;
  "input_closure_hash": Sha256Hash;
}

export interface WakeDecisionV1 {
  "schema_version": "1.0";
  "decision_id": Id;
  "candidate_id": Id;
  "actor_id": Id;
  "disposition": "ignore" | "accumulate" | "wake";
  "queue_lane": "none" | "background" | "normal" | "reply" | "safety";
  "reason_codes": ("observable_change" | "current_activity_boundary" | "runtime_hard_interrupt" | "attention_subscription_match" | "accumulated_signal" | "no_material_change" | "deduplicated" | "non_recursive_internal_change" | "insufficient_observable_evidence")[];
  "matched_rule_ids": Id[];
  "observation_refs": SourceRefs;
  "gate_version": Id;
  "parameter_version": Id;
  "base_state_revision": number;
  "input_closure_hash": Sha256Hash;
  "decided_at": Timestamp;
}

export interface AttentionScopeV1 {
  "kind": "activity" | "object" | "time_window" | "commitment" | "plan" | "concern";
  "subject_refs": SourceRefs;
  "valid_until"?: Timestamp | null;
}

export interface AttentionIntentV1 {
  "schema_version": "1.0";
  "intent_id": Id;
  "actor_id": Id;
  "concern": string;
  "future_change": string;
  "scope": AttentionScopeV1;
  "lifecycle": "active" | "suspended" | "cancelled" | "expired" | "completed" | "superseded";
  "evidence_refs": SourceRefs;
  "policy_run_id": Id;
  "source_closure_hash": Sha256Hash;
  "base_state_revision": number;
  "created_at": Timestamp;
  "supersedes_intent_id"?: Id | null;
}

export interface ObservableFilterV1 {
  "event_kinds": string[];
  "entity_ids": Id[];
  "location_ids": Id[];
  "match_mode": "any" | "all";
}

export interface AttentionSubscriptionV1 {
  "schema_version": "1.0";
  "subscription_id": Id;
  "intent_id": Id;
  "actor_id": Id;
  "status": "active" | "suspended" | "cancelled" | "expired" | "completed" | "superseded";
  "observable_filter": ObservableFilterV1;
  "perception_only": true;
  "evidence_refs": SourceRefs;
  "compiler_version": Id;
  "base_state_revision": number;
  "created_at": Timestamp;
  "expires_at"?: Timestamp | null;
}

export interface InferenceUsageReceiptV1 {
  "schema_version": "1.0";
  "receipt_id": Id;
  "prompt_run_id": Id;
  "provider_request_id": string;
  "model_id": string;
  "tokenizer_version": string;
  "input_tokens": number;
  "cached_input_tokens"?: number;
  "output_tokens": number;
  "reasoning_tokens"?: number;
  "attempt_ordinal": number;
  "completion_status": "completed" | "transport_error" | "cancelled";
  "usage_source": "provider" | "local_tokenizer" | "versioned_estimate";
  "received_at": Timestamp;
}

export interface TokenSegmentUsageV1 {
  "segment_id": Id;
  "purpose": "current_message" | "safety" | "world_fact" | "memory" | "commitment" | "working_self" | "deliberation" | "self_experience" | "expression" | "runtime_overhead";
  "token_count": number;
  "experienced": boolean;
  "source_refs": SourceRef[];
}

export interface ExperiencedUsageBreakdownV1 {
  "schema_version": "1.0";
  "breakdown_id": Id;
  "usage_receipt_id": Id;
  "prompt_run_id": Id;
  "segments": TokenSegmentUsageV1[];
  "attempt_class": "accepted_semantic" | "transport_retry" | "runtime_repair";
  "classification_version": Id;
  "input_closure_hash": Sha256Hash;
}

export interface CognitiveEnergyAccountV1 {
  "schema_version": "1.0";
  "actor_id": Id;
  "available": number;
  "reserved": number;
  "capacity": number;
  "protected_reply_reserve": number;
  "recovered_at": Timestamp;
  "recovery_model_version": Id;
  "revision": number;
}

export interface CognitiveEnergyReservationV1 {
  "schema_version": "1.0";
  "reservation_id": Id;
  "actor_id": Id;
  "wake_decision_id": Id;
  "prompt_run_id": Id;
  "purpose": CognitivePurpose;
  "max_normalized_token_units": number;
  "access_class": CognitiveAccessClass;
  "base_state_revision": number;
  "accounting_version": Id;
  "expires_at": Timestamp;
  "idempotency_key": string;
}

export interface CognitiveEnergySettlementV1 {
  "schema_version": "1.0";
  "settlement_id": Id;
  "reservation_id": Id;
  "usage_receipt_id": Id;
  "experienced_breakdown_id": Id;
  "normalized_token_units": number;
  "energy_spent": number;
  "released_reservation": number;
  "accounting_version": Id;
  "source_refs": SourceRefs;
  "settled_at": Timestamp;
}

export interface CognitiveCapacityEnvelopeV2 {
  "schema_version": "2.0";
  "envelope_id": Id;
  "actor_id": Id;
  "reservation_id": Id;
  "access_class": CognitiveAccessClass;
  "visibility": "engine_only";
  "max_semantic_input_units": number;
  "max_deliberation_units": number;
  "max_expression_units": number;
  "max_tool_rounds": number;
  "mandatory_source_refs": SourceRefs;
  "accounting_version": Id;
  "base_state_revision": number;
}

export interface CognitiveEpisodeEvidenceV2 {
  "schema_version": "2.0";
  "episode_id": Id;
  "actor_id": Id;
  "purpose": CognitivePurpose;
  "subject_refs": SourceRefs;
  "result_refs": SourceRef[];
  "started_at": Timestamp;
  "ended_at": Timestamp;
  "completion": "completed" | "interrupted";
  "prompt_run_id": Id;
  "source_closure_hash": Sha256Hash;
}

export interface SelfExperienceProposalV2 {
  "schema_version": "2.0";
  "proposal_id": Id;
  "actor_id": Id;
  "narrative": string;
  "evidence_refs": SourceRefs;
  "uncertainty_narrative"?: string;
  "policy_run_id": Id;
  "source_closure_hash": Sha256Hash;
  "base_state_revision": number;
  "as_of": Timestamp;
}
