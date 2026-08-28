PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

CREATE TABLE attention_intents (
    intent_id TEXT PRIMARY KEY,
    schema_version TEXT NOT NULL CHECK (schema_version = '1.0'),
    actor_id TEXT NOT NULL,
    concern TEXT NOT NULL CHECK (length(concern) > 0),
    future_change TEXT NOT NULL CHECK (length(future_change) > 0),
    scope_json TEXT NOT NULL CHECK (json_valid(scope_json) AND json_type(scope_json) = 'object'),
    lifecycle TEXT NOT NULL CHECK (lifecycle IN ('active', 'suspended', 'cancelled', 'expired', 'completed', 'superseded')),
    policy_run_id TEXT NOT NULL,
    source_closure_hash TEXT NOT NULL CHECK (length(source_closure_hash) = 64),
    base_state_revision INTEGER NOT NULL CHECK (base_state_revision >= 0),
    supersedes_intent_id TEXT REFERENCES attention_intents(intent_id),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    created_at TEXT NOT NULL
);

CREATE INDEX ix_attention_intents_actor_lifecycle
    ON attention_intents(actor_id, lifecycle, created_at);

CREATE TABLE attention_intent_sources (
    intent_id TEXT NOT NULL REFERENCES attention_intents(intent_id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK (source_type IN ('message', 'event', 'claim', 'external_action', 'canon')),
    source_id TEXT NOT NULL,
    quote_hash TEXT,
    observed_at TEXT,
    PRIMARY KEY (intent_id, source_type, source_id)
);

CREATE TABLE attention_subscription_records (
    record_id TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL,
    intent_id TEXT NOT NULL REFERENCES attention_intents(intent_id),
    schema_version TEXT NOT NULL CHECK (schema_version = '1.0'),
    actor_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'suspended', 'cancelled', 'expired', 'completed', 'superseded')),
    observable_filter_json TEXT NOT NULL CHECK (
        json_valid(observable_filter_json) AND json_type(observable_filter_json) = 'object'
    ),
    perception_only INTEGER NOT NULL CHECK (perception_only = 1),
    compiler_version TEXT NOT NULL,
    base_state_revision INTEGER NOT NULL CHECK (base_state_revision >= 0),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    created_at TEXT NOT NULL,
    expires_at TEXT,
    UNIQUE (subscription_id, base_state_revision)
);

CREATE INDEX ix_attention_subscription_active
    ON attention_subscription_records(actor_id, status, expires_at, created_at);

CREATE TABLE attention_subscription_sources (
    record_id TEXT NOT NULL REFERENCES attention_subscription_records(record_id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK (source_type IN ('message', 'event', 'claim', 'external_action', 'canon')),
    source_id TEXT NOT NULL,
    quote_hash TEXT,
    observed_at TEXT,
    PRIMARY KEY (record_id, source_type, source_id)
);

CREATE TABLE cognitive_energy_accounts (
    actor_id TEXT PRIMARY KEY,
    schema_version TEXT NOT NULL CHECK (schema_version = '1.0'),
    available REAL NOT NULL CHECK (available >= 0),
    reserved REAL NOT NULL CHECK (reserved >= 0),
    capacity REAL NOT NULL CHECK (capacity >= 0 AND available + reserved <= capacity),
    protected_reply_reserve REAL NOT NULL CHECK (
        protected_reply_reserve >= 0 AND protected_reply_reserve <= available
    ),
    recovered_at TEXT NOT NULL,
    recovery_model_version TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0)
);

CREATE TABLE wake_candidates (
    candidate_id TEXT PRIMARY KEY,
    schema_version TEXT NOT NULL CHECK (schema_version = '1.0'),
    actor_id TEXT NOT NULL,
    committed_revision INTEGER NOT NULL CHECK (committed_revision >= 0),
    boundary_kind TEXT NOT NULL CHECK (boundary_kind IN (
        'observable_change', 'activity_boundary', 'runtime_hard_interrupt',
        'attention_match', 'accumulated_signal'
    )),
    input_closure_hash TEXT NOT NULL CHECK (length(input_closure_hash) = 64),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    occurred_at TEXT NOT NULL
);

