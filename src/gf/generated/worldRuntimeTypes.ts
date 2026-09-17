/**
 * GENERATED FILE. DO NOT EDIT.
 * Source: schemas/world-runtime.schema.json and schemas/common.schema.json
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

export interface EventSourceRef {
  "source_type": "event";
  "source_id": Id;
  "quote_hash"?: string | null;
  "observed_at"?: Timestamp | null;
}

export type SourceRefs = SourceRef[];

export type Sha256Hash = string;

export type resourceLaw = "stock" | "currency" | "capacity" | "condition" | "information" | "permission";

export interface ResourceTypeV1 {
  "schema_version": "1.0";
  "resource_type_id": Id;
  "law": resourceLaw;
  "unit": string;
  "min_balance"?: number;
  "max_balance"?: number;
  "decay_model"?: string;
  "version": Id;
}

export interface ResourceAccountV1 {
  "schema_version": "1.0";
  "account_id": Id;
  "resource_type_id": Id;
  "owner_id": Id;
  "location_id"?: Id | null;
  "balance": number;
  "reserved": number;
  "revision": number;
}

export type reservationStatus = "pending" | "active" | "released" | "expired" | "cancelled";

export interface ResourceReservationV1 {
  "schema_version": "1.0";
  "reservation_id": Id;
  "account_id": Id;
  "resource_type_id": Id;
  "amount": number;
  "status": reservationStatus;
  "reserved_at": Timestamp;
  "expires_at": Timestamp;
  "purpose": string;
  "process_instance_id"?: Id | null;
  "activity_id"?: Id | null;
  "idempotency_key"?: string;
  "revision": number;
}

export interface ResourceAmountV1 {
  "resource_type_id": Id;
  "amount": number;
}

export interface CapacityRequirementV1 {
  "resource_type_id": Id;
  "amount_per_unit_time": number;
  "time_unit": "minute" | "hour" | "day";
}

export type interruptibility = "none" | "lossy" | "safe";

export interface ProcessDefinitionV1 {
  "schema_version": "1.0";
  "definition_id": Id;
  "version": Id;
  "inputs": ResourceAmountV1[];
  "outputs": ResourceAmountV1[];
  "capacities": CapacityRequirementV1[];
  "duration_model": string;
  "output_model": string;
  "failure_model": string;
  "precondition_rule_ids"?: Id[];
  "required_permission_ids"?: Id[];
  "interruptibility": interruptibility;
}

export type processStatus = "queued" | "reserved" | "running" | "paused" | "completed" | "failed" | "cancelled" | "rework_required";

export interface ProcessInstanceV1 {
  "schema_version": "1.0";
  "instance_id": Id;
  "definition_id": Id;
  "definition_version": Id;
  "status": processStatus;
  "progress": number;
  "reservations"?: Id[];
  "started_at"?: Timestamp | null;
  "expected_completion_at"?: Timestamp | null;
  "base_state_revision": number;
  "random_seed": string;
}

export type activityStatus = "running" | "waiting" | "paused" | "completed" | "cancelled";

export interface ActivityRecordV1 {
  "schema_version": "1.0";
  "activity_id": Id;
  "actor_id": Id;
  "semantic_description": string;
  "status": activityStatus;
  "execution_refs"?: Id[];
  "reservations"?: Id[];
  "interruptibility": interruptibility;
  "started_at": Timestamp;
  "expected_boundary_at"?: Timestamp | null;
  "source_refs": SourceRefs;
  "revision": number;
}

export type worldCommandPrimitive = "reserve_resource" | "release_resource" | "transfer_resource" | "start_process" | "pause_process" | "resume_process" | "cancel_process" | "move_actor" | "start_activity" | "complete_activity" | "cancel_activity" | "observe" | "communicate" | "wait" | "use_object";

export interface WorldCommandV1 {
  "schema_version": "1.0";
  "command_id": Id;
  "primitive": worldCommandPrimitive;
  "target_id": Id;
  "parameters": {

  };
  "actor_id": Id;
  "source_refs": SourceRefs;
}

export interface WorldStepInputV1 {
  "schema_version": "1.0";
  "from_time": Timestamp;
  "until_time": Timestamp;
  "base_state_revision": number;
  "commands": WorldCommandV1[];
  "source_refs": SourceRefs;
  "rule_set_version": Id;
  "random_seed": string;
  "idempotency_key": string;
}

export interface ResourceDeltaV1 {
  "account_id": Id;
  "resource_type_id": Id;
  "delta": number;
  "reason": string;
}

export interface ProcessDeltaV1 {
  "instance_id": Id;
  "from_status": processStatus;
  "to_status": processStatus;
  "progress"?: number;
}

export interface ActivityDeltaV1 {
  "activity_id": Id;
  "from_status": activityStatus;
  "to_status": activityStatus;
}

export interface WorldEventProposalV1 {
  "event_kind": string;
  "summary": string;
  "occurred_at": Timestamp;
  "location_id"?: Id | null;
  "entity_ids"?: Id[];
  "salience"?: number;
  "source_refs": SourceRefs;
}

export interface WorldStepAuditV1 {
  "engine_version": Id;
  "rule_set_version": Id;
  "random_draws": {
    "coordinate": string;
    "value": number;
  }[];
}

export interface WorldStepResultV1 {
  "schema_version": "1.0";
  "base_state_revision": number;
  "proposed_events": WorldEventProposalV1[];
  "resource_deltas": ResourceDeltaV1[];
  "process_deltas": ProcessDeltaV1[];
  "activity_deltas": ActivityDeltaV1[];
  "next_event_time"?: Timestamp | null;
  "input_hash": string;
  "audit": WorldStepAuditV1;
}
