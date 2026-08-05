#!/usr/bin/env python3
"""Validate runtime JSON contracts, fixtures, and the initial SQLite migration."""

from __future__ import annotations

import copy
import datetime as dt
import json
import re
import sqlite3
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCHEMAS = ROOT / "schemas"
FIXTURES = ROOT / "tests" / "contracts"


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        return json.load(
            handle,
            parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)),
        )


class ContractError(ValueError):
    pass


class ContractValidator:
    """Small dependency-free validator for the JSON Schema subset used here.

    Production should use a Draft 2020-12 implementation. Keeping this smoke
    validator in stdlib makes repository checks runnable before dependencies exist.
    """

    def __init__(self, documents: dict[str, dict], schema_name: str):
        self.documents = documents
        self.schema_name = schema_name

    def validate(self, value: object) -> None:
        self._check(value, self.documents[self.schema_name], self.schema_name, "$")

    def _fail(self, path: str, message: str) -> None:
        raise ContractError(f"{path}: {message}")

    def _resolve(self, ref: str, current_name: str) -> tuple[dict, str]:
        file_part, _, fragment = ref.partition("#")
        name = Path(file_part).name if file_part else current_name
        if name not in self.documents:
            self._fail("$ref", f"unknown schema {name!r}")
        target = self.documents[name]
        if fragment:
            if not fragment.startswith("/"):
                self._fail("$ref", f"unsupported fragment {fragment!r}")
            for raw_part in fragment[1:].split("/"):
                part = raw_part.replace("~1", "/").replace("~0", "~")
                target = target[part]
        return target, name

    @staticmethod
    def _is_type(value: object, expected: str) -> bool:
        checks = {
            "object": lambda v: isinstance(v, dict),
            "array": lambda v: isinstance(v, list),
            "string": lambda v: isinstance(v, str),
            "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
            "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
            "boolean": lambda v: isinstance(v, bool),
            "null": lambda v: v is None,
        }
        return checks[expected](value)

    def _check(
        self, value: object, schema: dict, current_name: str, path: str
    ) -> None:
        if "$ref" in schema:
            target, target_name = self._resolve(schema["$ref"], current_name)
            self._check(value, target, target_name, path)
            schema = {key: item for key, item in schema.items() if key != "$ref"}

        if "anyOf" in schema:
            for candidate in schema["anyOf"]:
                try:
                    self._check(value, candidate, current_name, path)
                    break
                except ContractError:
                    pass
            else:
                self._fail(path, "does not match anyOf")

        for part in schema.get("allOf", []):
            self._check(value, part, current_name, path)

        if "if" in schema:
            try:
                self._check(value, schema["if"], current_name, path)
            except ContractError:
                pass
            else:
                self._check(value, schema.get("then", {}), current_name, path)

        if "const" in schema and value != schema["const"]:
            self._fail(path, f"must equal {schema['const']!r}")
        if "enum" in schema and value not in schema["enum"]:
            self._fail(path, f"not in enum {schema['enum']!r}")

        expected_type = schema.get("type")
        if expected_type is not None:
            expected = expected_type if isinstance(expected_type, list) else [expected_type]
            if not any(self._is_type(value, item) for item in expected):
                self._fail(path, f"expected type {expected!r}")

        if isinstance(value, dict):
            required = schema.get("required", [])
            missing = [key for key in required if key not in value]
            if missing:
                self._fail(path, f"missing required keys {missing!r}")
            properties = schema.get("properties", {})
            if schema.get("additionalProperties") is False:
                extras = sorted(set(value) - set(properties))
                if extras:
                    self._fail(path, f"unexpected keys {extras!r}")
            for key, child in properties.items():
                if key in value:
                    self._check(value[key], child, current_name, f"{path}.{key}")

        if isinstance(value, list):
            if len(value) < schema.get("minItems", 0):
                self._fail(path, "too few items")
            if "maxItems" in schema and len(value) > schema["maxItems"]:
                self._fail(path, "too many items")
            if schema.get("uniqueItems"):
                keys = [json.dumps(item, sort_keys=True, ensure_ascii=False) for item in value]
                if len(keys) != len(set(keys)):
                    self._fail(path, "items must be unique")
            if "items" in schema:
                for index, item in enumerate(value):
                    self._check(item, schema["items"], current_name, f"{path}[{index}]")

        if isinstance(value, str):
            if len(value) < schema.get("minLength", 0):
                self._fail(path, "string is too short")
            if "maxLength" in schema and len(value) > schema["maxLength"]:
                self._fail(path, "string is too long")
            if "pattern" in schema and re.search(schema["pattern"], value) is None:
                self._fail(path, f"does not match {schema['pattern']!r}")
            if schema.get("format") == "date-time":
                if re.fullmatch(
                    r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})",
                    value,
                ) is None:
                    self._fail(path, "date-time must be RFC 3339 with an explicit offset")
                try:
                    dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
                except ValueError as exc:
                    self._fail(path, f"invalid date-time: {exc}")

        if isinstance(value, (int, float)) and not isinstance(value, bool):
            if "minimum" in schema and value < schema["minimum"]:
                self._fail(path, "number below minimum")
            if "maximum" in schema and value > schema["maximum"]:
                self._fail(path, "number above maximum")