CREATE TABLE wake_candidate_sources (
    candidate_id TEXT NOT NULL REFERENCES wake_candidates(candidate_id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK (source_type IN ('message', 'event', 'claim', 'external_action', 'canon')),
    source_id TEXT NOT NULL,
    quote_hash TEXT,
    observed_at TEXT,
    PRIMARY KEY (candidate_id, source_type, source_id)
);

CREATE TABLE wake_decision_audit (
    decision_id TEXT PRIMARY KEY,
    schema_version TEXT NOT NULL CHECK (schema_version = '1.0'),
    candidate_id TEXT NOT NULL UNIQUE REFERENCES wake_candidates(candidate_id),
    actor_id TEXT NOT NULL,
    disposition TEXT NOT NULL CHECK (disposition IN ('ignore', 'accumulate', 'wake')),
    wake INTEGER NOT NULL CHECK (wake IN (0, 1) AND wake = (disposition = 'wake')),
    queue_lane TEXT NOT NULL CHECK (queue_lane IN ('none', 'background', 'normal', 'reply', 'safety')),
    reason_codes_json TEXT NOT NULL CHECK (json_valid(reason_codes_json) AND json_type(reason_codes_json) = 'array'),
    matched_rule_ids_json TEXT NOT NULL CHECK (json_valid(matched_rule_ids_json) AND json_type(matched_rule_ids_json) = 'array'),
    gate_version TEXT NOT NULL,
    parameter_version TEXT NOT NULL,
    energy_snapshot_hash TEXT,
    affect_mode TEXT NOT NULL CHECK (affect_mode IN ('off', 'shadow', 'active')),
    affect_contributed INTEGER NOT NULL CHECK (
        affect_contributed IN (0, 1)
        AND (affect_mode = 'active' OR affect_contributed = 0)
    ),
    base_state_revision INTEGER NOT NULL CHECK (base_state_revision >= 0),
    input_closure_hash TEXT NOT NULL CHECK (length(input_closure_hash) = 64),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    decided_at TEXT NOT NULL
);

CREATE INDEX ix_wake_decision_actor_time
    ON wake_decision_audit(actor_id, decided_at, disposition);
CREATE INDEX ix_wake_decision_nonwake
    ON wake_decision_audit(wake, decided_at);

CREATE TABLE salience_accumulations (
    accumulation_id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    aggregation_key TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('accumulating', 'emitted', 'expired')),
    signal_count INTEGER NOT NULL CHECK (signal_count > 0),
    salience REAL NOT NULL CHECK (salience >= 0),
    window_started_at TEXT NOT NULL,
    window_ended_at TEXT NOT NULL,
    accumulator_version TEXT NOT NULL,
    base_state_revision INTEGER NOT NULL CHECK (base_state_revision >= 0),
    input_closure_hash TEXT NOT NULL CHECK (length(input_closure_hash) = 64),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    UNIQUE (actor_id, aggregation_key, window_started_at)
);

CREATE TABLE salience_accumulation_sources (
    accumulation_id TEXT NOT NULL REFERENCES salience_accumulations(accumulation_id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK (source_type IN ('message', 'event', 'claim', 'external_action', 'canon')),
    source_id TEXT NOT NULL,
    quote_hash TEXT,
    observed_at TEXT,
    PRIMARY KEY (accumulation_id, source_type, source_id)
);

CREATE TABLE cognitive_energy_reservations (
    reservation_id TEXT PRIMARY KEY,
    schema_version TEXT NOT NULL CHECK (schema_version = '1.0'),
    actor_id TEXT NOT NULL REFERENCES cognitive_energy_accounts(actor_id),
    wake_decision_id TEXT NOT NULL REFERENCES wake_decision_audit(decision_id),
    prompt_run_id TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('appraisal', 'policy', 'npc_policy', 'surface', 'reflection')),
    max_normalized_token_units REAL NOT NULL CHECK (max_normalized_token_units >= 0),
    access_class TEXT NOT NULL CHECK (access_class IN ('autonomous', 'reply', 'safety')),
    status TEXT NOT NULL CHECK (status IN ('active', 'settled', 'released', 'expired')),
    base_state_revision INTEGER NOT NULL CHECK (base_state_revision >= 0),
    accounting_version TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    created_at TEXT NOT NULL
);

CREATE INDEX ix_energy_reservations_actor_status
    ON cognitive_energy_reservations(actor_id, status, expires_at);

