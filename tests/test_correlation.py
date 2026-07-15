"""Correlation engine tests.

The fixtures use explicit pairs of (Finding, expected edge) so adding a
new rule is a matter of adding a fixture here. This is the contract the
spec calls for: correlations are deterministic and well-tested.
"""
from __future__ import annotations

from hunt.correlation import CorrelationEngine, default_rules
from hunt.ingestion.base import Finding
from hunt.models import Entity, EntityKind, SourceTool
from hunt.provenance.tsa import LocalTsaClient
from hunt.provenance.vault import EvidenceVaultLogger, LineageToken


def _fake_lineage(db) -> LineageToken:
    return EvidenceVaultLogger(db, LocalTsaClient("test")).log(
        source_tool=SourceTool.WHOIS,
        query_params={},
        raw_bytes=b"x",
    )


def _stamp(f: Finding, lineage: LineageToken) -> Finding:
    f.attributes["_hunt_lineage"] = lineage
    return f


def test_whois_and_hibp_email_collapses_to_entity_with_seen_by(sqlite_db, stub_tsa):
    SessionLocal = sqlite_db
    with SessionLocal() as db:
        lineage = _fake_lineage(db)
        findings = [
            _stamp(
                Finding(
                    source_tool=SourceTool.WHOIS,
                    entity_kind=EntityKind.EMAIL,
                    entity_value="alice@example.com",
                    attributes={"role": "registrant"},
                ),
                lineage,
            ),
            _stamp(
                Finding(
                    source_tool=SourceTool.HIBP,
                    entity_kind=EntityKind.EMAIL,
                    entity_value="alice@example.com",
                    attributes={"breach_count": 1},
                ),
                lineage,
            ),
        ]
        edges, _rows = CorrelationEngine(db, default_rules()).ingest(findings)
    assert edges == []
    with SessionLocal() as db:
        entity = (
            db.query(Entity)
            .filter(
                Entity.kind == EntityKind.EMAIL,
                Entity.value == "alice@example.com",
            )
            .one()
        )
        assert "whois" in entity.attributes["seen_by"]
        assert "hibp" in entity.attributes["seen_by"]


def test_crtsh_cert_creates_edge_to_domain(sqlite_db, stub_tsa):
    SessionLocal = sqlite_db
    with SessionLocal() as db:
        lineage = _fake_lineage(db)
        findings = [
            _stamp(
                Finding(
                    source_tool=SourceTool.CRT_SH,
                    entity_kind=EntityKind.CERT,
                    entity_value="example.com",
                    attributes={"issuer_name": "Let's Encrypt"},
                ),
                lineage,
            ),
            _stamp(
                Finding(
                    source_tool=SourceTool.DNS,
                    entity_kind=EntityKind.DOMAIN,
                    entity_value="example.com",
                    attributes={"record_type": "A"},
                ),
                lineage,
            ),
        ]
        edges, _ = CorrelationEngine(db, default_rules()).ingest(findings)
    rule_names = {e.rule for e in edges}
    assert "crtsh_cert_to_domain" in rule_names


def test_edges_are_idempotent(sqlite_db, stub_tsa):
    SessionLocal = sqlite_db
    with SessionLocal() as db:
        lineage = _fake_lineage(db)
        findings = [
            _stamp(
                Finding(
                    source_tool=SourceTool.CRT_SH,
                    entity_kind=EntityKind.CERT,
                    entity_value="bob.com",
                    attributes={},
                ),
                lineage,
            ),
            _stamp(
                Finding(
                    source_tool=SourceTool.DNS,
                    entity_kind=EntityKind.DOMAIN,
                    entity_value="bob.com",
                    attributes={},
                ),
                lineage,
            ),
        ]
        engine = CorrelationEngine(db, default_rules())
        first, _ = engine.ingest(findings)
        second, _ = engine.ingest(findings)
    assert len(first) == 1
    assert second == []


def test_ip_cross_source_emits_edge(sqlite_db, stub_tsa):
    SessionLocal = sqlite_db
    with SessionLocal() as db:
        lineage = _fake_lineage(db)
        findings = [
            _stamp(
                Finding(
                    source_tool=SourceTool.DNS,
                    entity_kind=EntityKind.IPV4,
                    entity_value="1.2.3.4",
                    attributes={},
                ),
                lineage,
            ),
            _stamp(
                Finding(
                    source_tool=SourceTool.SHODAN,
                    entity_kind=EntityKind.IPV4,
                    entity_value="1.2.3.4",
                    attributes={},
                ),
                lineage,
            ),
        ]
        edges, _ = CorrelationEngine(db, default_rules()).ingest(findings)
    rule_names = {e.rule for e in edges}
    assert "ip_cross_source" not in rule_names
    with SessionLocal() as db:
        entity = (
            db.query(Entity)
            .filter(
                Entity.kind == EntityKind.IPV4,
                Entity.value == "1.2.3.4",
            )
            .one()
        )
        assert "dns" in entity.attributes["seen_by"]
        assert "shodan" in entity.attributes["seen_by"]


def test_snapshot_contains_correlated_nodes(sqlite_db, stub_tsa):
    SessionLocal = sqlite_db
    with SessionLocal() as db:
        lineage = _fake_lineage(db)
        findings = [
            _stamp(
                Finding(
                    source_tool=SourceTool.CRT_SH,
                    entity_kind=EntityKind.CERT,
                    entity_value="snap.example",
                    attributes={},
                ),
                lineage,
            ),
            _stamp(
                Finding(
                    source_tool=SourceTool.DNS,
                    entity_kind=EntityKind.DOMAIN,
                    entity_value="snap.example",
                    attributes={},
                ),
                lineage,
            ),
        ]
        engine = CorrelationEngine(db, default_rules())
        engine.ingest(findings)
        snap = engine.snapshot()
    values = {n["value"] for n in snap.nodes}
    assert "snap.example" in values
    assert any(e["rule"] == "crtsh_cert_to_domain" for e in snap.edges)