def validators() -> dict[str, ContractValidator]:
    documents = {path.name: load_json(path) for path in SCHEMAS.glob("*.schema.json")}
    for name, document in documents.items():
        if document.get("$schema") != "https://json-schema.org/draft/2020-12/schema":
            raise AssertionError(f"{name}: unexpected or missing JSON Schema dialect")
        if "$id" not in document:
            raise AssertionError(f"{name}: missing $id")
    return {name: ContractValidator(documents, name) for name in documents}


def expect_invalid(validator: ContractValidator, value: dict, label: str) -> None:
    try:
        validator.validate(value)
    except ContractError:
        return
    raise AssertionError(f"negative contract unexpectedly passed: {label}")


def validate_fixtures(all_validators: dict[str, ContractValidator]) -> None:
    fixture_map = {
        "world-event.valid.json": "world-event.schema.json",
        "capabilities.valid.json": "capabilities.schema.json",
        "patch-op.valid.json": "patch-op.schema.json",
        "debt.valid.json": "debt.schema.json",
        "tick-proposal.valid.json": "tick-proposal.schema.json",
        "scene-settlement.valid.json": "scene-settlement.schema.json",
        "memory-compression.valid.json": "memory-compression.schema.json",
        "probe-judgement.valid.json": "probe-judgement.schema.json",
        "surface-message.valid.json": "surface-message.schema.json",
    }
    loaded = {}
    for fixture_name, schema_name in fixture_map.items():
        value = load_json(FIXTURES / fixture_name)
        all_validators[schema_name].validate(value)
        loaded[fixture_name] = value

    old_source_ref = copy.deepcopy(loaded["scene-settlement.valid.json"])
    source = old_source_ref["claims"][0]["source_refs"][0]
    source["type"] = source.pop("source_type")
    source["id"] = source.pop("source_id")
    expect_invalid(
        all_validators["scene-settlement.schema.json"],
        old_source_ref,
        "legacy ambiguous source ref",
    )

    direct_tick_speech = copy.deepcopy(loaded["tick-proposal.valid.json"])
    direct_tick_speech["channels"]["express"] = "绕过最终发言器"
    expect_invalid(
        all_validators["tick-proposal.schema.json"],
        direct_tick_speech,
        "tick emits final speech",
    )

    legacy_debt_clear = copy.deepcopy(loaded["scene-settlement.valid.json"])
    legacy_debt_clear["debt_ids_clear"] = ["debt_0001"]
    expect_invalid(
        all_validators["scene-settlement.schema.json"],
        legacy_debt_clear,
        "evidence-free debt clearing",
    )

    system_without_connector = copy.deepcopy(loaded["world-event.valid.json"])
    system_without_connector["origin"] = "system"
    system_without_connector["provenance"]["connector_id"] = None
    expect_invalid(
        all_validators["world-event.schema.json"],
        system_without_connector,
        "system event without connector",
    )

    event_without_idempotency = copy.deepcopy(loaded["world-event.valid.json"])
    del event_without_idempotency["idempotency_key"]
    expect_invalid(
        all_validators["world-event.schema.json"],
        event_without_idempotency,
        "event without idempotency key",
    )

    message_without_content = copy.deepcopy(loaded["world-event.valid.json"])
    del message_without_content["payload"]["content"]
    expect_invalid(
        all_validators["world-event.schema.json"],
        message_without_content,
        "IM event without normalized content",
    )

    disclosure = copy.deepcopy(loaded["scene-settlement.valid.json"])["claims"][0]
    contradictory_claims = []
    terra_not_landed = copy.deepcopy(disclosure)
    terra_not_landed.update({"kind": "terra_effect", "scope": "terra"})
    contradictory_claims.append((terra_not_landed, "terra effect not landed"))
    terra_wrong_scope = copy.deepcopy(disclosure)
    terra_wrong_scope.update(
        {
            "kind": "terra_effect",
            "scope": "doctor_world",
            "lands_in_terra": True,
            "epistemic_status": "verified",
            "causal_action_ref": {
                "source_type": "event",
                "source_id": "evt_task_0001",
            },
        }
    )
    contradictory_claims.append((terra_wrong_scope, "terra effect in doctor scope"))
    generated_terra = copy.deepcopy(terra_wrong_scope)
    generated_terra.update({"scope": "terra", "epistemic_status": "generated"})
    contradictory_claims.append((generated_terra, "generated terra fact"))
    null_capability_cause = copy.deepcopy(disclosure)
    null_capability_cause.update(
        {
            "kind": "capability_change",
            "scope": "channel",
            "epistemic_status": "verified",
            "lands_in_terra": False,
            "causal_action_ref": None,
        }
    )
    contradictory_claims.append((null_capability_cause, "capability without event cause"))
    for value, label in contradictory_claims:
        expect_invalid(all_validators["claim.schema.json"], value, label)

    patch_without_value = copy.deepcopy(loaded["patch-op.valid.json"])
    patch_without_value.update({"op": "replace"})
    del patch_without_value["value"]
    expect_invalid(
        all_validators["patch-op.schema.json"],
        patch_without_value,
        "replace patch without value",
    )

    repaid_without_event = copy.deepcopy(loaded["debt.valid.json"])
    repaid_without_event["status"] = "repaid"
    repaid_without_event["repaid_by_event_id"] = None
    expect_invalid(
        all_validators["debt.schema.json"],
        repaid_without_event,
        "repaid debt without repayment event",
    )


