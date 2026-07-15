"""SHA-256 hashing helpers.

The hash is the single most important value in the system — it ties raw
bytes to the Evidence Vault, and ultimately to every Finding rendered in
the dashboard. We make these functions total and side-effect free.
"""
from __future__ import annotations

import base64
import hashlib
from typing import Union

BytesLike = Union[bytes, bytearray, memoryview]

# Lowercase hex, 64 chars, the form Postgres stores it in.
HASH_HEX_LEN = 64


def sha256_bytes(data: BytesLike) -> str:
    """Return the lowercase hex SHA-256 of `data`."""
    if not isinstance(data, (bytes, bytearray, memoryview)):
        raise TypeError(f"sha256_bytes requires bytes-like input, got {type(data).__name__}")
    return hashlib.sha256(bytes(data)).hexdigest()


def sha256_text(text: str, encoding: str = "utf-8") -> str:
    """Return the lowercase hex SHA-256 of a string."""
    return sha256_bytes(text.encode(encoding))


def base64_encode(data: BytesLike) -> str:
    return base64.b64encode(bytes(data)).decode("ascii")


def base64_decode(data: str) -> bytes:
    return base64.b64decode(data.encode("ascii"))


def verify_payload(data: BytesLike, expected_sha256: str) -> bool:
    """Constant-time-ish check that data hashes to `expected_sha256`."""
    return sha256_bytes(data) == expected_sha256.lower()
