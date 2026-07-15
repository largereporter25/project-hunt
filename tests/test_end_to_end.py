"""End-to-end investigation test — a real tool, full provenance chain,
correlation engine end-to-end, and a hunt POSTed to the FastAPI app."""
from __future__ import annotations

import socket

import pytest

from hunt.correlation import CorrelationEngine, default_rules
from hunt.ingestion.base import Finding
from hunt.ingestion.tools.dns import DnsTool
from hunt.ingestion.tools.whois import WhoisTool
from hunt.models import Entity, EntityKind, SourceTool
from hunt.provenance.vault import EvidenceVaultLogger


def test_dns_tool_logs_provenance_and_emits_findings(sqlite_db, stub_tsa):
    target = "example.com"
    try:
        socket.getaddrinfo(target, None)
    except socket.gaierror:
        pytest.skip("no DNS in this environment")
    SessionLocal = sqlite_db
    with SessionLocal() as db:
        tool = DnsTool(db, tsa=stub_tsa)
        findings = tool.run({"target": target, "kind": "domain"})
        rows = tool.commit(findings)
    assert rows, "DnsTool produced no findings"
    assert all(r.evidence_id is not None for r in rows)
    assert all(r.entity_kind.value in {"ipv4", "ipv6"} for r in rows)


def test_whois_tool_does_not_crash_on_unknown_domain(sqlite_db, stub_tsa):
    """Real call against RDAP — should return findings or an empty list
    without ever raising into the test (the base class catches errors)."""
    SessionLocal = sqlite_db
    with SessionLocal() as db:
        tool = WhoisTool(db, tsa=stub_tsa)
        # The base class never raises; we just check the result is a list.
        result = tool.run({"target": "this-domain-definitely-does-not-exist.invalid", "kind": "domain"})
    assert isinstance(result, list)


def test_correlation_engine_records_attribution_from_dns(sqlite_db, stub_tsa):
    SessionLocal = sqlite_db
    with SessionLocal() as db:
        lineage = EvidenceVaultLogger(db, stub_tsa).log(
            source_tool=SourceTool.DNS, query_params={}, raw_bytes=b"raw"
        )
        findings = [
            Finding(
                source_tool=SourceTool.DNS,
                entity_kind=EntityKind.IPV4,
                entity_value="9.9.9.9",
                attributes={},
            ),
            Finding(
                source_tool=SourceTool.SHODAN,
                entity_kind=EntityKind.IPV4,
                entity_value="9.9.9.9",
                attributes={},
            ),
        ]
        for f in findings:
            f.attributes["_hunt_lineage"] = lineage
        edges, _ = CorrelationEngine(db, default_rules()).ingest(findings)
    assert edges == []
    with SessionLocal() as db:
        entity = (
            db.query(Entity)
            .filter(Entity.kind == EntityKind.IPV4, Entity.value == "9.9.9.9")
            .one()
        )
        assert "dns" in entity.attributes["seen_by"]
        assert "shodan" in entity.attributes["seen_by"]


def test_hunt_endpoint_returns_findings(sqlite_db, stub_tsa, monkeypatch):
    """End-to-end via the FastAPI app: POST a target, get a HuntResponse."""
    from fastapi.testclient import TestClient

    from hunt.main import create_app
    from hunt.db import get_db

    SessionLocal = sqlite_db

    def _override_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app = create_app()
    app.dependency_overrides[get_db] = _override_db
    client = TestClient(app)
    r = client.post("/api/v1/hunt", json={"target": "example.com", "kind": "domain"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["target"] == "example.com"
    assert "investigation_id" in body
    assert isinstance(body["findings"], list)
    assert isinstance(body["modules_run"], list)
