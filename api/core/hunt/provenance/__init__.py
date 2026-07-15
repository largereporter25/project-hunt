"""Project HUNT — provenance package.

This is the bedrock of the entire system. Every external API response must
pass through `provenance.middleware` *before* any parsing occurs. The
middleware:

  1. SHA-256 hashes the raw payload.
  2. Requests an RFC 3161 trusted timestamp (or a secure internal ref).
  3. Writes an immutable `EvidenceRecord` plus the bytes in `RawPayload`.
  4. Hands the lineage token (EvidenceRecord id + sha256) to the caller.

If anything in this chain fails, the payload MUST be rejected; under no
circumstances do we parse data without provenance.
"""
from hunt.provenance.hashing import (
    base64_decode,
    base64_encode,
    sha256_bytes,
    sha256_text,
    verify_payload,
)
from hunt.provenance.tsa import TsaClient, TsaError, TsaToken
from hunt.provenance.vault import EvidenceVaultLogger, LineageError, LineageToken
from hunt.provenance.middleware import (
    ProvenanceMiddleware,
    provenance_wrapper,
)

__all__ = [
    "base64_decode",
    "base64_encode",
    "sha256_bytes",
    "sha256_text",
    "verify_payload",
    "TsaClient",
    "TsaError",
    "TsaToken",
    "EvidenceVaultLogger",
    "LineageError",
    "LineageToken",
    "ProvenanceMiddleware",
    "provenance_wrapper",
]