def validate_cross_field_contracts() -> None:
    for fixture_name in ("tick-proposal.valid.json", "scene-settlement.valid.json"):
        value = load_json(FIXTURES / fixture_name)
        base_revision = value["base_state_revision"]
        for patch in value["patch_ops"]:
            if patch["expected_state_revision"] != base_revision:
                raise AssertionError(
                    f"{fixture_name}: patch revision differs from proposal base revision"
                )

    memory = load_json(FIXTURES / "memory-compression.valid.json")
    placements = []
    placements.extend(memory["kept_as_is"])
    placements.extend(item["event_id"] for item in memory["excluded_from_retrieval"])
    for derived in memory["derived_memories"]:
        event_sources = [
            ref["source_id"]
            for ref in derived["source_refs"]
            if ref["source_type"] == "event"
        ]
        if len(event_sources) < 2:
            raise AssertionError("derived memory must merge at least two source events")
        placements.extend(event_sources)
        period_start = dt.datetime.fromisoformat(derived["period_start"])
        period_end = dt.datetime.fromisoformat(derived["period_end"])
        if period_start > period_end:
            raise AssertionError("derived memory period is reversed")
    if sorted(placements) != sorted(memory["processed_event_ids"]):
        raise AssertionError("memory output is not an exact event partition")

    probe = load_json(FIXTURES / "probe-judgement.valid.json")
    if [item["aspect"] for item in probe["verdicts"]] != [1, 2, 3, 4, 5]:
        raise AssertionError("probe aspects are not in the required 1..5 order")


