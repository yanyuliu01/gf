#!/usr/bin/env python3
"""Fail-closed audit for generated canon artifacts and runtime-safe text."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CANON = ROOT / "canon"
WORK = ROOT / "work"
ID_RE = re.compile(r"^(?:cs|ck|cw)_[0-9a-f]{16}$")
UNSAFE_RE = re.compile(r"【(?:博士选项|分支(?:·[^】]*)?|画面文字)】")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_jsonl(path: Path) -> list[dict]:
    entries = []
    with path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError as exc:
                raise AssertionError(f"{path}:{line_number}: {exc}") from exc
    return entries


def main() -> int:
    manifest_path = CANON / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    chunk_ids = {
        entry["id"] for entry in read_jsonl(WORK / "chunks.jsonl")
    }

    seen_ids = set()
    total = safe = quarantined = 0
    for label, prefix in (("self", "cs"), ("known", "ck"), ("world", "cw")):
        path = CANON / f"canon_{label}.jsonl"
        entries = read_jsonl(path)
        expected = manifest["outputs"][label]
        if expected["entries"] != len(entries):
            raise AssertionError(f"manifest count mismatch for canon_{label}")
        if expected["sha256"] != sha256(path):
            raise AssertionError(f"manifest hash mismatch for canon_{label}")

        for entry in entries:
            entry_id = entry.get("id", "")
            if not ID_RE.fullmatch(entry_id) or not entry_id.startswith(prefix + "_"):
                raise AssertionError(f"invalid stable id: {entry_id!r}")
            if entry_id in seen_ids:
                raise AssertionError(f"duplicate canon id: {entry_id}")
            seen_ids.add(entry_id)

            if entry.get("label") != f"canon_{label}":
                raise AssertionError(f"label/file mismatch: {entry_id}")
            runtime_safe = entry.get("runtime_safe")
            role_safe_text = entry.get("role_safe_text")
            if runtime_safe is True:
                if not isinstance(role_safe_text, str) or not role_safe_text:
                    raise AssertionError(f"safe entry lacks role-safe text: {entry_id}")
                marker = UNSAFE_RE.search(role_safe_text)
                if marker:
                    raise AssertionError(
                        f"unsafe role marker {marker.group(0)!r} in {entry_id}"
                    )
                safe += 1
            elif runtime_safe is False:
                if role_safe_text is not None or not entry.get("unsafe_reasons"):
                    raise AssertionError(f"quarantine metadata invalid: {entry_id}")
                quarantined += 1
            else:
                raise AssertionError(f"missing runtime_safe boolean: {entry_id}")

            source_chunk_id = entry.get("source_chunk_id")
            if source_chunk_id is not None and source_chunk_id not in chunk_ids:
                raise AssertionError(f"missing source chunk {source_chunk_id}: {entry_id}")
            if entry.get("kind") in {"story", "module", "memory"} and not source_chunk_id:
                raise AssertionError(f"chunk-derived entry lacks source id: {entry_id}")
        total += len(entries)

    for group in ("inputs", "outputs"):
        for name, record in manifest[group].items():
            path = ROOT / record["path"]
            if not path.exists():
                raise AssertionError(f"manifest {group}.{name} missing: {path}")
            if sha256(path) != record["sha256"]:
                raise AssertionError(f"manifest {group}.{name} hash mismatch")

    if safe + quarantined != total:
        raise AssertionError("runtime safety accounting mismatch")
    print(
        f"OK: {total} canon entries; runtime-safe={safe}; "
        f"quarantined={quarantined}; stable IDs and manifest hashes valid"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
