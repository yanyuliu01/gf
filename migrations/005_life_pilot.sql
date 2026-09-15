BEGIN IMMEDIATE;
CREATE TABLE life_runtime (
 singleton_id INTEGER PRIMARY KEY CHECK(singleton_id=1),
 state_json TEXT NOT NULL CHECK(json_valid(state_json)),
 muted INTEGER NOT NULL DEFAULT 0 CHECK(muted IN(0,1))
);
CREATE TABLE life_event_queue (
 event_id TEXT PRIMARY KEY REFERENCES world_events(event_id),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','done')),
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at TEXT,
 last_error TEXT
);
CREATE TABLE life_episodes (
 episode_id TEXT PRIMARY KEY,
 trigger_event_id TEXT NOT NULL REFERENCES world_events(event_id),
 base_revision INTEGER NOT NULL,
 input_json TEXT NOT NULL CHECK(json_valid(input_json)),
 result_json TEXT NOT NULL CHECK(json_valid(result_json)),
 created_at TEXT NOT NULL
);
CREATE TABLE life_delivery_leases (
 outbox_id TEXT PRIMARY KEY REFERENCES outbox(outbox_id),
 lease_until TEXT NOT NULL,
 first_attempt_at TEXT NOT NULL
);
CREATE TABLE life_model_attempts (
 attempt_id TEXT PRIMARY KEY,
 phase TEXT NOT NULL,
 input_json TEXT NOT NULL CHECK(json_valid(input_json)),
 output_json TEXT CHECK(output_json IS NULL OR json_valid(output_json)),
 error_code TEXT,
 created_at TEXT NOT NULL
);
CREATE TABLE life_owner (singleton_id INTEGER PRIMARY KEY CHECK(singleton_id=1), open_id TEXT NOT NULL, app_id TEXT NOT NULL);
COMMIT;