def validate_migration() -> None:
    sql = (ROOT / "migrations" / "001_initial.sql").read_text(encoding="utf-8")
    connection = sqlite3.connect(":memory:")
    try:
        connection.executescript(sql)
        version = connection.execute(
            "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1"
        ).fetchone()
        if version != ("001",):
            raise AssertionError("initial migration did not register version 001")
        required = {
            "world_events",
            "operation_commits",
            "claims",
            "patch_operations",
            "debts",
            "speech_records",
            "outbox",
            "operation_processed_messages",
            "runtime_revision",
        }
        actual = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        missing = required - actual
        if missing:
            raise AssertionError(f"migration missing tables: {sorted(missing)}")
        validate_sql_invariants(connection)
    finally:
        connection.close()


def expect_integrity_error(connection: sqlite3.Connection, sql: str, params: tuple) -> None:
    try:
        connection.execute(sql, params)
    except sqlite3.IntegrityError:
        return
    raise AssertionError("invalid SQLite write unexpectedly succeeded")


def validate_sql_invariants(connection: sqlite3.Connection) -> None:
    if connection.execute("PRAGMA foreign_keys").fetchone() != (1,):
        raise AssertionError("SQLite foreign keys are not enabled")

    event_sql = """
        INSERT INTO world_events(
            event_id, schema_version, origin, kind, occurred_at, received_at,
            principal_id, trust, privacy_scope, idempotency_key, payload_json
        ) VALUES (?, '1.0', ?, ?, '2026-08-05T00:00:00Z',
                  '2026-08-05T00:00:00Z', ?, ?, 'private_im', ?, '{}')
    """
    connection.execute(
        event_sql,
        ("evt_tick_1", "impulse", "tick.requested", "host", "generated", "tick:1"),
    )
    connection.execute(
        event_sql,
        ("evt_msg_1", "user", "im.message.received", "doctor", "authenticated", "im:1"),
    )
    connection.execute(
        "INSERT INTO messages VALUES (?, ?, 'inbound', 'private_im', ?, 'private_im', '{}', ?)",
        ("msg_1", "evt_msg_1", "doctor", "2026-08-05T00:00:00Z"),
    )
    connection.execute(
        "INSERT INTO scenes(scene_id, status, privacy_scope, opened_at) VALUES ('scene_1', 'open', 'private_im', '2026-08-05T00:00:00Z')"
    )
    connection.execute(
        "INSERT INTO scene_messages VALUES ('scene_1', 'msg_1', 0)"
    )

    operation_sql = """
        INSERT INTO operation_commits(
            operation_id, operation_kind, trigger_event_id, scene_id, batch_id,
            base_state_revision, committed_state_revision, proposal_json, proposal_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?)
    """
    expect_integrity_error(
        connection,
        operation_sql,
        ("op_bad_tick", "tick", None, None, None, 0, 1, "hash_bad_tick"),
    )
    expect_integrity_error(
        connection,
        operation_sql,
        ("op_bad_scene", "scene_settlement", None, None, None, 0, 1, "hash_bad_scene"),
    )
    connection.execute(
        operation_sql,
        ("op_tick_1", "tick", "evt_tick_1", None, None, 0, 1, "hash_tick_1"),
    )
    expect_integrity_error(
        connection,
        operation_sql,
        ("op_tick_2", "tick", "evt_tick_1", None, None, 1, 2, "hash_tick_2"),
    )
    connection.execute(
        operation_sql,
        ("op_scene_1", "scene_settlement", None, "scene_1", "batch_1", 1, 2, "hash_scene_1"),
    )
    connection.execute(
        "INSERT INTO operation_processed_messages VALUES ('op_scene_1', 'scene_1', 'msg_1', 0)"
    )
    connection.execute(
        operation_sql,
        ("op_scene_2", "scene_settlement", None, "scene_1", "batch_2", 2, 3, "hash_scene_2"),
    )
    expect_integrity_error(
        connection,
        "INSERT INTO operation_processed_messages VALUES (?, ?, ?, ?)",
        ("op_scene_2", "scene_1", "msg_1", 0),
    )

    invalid_claim_sql = """
        INSERT INTO claims(
            claim_id, operation_id, scope, kind, claim_text, epistemic_status,
            lands_in_terra, privacy_scope
        ) VALUES ('claim_bad', 'op_scene_1', 'doctor_world', 'terra_effect',
                  'bad', 'reported', 0, 'private_im')
    """
    expect_integrity_error(connection, invalid_claim_sql, ())

    invalid_debt_sql = """
        INSERT INTO debts(
            debt_id, promise_text, created_at, privacy_scope, status, attempts,
            created_by_operation_id, repaid_by_event_id, updated_at
        ) VALUES ('debt_bad', 'x', '2026-08-05T00:00:00Z', 'private_im',
                  'repaid', 0, 'op_scene_1', NULL, '2026-08-05T00:00:00Z')
    """
    expect_integrity_error(connection, invalid_debt_sql, ())

    connection.execute(
        """INSERT INTO speech_records(
               speech_id, operation_id, trigger_event_id, channel,
               recipient_principal_id, privacy_scope, capability_revision,
               authorization_decision_id, content, status, created_at
           ) VALUES ('speech_1', 'op_tick_1', 'evt_tick_1', 'private_im',
                     'doctor', 'private_im', 0, 'authz_1', 'hello', 'queued',
                     '2026-08-05T00:00:00Z')"""
    )
    connection.execute(
        "INSERT INTO speech_sources VALUES ('speech_1', 'event', 'evt_tick_1', 0)"
    )
    outbox_sql = """
        INSERT INTO outbox(
            outbox_id, operation_id, speech_id, channel, recipient_principal_id,
            privacy_scope, capability_revision, authorization_decision_id,
            authorization_json, payload_json,
            idempotency_key, status, created_at
        ) VALUES (?, 'op_tick_1', 'speech_1', 'private_im', 'doctor', ?, 0,
                  'authz_1', '{}', '{}', ?, 'pending', '2026-08-05T00:00:00Z')
    """
    expect_integrity_error(
        connection,
        outbox_sql,
        ("outbox_bad_privacy", "public_allowed", "outbox:bad"),
    )
    connection.execute(
        outbox_sql,
        ("outbox_1", "private_im", "outbox:1"),
    )
    expect_integrity_error(
        connection,
        outbox_sql,
        ("outbox_2", "private_im", "outbox:2"),
    )
    expect_integrity_error(
        connection,
        "UPDATE outbox SET privacy_scope = 'public_allowed' WHERE outbox_id = 'outbox_1'",
        (),
    )
    expect_integrity_error(
        connection,
        "UPDATE speech_records SET content = 'mutated' WHERE speech_id = 'speech_1'",
        (),
    )
    connection.execute(
        "UPDATE outbox SET status = 'sending', attempts = attempts + 1 WHERE outbox_id = 'outbox_1'"
    )
    connection.execute(
        "UPDATE speech_records SET status = 'sent' WHERE speech_id = 'speech_1'"
    )

    cursor = connection.execute(
        "UPDATE runtime_revision SET current_revision = 1 WHERE singleton_id = 1 AND current_revision = 0"
    )
    if cursor.rowcount != 1:
        raise AssertionError("initial CAS update did not acquire revision")
    cursor = connection.execute(
        "UPDATE runtime_revision SET current_revision = 2 WHERE singleton_id = 1 AND current_revision = 0"
    )
    if cursor.rowcount != 0:
        raise AssertionError("stale CAS update unexpectedly succeeded")


def main() -> int:
    all_validators = validators()
    validate_fixtures(all_validators)
    validate_cross_field_contracts()
    validate_migration()
    print(
        f"OK: {len(all_validators)} schemas, 9 positive fixtures, "
        "12 negative contracts, migration 001 invariants"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
