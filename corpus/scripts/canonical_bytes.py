#!/usr/bin/env python3
"""Canonical byte contract for text hashes in the canon manifest."""

from __future__ import annotations

import hashlib
from pathlib import Path


HASH_CONTRACT = {
    "version": "1",
    "algorithm": "sha256",
    "canonicalization": (
        "replace CRLF and lone CR bytes with LF; preserve every other byte"
    ),
}


def canonicalize_text_bytes(data: bytes) -> bytes:
    """Normalize newline spelling without rewriting any other byte."""
    return data.replace(b"\r\n", b"\n").replace(b"\r", b"\n")


def sha256_text_file(path: str | Path) -> str:
    """Hash a text file using the canon manifest's canonical byte contract."""
    canonical = canonicalize_text_bytes(Path(path).read_bytes())
    return hashlib.sha256(canonical).hexdigest()