CREATE TABLE inference_usage_receipts (
    receipt_id TEXT PRIMARY KEY,
    schema_version TEXT NOT NULL CHECK (schema_version = '1.0'),
    prompt_run_id TEXT NOT NULL,
    provider_request_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    tokenizer_version TEXT NOT NULL,
    input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
    cached_input_tokens INTEGER CHECK (cached_input_tokens IS NULL OR (cached_input_tokens >= 0 AND cached_input_tokens <= input_tokens)),
    output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
    reasoning_tokens INTEGER CHECK (reasoning_tokens IS NULL OR reasoning_tokens >= 0),
    attempt_ordinal INTEGER NOT NULL CHECK (attempt_ordinal >= 1),
    completion_status TEXT NOT NULL CHECK (completion_status IN ('completed', 'transport_error', 'cancelled')),
    usage_source TEXT NOT NULL CHECK (usage_source IN ('provider', 'local_tokenizer', 'versioned_estimate')),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    received_at TEXT NOT NULL,
    UNIQUE (prompt_run_id, attempt_ordinal)
);

CREATE TABLE experienced_usage_breakdowns (
    breakdown_id TEXT PRIMARY KEY,
    schema_version TEXT NOT NULL CHECK (schema_version = '1.0'),
    usage_receipt_id TEXT NOT NULL UNIQUE REFERENCES inference_usage_receipts(receipt_id),
    prompt_run_id TEXT NOT NULL,
    attempt_class TEXT NOT NULL CHECK (attempt_class IN ('accepted_semantic', 'transport_retry', 'runtime_repair')),
    classification_version TEXT NOT NULL,
    input_closure_hash TEXT NOT NULL CHECK (length(input_closure_hash) = 64),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    classified_at TEXT NOT NULL
);

CREATE TABLE experienced_usage_segments (
    breakdown_id TEXT NOT NULL REFERENCES experienced_usage_breakdowns(breakdown_id) ON DELETE CASCADE,
    segment_id TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN (
        'current_message', 'safety', 'world_fact', 'memory', 'commitment',
        'working_self', 'deliberation', 'self_experience', 'expression', 'runtime_overhead'
    )),
    token_count INTEGER NOT NULL CHECK (token_count >= 0),
    experienced INTEGER NOT NULL CHECK (experienced IN (0, 1)),
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    PRIMARY KEY (breakdown_id, segment_id),
    UNIQUE (breakdown_id, ordinal)
);

CREATE TABLE experienced_usage_segment_sources (
    breakdown_id TEXT NOT NULL,
    segment_id TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('message', 'event', 'claim', 'external_action', 'canon')),
    source_id TEXT NOT NULL,
    quote_hash TEXT,
    observed_at TEXT,
    PRIMARY KEY (breakdown_id, segment_id, source_type, source_id),
    FOREIGN KEY (breakdown_id, segment_id)
        REFERENCES experienced_usage_segments(breakdown_id, segment_id) ON DELETE CASCADE
);

CREATE TABLE cognitive_energy_settlements (
    settlement_id TEXT PRIMARY KEY,
    schema_version TEXT NOT NULL CHECK (schema_version = '1.0'),
    reservation_id TEXT NOT NULL UNIQUE REFERENCES cognitive_energy_reservations(reservation_id),
    usage_receipt_id TEXT NOT NULL UNIQUE REFERENCES inference_usage_receipts(receipt_id),
    experienced_breakdown_id TEXT NOT NULL UNIQUE REFERENCES experienced_usage_breakdowns(breakdown_id),
    normalized_token_units REAL NOT NULL CHECK (normalized_token_units >= 0),
    energy_spent REAL NOT NULL CHECK (energy_spent >= 0),
    released_reservation REAL NOT NULL CHECK (released_reservation >= 0),
    accounting_version TEXT NOT NULL,
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    settled_at TEXT NOT NULL
);

