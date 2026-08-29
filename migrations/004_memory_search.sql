PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

CREATE TABLE memory_index_documents (
    document_id TEXT PRIMARY KEY,
    schema_version TEXT NOT NULL CHECK (schema_version = '1.0'),
    actor_id TEXT NOT NULL,
    memory_kind TEXT NOT NULL CHECK (memory_kind IN (
        'episodic', 'belief', 'relationship_evidence', 'open_loop', 'action_outcome'
    )),
    content TEXT NOT NULL CHECK (length(content) > 0),
    visibility_scope TEXT NOT NULL CHECK (
        visibility_scope IN ('internal', 'private_im', 'public_allowed')
    ),
    epistemic_status TEXT NOT NULL CHECK (epistemic_status IN (
        'reported', 'attested', 'verified', 'inferred', 'generated', 'disputed'
    )),
    source_artifact_kind TEXT NOT NULL CHECK (source_artifact_kind IN (
        'observation', 'belief_proposal', 'memory_record', 'open_loop', 'world_outcome'
    )),
    source_artifact_id TEXT NOT NULL,
    action_proposal_id TEXT REFERENCES action_proposal_audit(proposal_id),
    outcome_id TEXT REFERENCES world_outcome_audit(outcome_id),
    action_intent TEXT,
    outcome_status TEXT CHECK (
        outcome_status IS NULL OR outcome_status IN (
            'accepted', 'partial', 'rejected', 'deferred', 'interrupted'
        )
    ),
    outcome_summary TEXT,
    occurred_at TEXT NOT NULL,
    index_version TEXT NOT NULL,
    base_state_revision INTEGER NOT NULL CHECK (base_state_revision >= 0),
    input_closure_hash TEXT NOT NULL CHECK (length(input_closure_hash) = 64),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    indexed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (source_artifact_kind, source_artifact_id, index_version),
    CHECK (
        (memory_kind = 'action_outcome'
            AND source_artifact_kind = 'world_outcome'
            AND action_proposal_id IS NOT NULL
            AND outcome_id IS NOT NULL
            AND action_intent IS NOT NULL
            AND outcome_status IS NOT NULL
            AND outcome_summary IS NOT NULL)
        OR (memory_kind <> 'action_outcome'
            AND action_proposal_id IS NULL
            AND outcome_id IS NULL
            AND action_intent IS NULL
            AND outcome_status IS NULL
            AND outcome_summary IS NULL)
    )
);

CREATE INDEX ix_memory_index_actor_time
    ON memory_index_documents(actor_id, occurred_at DESC, document_id);
CREATE INDEX ix_memory_index_visibility
    ON memory_index_documents(actor_id, visibility_scope, occurred_at DESC);
CREATE INDEX ix_memory_index_epistemic
    ON memory_index_documents(actor_id, epistemic_status, occurred_at DESC);
CREATE INDEX ix_memory_index_outcome
    ON memory_index_documents(actor_id, outcome_status, occurred_at DESC)
    WHERE outcome_status IS NOT NULL;

CREATE TABLE memory_index_entities (
    document_id TEXT NOT NULL REFERENCES memory_index_documents(document_id) ON DELETE CASCADE,
    entity_id TEXT NOT NULL,
    PRIMARY KEY (document_id, entity_id)
);

CREATE INDEX ix_memory_index_entities_lookup
    ON memory_index_entities(entity_id, document_id);

CREATE TABLE memory_index_relationships (
    document_id TEXT NOT NULL REFERENCES memory_index_documents(document_id) ON DELETE CASCADE,
    relationship_id TEXT NOT NULL,
    PRIMARY KEY (document_id, relationship_id)
);

CREATE INDEX ix_memory_index_relationships_lookup
    ON memory_index_relationships(relationship_id, document_id);

CREATE TABLE memory_index_commitments (
    document_id TEXT NOT NULL REFERENCES memory_index_documents(document_id) ON DELETE CASCADE,
    commitment_id TEXT NOT NULL,
    PRIMARY KEY (document_id, commitment_id)
);

CREATE INDEX ix_memory_index_commitments_lookup
    ON memory_index_commitments(commitment_id, document_id);

CREATE TABLE memory_index_outcome_constraints (
    document_id TEXT NOT NULL REFERENCES memory_index_documents(document_id) ON DELETE CASCADE,
    hard_constraint_class TEXT NOT NULL CHECK (hard_constraint_class IN (
        'location', 'time', 'resource', 'capability', 'knowledge', 'permission', 'world_rule'
    )),
    PRIMARY KEY (document_id, hard_constraint_class)
);

CREATE INDEX ix_memory_index_outcome_constraints_lookup
    ON memory_index_outcome_constraints(hard_constraint_class, document_id);

CREATE TABLE memory_index_sources (
    document_id TEXT NOT NULL REFERENCES memory_index_documents(document_id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK (
        source_type IN ('message', 'event', 'claim', 'external_action', 'canon')
    ),
    source_id TEXT NOT NULL,
    quote_hash TEXT,
    observed_at TEXT,
    PRIMARY KEY (document_id, source_type, source_id)
);

CREATE TABLE memory_index_input_sources (
    document_id TEXT NOT NULL REFERENCES memory_index_documents(document_id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK (
        source_type IN ('message', 'event', 'claim', 'external_action', 'canon')
    ),
    source_id TEXT NOT NULL,
    quote_hash TEXT,
    observed_at TEXT,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    PRIMARY KEY (document_id, source_type, source_id),
    UNIQUE (document_id, ordinal)
);

CREATE VIRTUAL TABLE memory_index_fts USING fts5(
    document_id UNINDEXED,
    content,
    action_intent,
    outcome_summary,
    tokenize = 'unicode61 remove_diacritics 2'
);

INSERT INTO schema_migrations(version, description)
VALUES ('004', 'Structured memory filters and FTS5 reranking');

COMMIT;
