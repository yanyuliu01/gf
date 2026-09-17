-- M21-008: Resource/Process Persistence and Deterministic Ledger

BEGIN IMMEDIATE;

-- Resource type definitions (versioned)
CREATE TABLE resource_types (
  resource_type_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT '1.0',
  law TEXT NOT NULL CHECK(law IN('stock','currency','capacity','condition','information','permission')),
  unit TEXT NOT NULL,
  min_balance REAL,
  max_balance REAL,
  decay_model TEXT,
  version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(resource_type_id, version)
);

-- Resource accounts: who owns what resource at what location
-- Note: min_balance enforcement is done at application level in ResourceLedger.transfer()
CREATE TABLE resource_accounts (
  account_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT '1.0',
  resource_type_id TEXT NOT NULL REFERENCES resource_types(resource_type_id),
  owner_id TEXT NOT NULL,
  location_id TEXT,
  balance REAL NOT NULL DEFAULT 0,
  reserved REAL NOT NULL DEFAULT 0 CHECK(reserved >= 0),
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_resource_accounts_owner ON resource_accounts(owner_id);
CREATE INDEX idx_resource_accounts_type ON resource_accounts(resource_type_id);
CREATE INDEX idx_resource_accounts_location ON resource_accounts(location_id) WHERE location_id IS NOT NULL;

-- Capacity reservations: interval-based resource claims
CREATE TABLE resource_reservations (
  reservation_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT '1.0',
  account_id TEXT NOT NULL REFERENCES resource_accounts(account_id),
  resource_type_id TEXT NOT NULL REFERENCES resource_types(resource_type_id),
  amount REAL NOT NULL CHECK(amount >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','active','released','expired','cancelled')),
  reserved_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  purpose TEXT NOT NULL,
  process_instance_id TEXT,
  activity_id TEXT,
  idempotency_key TEXT UNIQUE,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_reservations_account ON resource_reservations(account_id);
CREATE INDEX idx_reservations_status ON resource_reservations(status);
CREATE INDEX idx_reservations_interval ON resource_reservations(reserved_at, expires_at);
CREATE INDEX idx_reservations_process ON resource_reservations(process_instance_id) WHERE process_instance_id IS NOT NULL;

-- Process definitions (versioned recipes)
CREATE TABLE process_definitions (
  definition_id TEXT NOT NULL,
  version TEXT NOT NULL,
  schema_version TEXT NOT NULL DEFAULT '1.0',
  inputs_json TEXT NOT NULL CHECK(json_valid(inputs_json)),
  outputs_json TEXT NOT NULL CHECK(json_valid(outputs_json)),
  capacities_json TEXT NOT NULL CHECK(json_valid(capacities_json)),
  duration_model TEXT NOT NULL,
  output_model TEXT NOT NULL,
  failure_model TEXT NOT NULL,
  precondition_rule_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(precondition_rule_ids_json)),
  required_permission_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(required_permission_ids_json)),
  interruptibility TEXT NOT NULL CHECK(interruptibility IN('none','lossy','safe')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(definition_id, version)
);

-- Process instances (in-flight production)
CREATE TABLE process_instances (
  instance_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT '1.0',
  definition_id TEXT NOT NULL,
  definition_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN('queued','reserved','running','paused','completed','failed','cancelled','rework_required')),
  progress REAL NOT NULL DEFAULT 0 CHECK(progress >= 0 AND progress <= 1),
  reservations_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(reservations_json)),
  started_at TEXT,
  expected_completion_at TEXT,
  base_state_revision INTEGER NOT NULL,
  random_seed TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(definition_id, definition_version) REFERENCES process_definitions(definition_id, version)
);

CREATE INDEX idx_process_instances_status ON process_instances(status);
CREATE INDEX idx_process_instances_definition ON process_instances(definition_id, definition_version);

-- Activity records (actor-level tasks)
CREATE TABLE activity_records (
  activity_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT '1.0',
  actor_id TEXT NOT NULL,
  semantic_description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK(status IN('running','waiting','paused','completed','cancelled')),
  execution_refs_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(execution_refs_json)),
  reservations_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(reservations_json)),
  interruptibility TEXT NOT NULL CHECK(interruptibility IN('none','lossy','safe')),
  started_at TEXT NOT NULL,
  expected_boundary_at TEXT,
  source_refs_json TEXT NOT NULL CHECK(json_valid(source_refs_json)),
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_activity_records_actor ON activity_records(actor_id);
CREATE INDEX idx_activity_records_status ON activity_records(status);

-- Resource ledger: immutable audit trail for all balance changes
CREATE TABLE resource_ledger (
  ledger_entry_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES resource_accounts(account_id),
  resource_type_id TEXT NOT NULL REFERENCES resource_types(resource_type_id),
  delta REAL NOT NULL,
  balance_before REAL NOT NULL,
  balance_after REAL NOT NULL,
  reason TEXT NOT NULL,
  transfer_group_id TEXT,
  base_state_revision INTEGER NOT NULL,
  source_closure_hash TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_ledger_account ON resource_ledger(account_id);
CREATE INDEX idx_ledger_transfer_group ON resource_ledger(transfer_group_id) WHERE transfer_group_id IS NOT NULL;
CREATE INDEX idx_ledger_revision ON resource_ledger(base_state_revision);

-- Ledger source refs: source closure for each ledger entry
CREATE TABLE resource_ledger_sources (
  ledger_entry_id TEXT NOT NULL REFERENCES resource_ledger(ledger_entry_id),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  quote_hash TEXT,
  observed_at TEXT,
  PRIMARY KEY(ledger_entry_id, source_type, source_id)
);

-- World step audit: deterministic replay support
CREATE TABLE world_step_audit (
  step_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT '1.0',
  from_time TEXT NOT NULL,
  until_time TEXT NOT NULL,
  base_state_revision INTEGER NOT NULL,
  commands_json TEXT NOT NULL CHECK(json_valid(commands_json)),
  source_refs_json TEXT NOT NULL CHECK(json_valid(source_refs_json)),
  rule_set_version TEXT NOT NULL,
  random_seed TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
  input_hash TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  random_draws_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(random_draws_json)),
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX idx_world_step_revision ON world_step_audit(base_state_revision);
CREATE INDEX idx_world_step_idempotency ON world_step_audit(idempotency_key) WHERE idempotency_key IS NOT NULL;

COMMIT;
