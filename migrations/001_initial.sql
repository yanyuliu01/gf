PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

CREATE TABLE schema_migrations (
    version TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE world_events (
    event_id TEXT PRIMARY KEY,
    schema_version TEXT NOT NULL,
    origin TEXT NOT NULL CHECK (origin IN ('user', 'system', 'impulse', 'scheduled', 'genesis', 'admin')),
    kind TEXT NOT NULL,
    channel TEXT,
    occurred_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    world_day INTEGER CHECK (world_day IS NULL OR world_day >= 0),
    world_phase TEXT CHECK (world_phase IS NULL OR world_phase IN ('dawn', 'morning', 'noon', 'afternoon', 'evening', 'night')),
    principal_id TEXT NOT NULL,
    connector_id TEXT,
    external_event_id TEXT,
    trust TEXT NOT NULL CHECK (trust IN ('authenticated', 'attested', 'verified', 'generated', 'inferred')),
    privacy_scope TEXT NOT NULL CHECK (privacy_scope IN ('internal', 'private_im', 'public_allowed')),
    causation_event_id TEXT REFERENCES world_events(event_id),
    correlation_id TEXT,
    idempotency_key TEXT NOT NULL UNIQUE,
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    inserted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX ux_world_events_connector_external
    ON world_events(connector_id, external_event_id)
    WHERE connector_id IS NOT NULL AND external_event_id IS NOT NULL;
CREATE INDEX ix_world_events_time ON world_events(occurred_at, event_id);
CREATE INDEX ix_world_events_correlation ON world_events(correlation_id) WHERE correlation_id IS NOT NULL;

CREATE TABLE messages (
    message_id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL UNIQUE REFERENCES world_events(event_id),
    direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    channel TEXT NOT NULL,
    sender_principal_id TEXT NOT NULL,
    privacy_scope TEXT NOT NULL CHECK (privacy_scope IN ('internal', 'private_im', 'public_allowed')),
    content_json TEXT NOT NULL CHECK (json_valid(content_json)),
    created_at TEXT NOT NULL
);

CREATE TABLE scenes (
    scene_id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('open', 'settling', 'closed', 'failed')),
    privacy_scope TEXT NOT NULL CHECK (privacy_scope IN ('internal', 'private_im', 'public_allowed')),
    opened_at TEXT NOT NULL,
    closed_at TEXT,
    summary TEXT,
    CHECK ((status = 'closed' AND closed_at IS NOT NULL) OR status <> 'closed')
);

CREATE TABLE scene_messages (
    scene_id TEXT NOT NULL REFERENCES scenes(scene_id) ON DELETE CASCADE,
    message_id TEXT NOT NULL UNIQUE REFERENCES messages(message_id),
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    PRIMARY KEY (scene_id, message_id),
    UNIQUE (scene_id, ordinal)
);

CREATE TABLE operation_commits (
    operation_id TEXT PRIMARY KEY,
    operation_kind TEXT NOT NULL CHECK (operation_kind IN ('tick', 'scene_settlement', 'admin', 'migration')),
    trigger_event_id TEXT REFERENCES world_events(event_id),
    scene_id TEXT REFERENCES scenes(scene_id),
    batch_id TEXT,
    base_state_revision INTEGER NOT NULL CHECK (base_state_revision >= 0),
    committed_state_revision INTEGER NOT NULL CHECK (committed_state_revision = base_state_revision + 1),
    proposal_json TEXT NOT NULL CHECK (json_valid(proposal_json)),
    proposal_hash TEXT NOT NULL UNIQUE,
    prompt_manifest_hash TEXT,
    committed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (scene_id, batch_id),
    UNIQUE (operation_id, scene_id),
    CHECK (
        (operation_kind = 'tick' AND trigger_event_id IS NOT NULL AND scene_id IS NULL AND batch_id IS NULL)
        OR (operation_kind = 'scene_settlement' AND scene_id IS NOT NULL AND batch_id IS NOT NULL)
        OR (operation_kind IN ('admin', 'migration') AND scene_id IS NULL AND batch_id IS NULL)
    )
);

CREATE UNIQUE INDEX ux_operation_tick_trigger
    ON operation_commits(trigger_event_id)
    WHERE operation_kind = 'tick';

CREATE TABLE operation_processed_messages (
    operation_id TEXT NOT NULL,
    scene_id TEXT NOT NULL,
    message_id TEXT NOT NULL UNIQUE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    PRIMARY KEY (operation_id, message_id),
    UNIQUE (operation_id, ordinal),
    FOREIGN KEY (operation_id, scene_id)
        REFERENCES operation_commits(operation_id, scene_id) ON DELETE CASCADE,
    FOREIGN KEY (scene_id, message_id)
        REFERENCES scene_messages(scene_id, message_id)
);

CREATE TABLE runtime_revision (
    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
    current_revision INTEGER NOT NULL CHECK (current_revision >= 0)
);

CREATE TABLE state_documents (
    document_key TEXT PRIMARY KEY CHECK (document_key IN ('world_state', 'persona', 'inventory')),
    revision INTEGER NOT NULL CHECK (revision >= 0),
    value_json TEXT NOT NULL CHECK (json_valid(value_json)),
    updated_by_operation_id TEXT REFERENCES operation_commits(operation_id),
    updated_at TEXT NOT NULL
);

CREATE TABLE state_revisions (
    revision INTEGER PRIMARY KEY CHECK (revision >= 0),
    operation_id TEXT NOT NULL UNIQUE REFERENCES operation_commits(operation_id),
    state_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE claims (
    claim_id TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL REFERENCES operation_commits(operation_id),
    scope TEXT NOT NULL CHECK (scope IN ('doctor_world', 'terra', 'channel', 'relationship')),
    kind TEXT NOT NULL CHECK (kind IN ('doctor_disclosure', 'doctor_attestation', 'terra_effect', 'capability_change')),
    claim_text TEXT NOT NULL,
    epistemic_status TEXT NOT NULL CHECK (epistemic_status IN ('reported', 'attested', 'verified', 'inferred', 'generated', 'disputed')),
    lands_in_terra INTEGER NOT NULL CHECK (lands_in_terra IN (0, 1)),
    privacy_scope TEXT NOT NULL CHECK (privacy_scope IN ('internal', 'private_im', 'public_allowed')),
    causal_action_source_type TEXT,
    causal_action_source_id TEXT,
    causal_action_quote_hash TEXT,
    causal_action_observed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK ((causal_action_source_type IS NULL) = (causal_action_source_id IS NULL)),
    CHECK (causal_action_source_type IS NULL OR causal_action_source_type IN ('event', 'external_action')),
    CHECK (
        (kind = 'doctor_disclosure'
            AND scope IN ('doctor_world', 'relationship')
            AND epistemic_status = 'reported'
            AND lands_in_terra = 0
            AND causal_action_source_id IS NULL)
        OR (kind = 'doctor_attestation'
            AND scope = 'terra'
            AND epistemic_status IN ('attested', 'verified')
            AND lands_in_terra = 1
            AND causal_action_source_id IS NOT NULL)
        OR (kind = 'terra_effect'
            AND scope = 'terra'
            AND epistemic_status = 'verified'
            AND lands_in_terra = 1
            AND causal_action_source_id IS NOT NULL)
        OR (kind = 'capability_change'
            AND scope = 'channel'
            AND epistemic_status = 'verified'
            AND lands_in_terra = 0
            AND causal_action_source_type = 'event')
    )
);

CREATE TABLE claim_sources (
    claim_id TEXT NOT NULL REFERENCES claims(claim_id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK (source_type IN ('message', 'event', 'claim', 'external_action', 'canon')),
    source_id TEXT NOT NULL,
    quote_hash TEXT,
    observed_at TEXT,
    PRIMARY KEY (claim_id, source_type, source_id)
);

CREATE TABLE patch_operations (
    op_id TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL REFERENCES operation_commits(operation_id),
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    target TEXT NOT NULL CHECK (target IN ('world_state', 'thread', 'persona', 'inventory', 'debt')),
    path TEXT NOT NULL,
    op TEXT NOT NULL CHECK (op IN ('add', 'replace', 'retire', 'close')),
    value_json TEXT CHECK (value_json IS NULL OR json_valid(value_json)),
    expected_state_revision INTEGER NOT NULL CHECK (expected_state_revision >= 0),
    reason TEXT,
    UNIQUE (operation_id, ordinal),
    CHECK (
        (op IN ('add', 'replace') AND value_json IS NOT NULL)
        OR (op = 'retire' AND value_json IS NULL)
        OR (op = 'close' AND value_json IS NOT NULL
            AND json_extract(value_json, '$') IN ('repaid', 'cancelled', 'expired', 'resolved'))
    )
);

CREATE TABLE patch_claims (
    op_id TEXT NOT NULL REFERENCES patch_operations(op_id) ON DELETE CASCADE,
    claim_id TEXT NOT NULL REFERENCES claims(claim_id),
    PRIMARY KEY (op_id, claim_id)
);

CREATE TABLE patch_sources (
    op_id TEXT NOT NULL REFERENCES patch_operations(op_id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK (source_type IN ('message', 'event', 'claim', 'external_action', 'canon')),
    source_id TEXT NOT NULL,
    quote_hash TEXT,
    observed_at TEXT,
    PRIMARY KEY (op_id, source_type, source_id)
);

CREATE TABLE patch_causes (
    op_id TEXT NOT NULL REFERENCES patch_operations(op_id) ON DELETE CASCADE,
    event_id TEXT NOT NULL REFERENCES world_events(event_id),
    PRIMARY KEY (op_id, event_id)
);

CREATE TABLE capability_snapshots (
    revision INTEGER PRIMARY KEY CHECK (revision >= 0),
    transport_json TEXT NOT NULL CHECK (json_valid(transport_json)),
    diegetic_json TEXT NOT NULL CHECK (json_valid(diegetic_json)),
    last_changed_event_id TEXT REFERENCES world_events(event_id),
    operation_id TEXT REFERENCES operation_commits(operation_id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE relationship_threads (
    thread_id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open', 'paused', 'resolved', 'retired')),
    summary TEXT NOT NULL,
    privacy_scope TEXT NOT NULL CHECK (privacy_scope IN ('internal', 'private_im', 'public_allowed')),
    opened_by_operation_id TEXT REFERENCES operation_commits(operation_id),
    updated_by_operation_id TEXT REFERENCES operation_commits(operation_id),
    updated_at TEXT NOT NULL
);

CREATE TABLE debts (
    debt_id TEXT PRIMARY KEY,
    promise_text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    due_at TEXT,
    privacy_scope TEXT NOT NULL CHECK (privacy_scope IN ('internal', 'private_im', 'public_allowed')),
    status TEXT NOT NULL CHECK (status IN ('open', 'repaid', 'cancelled', 'expired')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    created_by_operation_id TEXT NOT NULL REFERENCES operation_commits(operation_id),
    repaid_by_event_id TEXT REFERENCES world_events(event_id),
    updated_at TEXT NOT NULL,
    CHECK (
        (status = 'repaid' AND repaid_by_event_id IS NOT NULL)
        OR (status <> 'repaid' AND repaid_by_event_id IS NULL)
    )
);

CREATE TABLE debt_sources (
    debt_id TEXT NOT NULL REFERENCES debts(debt_id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK (source_type IN ('message', 'event', 'claim', 'external_action', 'canon')),
    source_id TEXT NOT NULL,
    quote_hash TEXT,
    observed_at TEXT,
    PRIMARY KEY (debt_id, source_type, source_id)
);

CREATE TABLE memory_records (
    memory_id TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL REFERENCES operation_commits(operation_id),
    memory_namespace TEXT NOT NULL CHECK (memory_namespace IN ('observed', 'world', 'inferred', 'generated')),
    memory_kind TEXT NOT NULL CHECK (memory_kind IN ('episodic', 'semantic', 'relationship', 'persona_diff')),
    epistemic_status TEXT NOT NULL CHECK (epistemic_status IN ('reported', 'attested', 'verified', 'inferred', 'generated', 'disputed')),
    content TEXT NOT NULL,
    privacy_scope TEXT NOT NULL CHECK (privacy_scope IN ('internal', 'private_im', 'public_allowed')),
    salience REAL NOT NULL CHECK (salience >= 0 AND salience <= 1),
    valence REAL NOT NULL CHECK (valence >= -1 AND valence <= 1),
    intensity REAL NOT NULL CHECK (intensity >= 0 AND intensity <= 1),
    created_at TEXT NOT NULL
);

CREATE TABLE memory_sources (
    memory_id TEXT NOT NULL REFERENCES memory_records(memory_id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK (source_type IN ('message', 'event', 'claim', 'external_action', 'canon')),
    source_id TEXT NOT NULL,
    PRIMARY KEY (memory_id, source_type, source_id)
);

CREATE TABLE speech_records (
    speech_id TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL REFERENCES operation_commits(operation_id),
    trigger_event_id TEXT REFERENCES world_events(event_id),
    scene_id TEXT REFERENCES scenes(scene_id),
    channel TEXT NOT NULL,
    recipient_principal_id TEXT NOT NULL,
    privacy_scope TEXT NOT NULL CHECK (privacy_scope IN ('internal', 'private_im', 'public_allowed')),
    capability_revision INTEGER NOT NULL REFERENCES capability_snapshots(revision),
    authorization_decision_id TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('staged', 'queued', 'sent', 'failed', 'cancelled')),
    created_at TEXT NOT NULL
);

CREATE TABLE speech_sources (
    speech_id TEXT NOT NULL REFERENCES speech_records(speech_id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK (source_type IN ('message', 'event', 'claim', 'external_action', 'canon')),
    source_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    PRIMARY KEY (speech_id, source_type, source_id),
    UNIQUE (speech_id, ordinal)
);

CREATE TRIGGER trg_speech_authorization_immutable
BEFORE UPDATE OF operation_id, trigger_event_id, scene_id, channel,
                 recipient_principal_id, privacy_scope, capability_revision,
                 authorization_decision_id, content
ON speech_records
BEGIN
    SELECT RAISE(ABORT, 'staged speech authorization and content are immutable');
END;

CREATE TABLE outbox (
    outbox_id TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL REFERENCES operation_commits(operation_id),
    speech_id TEXT NOT NULL UNIQUE REFERENCES speech_records(speech_id),
    channel TEXT NOT NULL,
    recipient_principal_id TEXT NOT NULL,
    privacy_scope TEXT NOT NULL CHECK (privacy_scope IN ('internal', 'private_im', 'public_allowed')),
    capability_revision INTEGER NOT NULL REFERENCES capability_snapshots(revision),
    authorization_decision_id TEXT NOT NULL,
    authorization_json TEXT NOT NULL CHECK (json_valid(authorization_json)),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'sent', 'retry', 'dead_letter')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    sent_at TEXT
);

CREATE INDEX ix_outbox_dispatch ON outbox(status, next_attempt_at, created_at);

CREATE TRIGGER trg_outbox_preserve_authorization
BEFORE INSERT ON outbox
FOR EACH ROW
WHEN NOT EXISTS (
    SELECT 1
    FROM speech_records AS speech
    WHERE speech.speech_id = NEW.speech_id
      AND speech.operation_id = NEW.operation_id
      AND speech.channel = NEW.channel
      AND speech.recipient_principal_id = NEW.recipient_principal_id
      AND speech.privacy_scope = NEW.privacy_scope
      AND speech.capability_revision = NEW.capability_revision
      AND speech.authorization_decision_id = NEW.authorization_decision_id
)
BEGIN
    SELECT RAISE(ABORT, 'outbox authorization does not match staged speech');
END;

CREATE TRIGGER trg_outbox_authorization_immutable
BEFORE UPDATE OF operation_id, speech_id, channel, recipient_principal_id,
                 privacy_scope, capability_revision, authorization_decision_id,
                 authorization_json, payload_json, idempotency_key
ON outbox
BEGIN
    SELECT RAISE(ABORT, 'outbox authorization and payload are immutable');
END;

CREATE TABLE deliveries (
    delivery_id TEXT PRIMARY KEY,
    outbox_id TEXT NOT NULL REFERENCES outbox(outbox_id),
    connector_id TEXT NOT NULL,
    provider_message_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('accepted', 'delivered', 'failed', 'unknown')),
    response_json TEXT CHECK (response_json IS NULL OR json_valid(response_json)),
    observed_at TEXT NOT NULL,
    UNIQUE (connector_id, provider_message_id)
);

CREATE TABLE prompt_runs (
    run_id TEXT PRIMARY KEY,
    operation_id TEXT REFERENCES operation_commits(operation_id),
    prompt_name TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    prompt_manifest_hash TEXT NOT NULL,
    input_hash TEXT NOT NULL,
    output_hash TEXT,
    model_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('started', 'validated', 'rejected', 'committed', 'failed')),
    error_code TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT
);

CREATE INDEX ix_prompt_runs_operation ON prompt_runs(operation_id, started_at);

INSERT INTO runtime_revision(singleton_id, current_revision) VALUES (1, 0);

INSERT INTO capability_snapshots(
    revision,
    transport_json,
    diegetic_json,
    last_changed_event_id,
    operation_id
) VALUES (
    0,
    '{"text":true,"image":false,"audio":false,"files":false,"reaction":false,"realtime":false}',
    '{"text":true,"image":false,"audio":false,"files":false,"reaction":false,"realtime":false}',
    NULL,
    NULL
);

INSERT INTO schema_migrations(version, description)
VALUES ('001', 'Initial event-sourced runtime schema');

COMMIT;
