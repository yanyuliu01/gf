#!/usr/bin/env python3
"""Repository-level contract, documentation, canon, and diagram smoke audit."""

from __future__ import annotations

import json
import re
import struct
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def run(script: Path) -> None:
    result = subprocess.run(
        [sys.executable, str(script)],
        cwd=ROOT,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
    )
    if result.returncode:
        raise AssertionError(
            f"{script.relative_to(ROOT)} failed\n{result.stdout}{result.stderr}"
        )
    print(result.stdout.strip())


def validate_json_files() -> int:
    paths = list((ROOT / "schemas").glob("*.json"))
    paths += list((ROOT / "tests" / "contracts").glob("*.json"))
    paths += [
        ROOT / "corpus" / "source-manifest.json",
        ROOT / "corpus" / "canon" / "manifest.json",
        ROOT / "corpus" / "work" / "labels.json",
    ]
    for path in paths:
        with path.open(encoding="utf-8") as handle:
            json.load(
                handle,
                parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)),
            )
    return len(paths)


def validate_markdown_and_examples() -> tuple[int, int]:
    markdown = [
        path
        for root in (ROOT / "docs", ROOT / "prompts")
        for path in root.rglob("*.md")
        if "archive" not in path.parts
    ]
    json_examples = 0
    for path in markdown:
        text = path.read_text(encoding="utf-8")
        if text.count("```") % 2:
            raise AssertionError(f"unpaired Markdown fence: {path.relative_to(ROOT)}")
        for index, block in enumerate(re.findall(r"```json\s*\n(.*?)\n```", text, re.S), 1):
            try:
                json.loads(block)
            except json.JSONDecodeError as exc:
                raise AssertionError(
                    f"invalid JSON example {path.relative_to(ROOT)}#{index}: {exc}"
                ) from exc
            json_examples += 1
    return len(markdown), json_examples


def validate_manifest_paths() -> int:
    manifest = (ROOT / "prompts" / "manifest.yaml").read_text(encoding="utf-8")
    paths = re.findall(r'^\s*(?:path|template|schema):\s*"([^\"]+)"\s*$', manifest, re.M)
    missing = [path for path in paths if not (ROOT / path).exists()]
    if missing:
        raise AssertionError(f"prompt manifest references missing paths: {missing}")
    return len(paths)


def validate_no_obsolete_contract_terms() -> None:
    targets = list((ROOT / "docs").glob("*.md"))
    targets += list((ROOT / "prompts").rglob("*.md"))
    targets += list(ROOT.glob("*.mmd"))
    targets += [ROOT / "README.md", ROOT / "PROJECT-OVERVIEW.md"]
    patterns = {
        "caused_by_user_event_id": re.compile(r"\bcaused_by_user_event_id\b"),
        "event source field": re.compile(r"\bsource\s*=\s*(?:user|system)\b"),
        "old terra flag": re.compile(r"\baffects_terra\b"),
        "sequential canon id": re.compile(r"\b(?:cs|ck|cw)_\d{4}\b"),
    }
    failures = []
    for path in targets:
        text = path.read_text(encoding="utf-8")
        for label, pattern in patterns.items():
            match = pattern.search(text)
            if match:
                line = text.count("\n", 0, match.start()) + 1
                failures.append(f"{path.relative_to(ROOT)}:{line}: {label}")
    if failures:
        raise AssertionError("obsolete active contract terms:\n" + "\n".join(failures))


def validate_diagrams() -> int:
    names = (
        "product-interaction-architecture",
        "technical-architecture",
        "runtime-event-lifecycle",
        "emergence-validation-loop",
    )
    for name in names:
        svg = ROOT / f"{name}.svg"
        mmd = ROOT / f"{name}.mmd"
        png = ROOT / f"{name}.png"
        ET.parse(svg)
        if not mmd.read_text(encoding="utf-8").lstrip().startswith("%%{init:"):
            raise AssertionError(f"invalid Mermaid source header: {mmd.name}")
        data = png.read_bytes()
        if data[:8] != b"\x89PNG\r\n\x1a\n":
            raise AssertionError(f"invalid PNG signature: {png.name}")
        width, height = struct.unpack(">II", data[16:24])
        if width < 1200 or height < 700:
            raise AssertionError(f"diagram preview too small: {png.name} {width}x{height}")
    return len(names)


def main() -> int:
    run(ROOT / "tests" / "validate_contracts.py")
    run(ROOT / "corpus" / "scripts" / "audit_canon.py")
    json_count = validate_json_files()
    markdown_count, example_count = validate_markdown_and_examples()
    manifest_path_count = validate_manifest_paths()
    validate_no_obsolete_contract_terms()
    diagram_count = validate_diagrams()
    print(
        "OK: project audit; "
        f"json={json_count}, markdown={markdown_count}, json_examples={example_count}, "
        f"manifest_paths={manifest_path_count}, diagrams={diagram_count}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
