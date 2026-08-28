PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

CREATE TABLE observations (
    observation_id TEXT PRIMARY KEY,
    schema_version TEXT NOT NULL CHECK (schema_version = '1.0'),
    actor_id TEXT NOT NULL,
    summary TEXT NOT NULL CHECK (length(summary) > 0),
    sensing_basis TEXT NOT NULL CHECK (sensing_basis IN (
        'co_located', 'direct_message', 'public_channel', 'device_feed',
        'npc_report', 'authorized_record'
    )),
    location_id TEXT,
    privacy_scope TEXT CHECK (
        privacy_scope IS NULL OR privacy_scope IN ('internal', 'private_im', 'public_allowed')
    ),
    observed_at TEXT NOT NULL,
    projection_version TEXT NOT NULL,
    base_state_revision INTEGER NOT NULL CHECK (base_state_revision >= 0),
    input_closure_hash TEXT NOT NULL CHECK (length(input_closure_hash) = 64),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX ix_observations_actor_time
    ON observations(actor_id, observed_at, observation_id);

CREATE TABLE observation_sources (
    observation_id TEXT NOT NULL REFERENCES observations(observation_id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK (source_type IN ('message', 'event', 'claim', 'external_action', 'canon')),
    source_id TEXT NOT NULL,
    quote_hash TEXT,
    observed_at TEXT,
    PRIMARY KEY (observation_id, source_type, source_id)
);

CREATE TABLE belief_proposals (
    proposal_id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    content TEXT NOT NULL CHECK (length(content) > 0),
    status TEXT NOT NULL CHECK (status IN ('proposed', 'accepted', 'rejected', 'superseded')),
    epistemic_status TEXT NOT NULL CHECK (epistemic_status IN ('reported', 'inferred', 'disputed')),
    base_state_revision INTEGER NOT NULL CHECK (base_state_revision >= 0),
    input_closure_hash TEXT NOT NULL CHECK (length(input_closure_hash) = 64),
    proposal_version TEXT NOT NULL,
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    proposed_at TEXT NOT NULL
);

CREATE INDEX ix_belief_proposals_actor_status
    ON belief_proposals(actor_id, status, proposed_at);

CREATE TABLE belief_proposal_sources (
    proposal_id TEXT NOT NULL REFERENCES belief_proposals(proposal_id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK (source_type IN ('message', 'event', 'claim', 'external_action', 'canon')),
    source_id TEXT NOT NULL,
    quote_hash TEXT,
    observed_at TEXT,
    PRIMARY KEY (proposal_id, source_type, source_id)
);

CREATE TABLE open_loop_records (
    record_id TEXT PRIMARY KEY,
    open_loop_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    content TEXT NOT NULL CHECK (length(content) > 0),
    status TEXT NOT NULL CHECK (status IN ('open', 'resolved', 'superseded')),
    base_state_revision INTEGER NOT NULL CHECK (base_state_revision >= 0),
    input_closure_hash TEXT NOT NULL CHECK (length(input_closure_hash) = 64),
    record_version TEXT NOT NULL,
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    recorded_at TEXT NOT NULL,
    UNIQUE (open_loop_id, base_state_revision)
);

CREATE INDEX ix_open_loop_records_actor_status
    ON open_loop_records(actor_id, status, recorded_at);

CREATE TABLE open_loop_sources (
    record_id TEXT NOT NULL REFERENCES open_loop_records(record_id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK (source_type IN ('message', 'event', 'claim', 'external_action', 'canon')),
    source_id TEXT NOT NULL,
    quote_hash TEXT,
    observed_at TEXT,
    PRIMARY KEY (record_id, source_type, source_id)
);

CREATE TABLE commitment_projections (
    projection_id TEXT PRIMARY KEY,
    commitment_id TEXT NOT NULL,
    schema_version TEXT NOT NULL CHECK (schema_version = '1.0'),
    subject_id TEXT NOT NULL,
    object_id TEXT NOT NULL,
    content TEXT NOT NULL CHECK (length(content) > 0),
    condition_text TEXT,
    due_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('active', 'fulfilled', 'broken', 'released')),
    fulfillment_event_refs_json TEXT NOT NULL CHECK (
        json_valid(fulfillment_event_refs_json) AND json_type(fulfillment_event_refs_json) = 'array'
    ),
    broken_event_refs_json TEXT NOT NULL CHECK (
        json_valid(broken_event_refs_json) AND json_type(broken_event_refs_json) = 'array'
    ),
    released_event_refs_json TEXT NOT NULL CHECK (
        json_valid(released_event_refs_json) AND json_type(released_event_refs_json) = 'array'
    ),
    debt_id TEXT REFERENCES debts(debt_id),
    derived_from_ledger INTEGER NOT NULL CHECK (derived_from_ledger = 1),
    projection_scope TEXT NOT NULL CHECK (projection_scope = 'adjudication_audit_only'),
    projection_version TEXT NOT NULL,
    base_state_revision INTEGER NOT NULL CHECK (base_state_revision >= 0),
    input_closure_hash TEXT NOT NULL CHECK (length(input_closure_hash) = 64),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    derived_at TEXT NOT NULL,
    UNIQUE (commitment_id, base_state_revision),
    CHECK (
        (status = 'active'
            AND json_array_length(fulfillment_event_refs_json) = 0
            AND json_array_length(broken_event_refs_json) = 0
            AND json_array_length(released_event_refs_json) = 0)
        OR (status = 'fulfilled' AND json_array_length(fulfillment_event_refs_json) > 0)
        OR (status = 'broken' AND json_array_length(broken_event_refs_json) > 0)
        OR (status = 'released' AND json_array_length(released_event_refs_json) > 0)
    )
);

CREATE INDEX ix_commitment_projections_lookup
    ON commitment_projections(commitment_id, base_state_revision DESC);
CREATE INDEX ix_commitment_projections_subject_status
    ON commitment_projections(subject_id, status, due_at);

CREATE TABLE commitment_projection_sources (
    projection_id TEXT NOT NULL REFERENCES commitment_projections(projection_id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK (source_type IN ('message', 'event', 'claim', 'external_action', 'canon')),
    source_id TEXT NOT NULL,
    quote_hash TEXT,
    observed_at TEXT,
    PRIMARY KEY (projection_id, source_type, source_id)
);

CREATE TABLE action_proposal_audit (
    proposal_id TEXT PRIMARY KEY,
    schema_version TEXT NOT NULL CHECK (schema_version = '1.0'),
    actor_id TEXT NOT NULL,
    policy_run_id TEXT NOT NULL,
    intent TEXT NOT NULL CHECK (length(intent) > 0),
    source_closure_hash TEXT NOT NULL CHECK (length(source_closure_hash) = 64),
    base_state_revision INTEGER NOT NULL CHECK (base_state_revision >= 0),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    proposed_at TEXT NOT NULL
);

CREATE INDEX ix_action_proposal_audit_actor_time
    ON action_proposal_audit(actor_id, proposed_at);

CREATE TABLE action_proposal_sources (
    proposal_id TEXT NOT NULL REFERENCES action_proposal_audit(proposal_id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK (source_type IN ('message', 'event', 'claim', 'external_action', 'canon')),
    source_id TEXT NOT NULL,
    quote_hash TEXT,
    observed_at TEXT,
    PRIMARY KEY (proposal_id, source_type, source_id)
);

CREATE TABLE world_outcome_audit (
    outcome_id TEXT PRIMARY KEY,
    schema_version TEXT NOT NULL CHECK (schema_version = '1.0'),
    action_proposal_id TEXT NOT NULL REFERENCES action_proposal_audit(proposal_id),
    actor_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('accepted', 'partial', 'rejected', 'deferred', 'interrupted')),
    summary TEXT NOT NULL CHECK (length(summary) > 0),
    hard_constraint_classes_json TEXT NOT NULL CHECK (
        json_valid(hard_constraint_classes_json) AND json_type(hard_constraint_classes_json) = 'array'
    ),
    proposed_effects_json TEXT NOT NULL CHECK (
        json_valid(proposed_effects_json) AND json_type(proposed_effects_json) = 'array'
    ),
    adjudicator_version TEXT NOT NULL,
    rule_version TEXT NOT NULL,
    source_closure_hash TEXT NOT NULL CHECK (length(source_closure_hash) = 64),
    base_state_revision INTEGER NOT NULL CHECK (base_state_revision >= 0),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    proposed_at TEXT NOT NULL,
    CHECK (
        (status IN ('accepted', 'partial') AND json_array_length(proposed_effects_json) > 0)
        OR (status = 'rejected' AND json_array_length(hard_constraint_classes_json) > 0)
        OR status IN ('deferred', 'interrupted')
    )
);

CREATE INDEX ix_world_outcome_audit_action
    ON world_outcome_audit(action_proposal_id, proposed_at);
CREATE INDEX ix_world_outcome_audit_status
    ON world_outcome_audit(status, proposed_at);

CREATE TRIGGER trg_action_proposal_audit_immutable_update
BEFORE UPDATE ON action_proposal_audit
BEGIN
    SELECT RAISE(ABORT, 'action proposal audit is immutable');
END;

CREATE TRIGGER trg_action_proposal_audit_immutable_delete
BEFORE DELETE ON action_proposal_audit
BEGIN
    SELECT RAISE(ABORT, 'action proposal audit is immutable');
END;

CREATE TRIGGER trg_world_outcome_audit_immutable_update
BEFORE UPDATE ON world_outcome_audit
BEGIN
    SELECT RAISE(ABORT, 'world outcome audit is immutable');
END;

CREATE TRIGGER trg_world_outcome_audit_immutable_delete
BEFORE DELETE ON world_outcome_audit
BEGIN
    SELECT RAISE(ABORT, 'world outcome audit is immutable');
END;

CREATE TABLE world_outcome_sources (
    outcome_id TEXT NOT NULL REFERENCES world_outcome_audit(outcome_id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK (source_type IN ('message', 'event', 'claim', 'external_action', 'canon')),
    source_id TEXT NOT NULL,
    quote_hash TEXT,
    observed_at TEXT,
    PRIMARY KEY (outcome_id, source_type, source_id)
);

CREATE TABLE derived_input_closures (
    artifact_kind TEXT NOT NULL CHECK (artifact_kind IN (
        'observation', 'memory_bundle', 'working_self', 'belief_proposal', 'open_loop',
        'commitment_projection', 'action_proposal', 'world_outcome'
    )),
    artifact_id TEXT NOT NULL,
    closure_hash TEXT NOT NULL CHECK (length(closure_hash) = 64),
    base_state_revision INTEGER NOT NULL CHECK (base_state_revision >= 0),
    created_at TEXT NOT NULL,
    PRIMARY KEY (artifact_kind, artifact_id)
);

CREATE INDEX ix_derived_input_closures_hash
    ON derived_input_closures(closure_hash, base_state_revision);

CREATE TABLE derived_input_sources (
    artifact_kind TEXT NOT NULL,
    artifact_id TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('message', 'event', 'claim', 'external_action', 'canon')),
    source_id TEXT NOT NULL,
    quote_hash TEXT,
    observed_at TEXT,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    PRIMARY KEY (artifact_kind, artifact_id, source_type, source_id),
    UNIQUE (artifact_kind, artifact_id, ordinal),
    FOREIGN KEY (artifact_kind, artifact_id)
        REFERENCES derived_input_closures(artifact_kind, artifact_id) ON DELETE CASCADE
);

INSERT INTO schema_migrations(version, description)
VALUES ('002', 'Final affect-off agent pipeline persistence');

COMMIT;
