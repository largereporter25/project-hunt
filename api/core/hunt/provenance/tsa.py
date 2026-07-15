"""RFC 3161 trusted timestamp client.

Tries a configurable chain of TSAs in order. If all of them fail
*and* ``tsa_required`` is false, falls back to a local-clock stamp
(marked ``trusted=False``) so the Evidence Vault never blocks an
investigation on an upstream outage.
"""
from __future__ import annotations

import base64
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import List, Optional, Protocol

import httpx

from hunt.config import Settings, tsa_chain as _tsa_chain
from hunt.provenance.hashing import base64_encode

log = logging.getLogger(__name__)


class TsaError(RuntimeError):
    """Raised when no trusted timestamp can be obtained and TSA is required."""


@dataclass(frozen=True)
class TsaToken:
    token_b64: str
    authority: str
    stamped_at: datetime
    trusted: bool  # False only when we fell back to the local reference


class _TsaAuthority(Protocol):
    def stamp(self, digest: bytes) -> TsaToken: ...


def _build_tsp_request(digest: bytes) -> bytes:
    """Build a minimal RFC 3161 TimeStampReq DER blob for SHA-256.

    OID for SHA-256 is 2.16.840.1.101.3.4.2.1.
    """
    sha256_oid = bytes(
        [0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]
    )
    alg_id = bytes(
        [0x30, len(sha256_oid) + 2, 0x30, len(sha256_oid), *sha256_oid, 0x05, 0x00]
    )
    if len(digest) < 128:
        msg_imprint = (
            bytes([0x30, len(alg_id) + len(digest) + 2, 0x04, len(digest), *digest])
        )
    else:
        msg_imprint = bytes(
            [
                0x30,
                0x81,
                len(alg_id) + len(digest) + 4,
                0x04,
                0x82,
                len(digest) >> 8,
                len(digest) & 0xFF,
                *digest,
            ]
        )
    version_and_imprint = bytes([0x02, 0x01, 0x01]) + alg_id + msg_imprint
    return bytes([0x30, len(version_and_imprint) + 2]) + version_and_imprint


def _parse_gen_time(token_der: bytes) -> Optional[datetime]:
    """Best-effort extraction of ``genTime`` from a TSTInfo."""
    try:
        from asn1crypto import tsp

        token = tsp.TimeStampToken.load(token_der)
        tst = token["content"]["encap_content_info"]["content"].parsed
        return tst["gen_time"].native  # type: ignore[no-any-return]
    except Exception:  # noqa: BLE001
        pass

    i = token_der.find(b"\x18")
    if i == -1 or i + 2 >= len(token_der):
        return None
    length = token_der[i + 1]
    if length & 0x80:
        if length == 0x81 and i + 3 < len(token_der):
            length = token_der[i + 2]
            start = i + 3
        else:
            return None
    else:
        start = i + 2
    raw = token_der[start : start + length]
    try:
        return datetime.strptime(raw.decode("ascii"), "%Y%m%d%H%M%SZ").replace(
            tzinfo=timezone.utc
        )
    except Exception:  # noqa: BLE001
        return None


class HttpTsaClient:
    """Stamps using a real RFC 3161 TSA over HTTP(S) with a hard timeout."""

    def __init__(self, url: str, timeout: float = 3.0):
        self.url = url
        self._timeout = timeout

    def stamp(self, digest: bytes) -> TsaToken:
        req = _build_tsp_request(digest)
        with httpx.Client(timeout=self._timeout) as client:
            resp = client.post(
                self.url,
                content=req,
                headers={"Content-Type": "application/timestamp-query"},
            )
        if resp.status_code >= 400:
            raise TsaError(
                f"TSA {self.url} returned HTTP {resp.status_code}: {resp.text[:200]}"
            )
        if not resp.content:
            raise TsaError(f"TSA {self.url} returned empty body")
        stamped_at = _parse_gen_time(resp.content) or datetime.now(timezone.utc)
        return TsaToken(
            token_b64=base64_encode(resp.content),
            authority=self.url,
            stamped_at=stamped_at,
            trusted=True,
        )


class LocalTsaClient:
    """Non-trusted local clock. Used as a fallback when ``tsa_required`` is false."""

    def __init__(self, label: str = "local-clock"):
        self.label = label

    def stamp(self, digest: bytes) -> TsaToken:  # noqa: ARG002
        return TsaToken(
            token_b64="",
            authority=self.label,
            stamped_at=datetime.now(timezone.utc),
            trusted=False,
        )


class TsaClient:
    """Dispatcher with a fallback chain and a non-trusted local clock."""

    def __init__(
        self,
        settings: Settings,
        authorities: Optional[List[_TsaAuthority]] = None,
    ):
        self._settings = settings
        self._authorities: List[_TsaAuthority] = (
            authorities
            if authorities is not None
            else [
                HttpTsaClient(url, settings.tsa_timeout_seconds)
                for url in _tsa_chain(settings)
            ]
        )

    def stamp(self, hash_hex: str) -> TsaToken:
        if len(hash_hex) != 64:
            raise ValueError("hash_hex must be a 64-char SHA-256 hex string")
        try:
            digest = bytes.fromhex(hash_hex)
        except ValueError as exc:
            raise ValueError("hash_hex must be valid hex") from exc

        last_err: Optional[BaseException] = None
        for auth in self._authorities:
            try:
                return auth.stamp(digest)
            except Exception as exc:  # noqa: BLE001
                log.warning("TSA %s failed: %s", auth, exc)
                last_err = exc

        if not self._settings.tsa_required:
            log.info("All TSAs unreachable; using local clock (non-trusted)")
            return LocalTsaClient().stamp(digest)

        raise TsaError(f"All TSAs failed; last error: {last_err!r}")
