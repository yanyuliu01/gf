from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path


CORPUS = Path(__file__).resolve().parents[1]
SCRIPTS = CORPUS / "scripts"
sys.path.insert(0, str(SCRIPTS))

from canonical_bytes import (  # noqa: E402
    HASH_CONTRACT,
    canonicalize_text_bytes,
    sha256_text_file,
)


class CanonicalBytesTests(unittest.TestCase):
    def test_lf_crlf_and_lone_cr_have_the_same_hash(self) -> None:
        variants = [b"alpha\nbeta\n", b"alpha\r\nbeta\r\n", b"alpha\rbeta\r"]
        expected = hashlib.sha256(b"alpha\nbeta\n").hexdigest()

        with tempfile.TemporaryDirectory() as directory:
            for index, content in enumerate(variants):
                path = Path(directory) / f"variant-{index}.txt"
                path.write_bytes(content)
                self.assertEqual(sha256_text_file(path), expected)

    def test_only_newline_spelling_is_normalized(self) -> None:
        source = b"\xef\xbb\xbfalpha \t\r\nbeta\r"
        self.assertEqual(
            canonicalize_text_bytes(source),
            b"\xef\xbb\xbfalpha \t\nbeta\n",
        )
        self.assertNotEqual(
            hashlib.sha256(canonicalize_text_bytes(b"alpha\n")).hexdigest(),
            hashlib.sha256(canonicalize_text_bytes(b"alpha")).hexdigest(),
        )

    def test_manifest_hashes_use_the_shared_contract(self) -> None:
        manifest_path = CORPUS / "canon" / "manifest.json"
        manifest = json.loads(manifest_path.read_text("utf-8"))
        self.assertEqual(manifest["hash_contract"], HASH_CONTRACT)

        for group in ("inputs", "outputs"):
            for record in manifest[group].values():
                path = CORPUS / record["path"]
                canonical = canonicalize_text_bytes(path.read_bytes())
                crlf_variant = canonical.replace(b"\n", b"\r\n")
                self.assertEqual(
                    hashlib.sha256(canonical).hexdigest(),
                    record["sha256"],
                )
                self.assertEqual(
                    hashlib.sha256(canonicalize_text_bytes(crlf_variant)).hexdigest(),
                    record["sha256"],
                )


if __name__ == "__main__":
    unittest.main()
