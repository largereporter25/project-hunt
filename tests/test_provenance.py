"""Provenance tests: SHA-256 determinism, vault insertion, lineage
rejection when the stored hash doesn't match the bytes, and the
end-to-end ingestion path through `ToolFunction`."""
from __future__ import annotations

import base64

import pytest

from hunt.ingestion.base import Finding, ToolFunction
from hunt.models import (
    EntityKind,
    EvidenceRecord,
    Finding as FindingRow,
    RawPayload,
    SourceTool,
)
from hunt.provenance.hashing import sha256_bytes, verify_payload
from hunt.provenance.vault import EvidenceVaultLogger, LineageError


def test_sha256_is_deterministic():
    assert sha256_bytes(b"Project HUNT") == sha256_bytes(b"Project HUNT")
    assert len(sha256_bytes(b"x")) == 64


def test_raw_payload_round_trips_through_db(sqlite_db, stub_tsa):
    SessionLocal = sqlite_db
    raw = b'{"ip": "1.1.1.1"}'
    with SessionLocal() as db:
        token = EvidenceVaultLogger(db, stub_tsa).log(
            source_tool=SourceTool.SHODAN,
            query_params={"target": "1.1.1.1"},
            raw_bytes=raw,
            content_type="application/json",
        )
    assert token.payload_sha256 == sha256_bytes(raw)
    with SessionLocal() as db:
        payload = (
            db.query(RawPayload)
            .filter(RawPayload.sha256 == token.payload_sha256)
            .one()
        )
        assert verify_payload(base64.b64decode(payload.content_b64), token.payload_sha256)


def test_lineage_rejects_tampered_payload(sqlite_db, stub_tsa):
    SessionLocal = sqlite_db
    raw = b'{"x": 1}'
    with SessionLocal() as db:
        token = EvidenceVaultLogger(db, stub_tsa).log(
            source_tool=SourceTool.SHODAN, query_params={}, raw_bytes=raw
        )
    with SessionLocal() as db:
        payload = (
            db.query(RawPayload)
            .filter(RawPayload.sha256 == token.payload_sha256)
            .one()
        )
        payload.content_b64 = base64.b64encode(b'{"x": 2}').decode("ascii")
        db.commit()
    with SessionLocal() as db:
        with pytest.raises(LineageError):
            EvidenceVaultLogger(db, stub_tsa).validate_lineage(token.evidence_id)


def test_empty_payload_is_refused(sqlite_db, stub_tsa):
    SessionLocal = sqlite_db
    with SessionLocal() as db:
        with pytest.raises(LineageError):
            EvidenceVaultLogger(db, stub_tsa).log(
                source_tool=SourceTool.SHODAN, query_params={}, raw_bytes=b""
            )


# --- A minimal ToolFunction for end-to-end coverage ----------------------


class _FakeTool(ToolFunction):
    """A tool that returns canned findings but goes through the full
    provenance pipeline. Used to assert that findings inherit lineage."""

    name = SourceTool.SHODAN
    accepts = {"domain"}
    emits = {EntityKind.DOMAIN}

    def _fetch(self, query):
        import httpx

        return httpx.Response(200, content=b'{"domain": "example.com"}')

    def _parse(self, raw, query):
        return [
            Finding(
                source_tool=self.name,
                entity_kind=EntityKind.DOMAIN,
                entity_value=query["target"],
                attributes={"note": "fake"},
            )
        ]


def test_tool_function_emits_finding_with_lineage(sqlite_db, stub_tsa):
    SessionLocal = sqlite_db
    with SessionLocal() as db:
        tool = _FakeTool(db, tsa=stub_tsa)
        findings = tool.run({"target": "example.com", "kind": "domain"})
        rows = tool.commit(findings)

    assert len(rows) == 1
    row: FindingRow = rows[0]
    assert row.entity_value == "example.com"
    assert row.attributes == {"note": "fake"}
    with SessionLocal() as db:
        rec = EvidenceVaultLogger(db, stub_tsa).validate_lineage(row.evidence_id)
        assert rec.payload_sha256 == sha256_bytes(b'{"domain": "example.com"}')
        assert rec.source_tool == SourceTool.SHODAN
        assert rec.query_params == {"target": "example.com", "kind": "domain"}
        assert rec.tsa_authority == "test"
        assert rec.tsa_stamped_at is not None