CREATE TABLE cognitive_energy_settlement_sources (
    settlement_id TEXT NOT NULL REFERENCES cognitive_energy_settlements(settlement_id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK (source_type IN ('message', 'event', 'claim', 'external_action', 'canon')),
    source_id TEXT NOT NULL,
    quote_hash TEXT,
    observed_at TEXT,
    PRIMARY KEY (settlement_id, source_type, source_id)
);

CREATE TABLE cognitive_episode_evidence (
    episode_id TEXT PRIMARY KEY,
    schema_version TEXT NOT NULL CHECK (schema_version = '2.0'),
    actor_id TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('appraisal', 'policy', 'npc_policy', 'surface', 'reflection')),
    completion TEXT NOT NULL CHECK (completion IN ('completed', 'interrupted')),
    prompt_run_id TEXT NOT NULL,
    source_closure_hash TEXT NOT NULL CHECK (length(source_closure_hash) = 64),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    CHECK (ended_at >= started_at)
);

CREATE TABLE cognitive_episode_sources (
    episode_id TEXT NOT NULL REFERENCES cognitive_episode_evidence(episode_id) ON DELETE CASCADE,
    source_role TEXT NOT NULL CHECK (source_role IN ('subject', 'result')),
    source_type TEXT NOT NULL CHECK (source_type IN ('message', 'event', 'claim', 'external_action', 'canon')),
    source_id TEXT NOT NULL,
    quote_hash TEXT,
    observed_at TEXT,
    PRIMARY KEY (episode_id, source_role, source_type, source_id)
);

CREATE TABLE subjective_experience_records (
    record_id TEXT PRIMARY KEY,
    proposal_id TEXT NOT NULL UNIQUE,
    schema_version TEXT NOT NULL CHECK (schema_version = '2.0'),
    actor_id TEXT NOT NULL,
    narrative TEXT NOT NULL CHECK (length(narrative) > 0),
    uncertainty_narrative TEXT,
    policy_run_id TEXT NOT NULL,
    source_closure_hash TEXT NOT NULL CHECK (length(source_closure_hash) = 64),
    base_state_revision INTEGER NOT NULL CHECK (base_state_revision >= 0),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    as_of TEXT NOT NULL
);

CREATE TABLE subjective_experience_sources (
    record_id TEXT NOT NULL REFERENCES subjective_experience_records(record_id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK (source_type IN ('message', 'event', 'claim', 'external_action', 'canon')),
    source_id TEXT NOT NULL,
    quote_hash TEXT,
    observed_at TEXT,
    PRIMARY KEY (record_id, source_type, source_id)
);

CREATE TRIGGER trg_usage_receipt_immutable_update
BEFORE UPDATE ON inference_usage_receipts
BEGIN SELECT RAISE(ABORT, 'usage receipt is immutable'); END;

CREATE TRIGGER trg_usage_receipt_immutable_delete
BEFORE DELETE ON inference_usage_receipts
BEGIN SELECT RAISE(ABORT, 'usage receipt is immutable'); END;

CREATE TRIGGER trg_usage_breakdown_immutable_update
BEFORE UPDATE ON experienced_usage_breakdowns
BEGIN SELECT RAISE(ABORT, 'usage breakdown is immutable'); END;

CREATE TRIGGER trg_energy_settlement_immutable_update
BEFORE UPDATE ON cognitive_energy_settlements
BEGIN SELECT RAISE(ABORT, 'energy settlement is immutable'); END;

CREATE TRIGGER trg_wake_decision_immutable_update
BEFORE UPDATE ON wake_decision_audit
BEGIN SELECT RAISE(ABORT, 'wake decision audit is immutable'); END;

CREATE TRIGGER trg_cognitive_episode_immutable_update
BEFORE UPDATE ON cognitive_episode_evidence
BEGIN SELECT RAISE(ABORT, 'cognitive episode evidence is immutable'); END;

CREATE TRIGGER trg_subjective_experience_immutable_update
BEFORE UPDATE ON subjective_experience_records
BEGIN SELECT RAISE(ABORT, 'subjective experience record is immutable'); END;

CREATE TRIGGER trg_energy_reservation_core_immutable
BEFORE UPDATE OF actor_id, wake_decision_id, prompt_run_id, purpose,
                 max_normalized_token_units, access_class, base_state_revision,
                 accounting_version, expires_at, idempotency_key, payload_json
ON cognitive_energy_reservations
BEGIN SELECT RAISE(ABORT, 'energy reservation core is immutable'); END;

INSERT INTO schema_migrations(version, description)
VALUES ('003', 'Cognitive admission attention energy and experience persistence');

COMMIT;
