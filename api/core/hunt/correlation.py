"""Deterministic correlation engine.

Two findings sharing a join-key value produce an edge between their
entities. Findings with the same ``(entity_kind, entity_value)``
observed by *different* source tools are recorded in the entity's
``seen_by`` list (no self-edge needed).

All edges are persisted in the DB; the in-memory graph is rebuilt
from the DB on every request — Vercel serverless functions are
stateless, so the DB is the source of truth.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterable, List, Optional, Set, Tuple

from sqlalchemy.orm import Session

from hunt.config import is_postgres as _is_pg
from hunt.ingestion.base import Finding as ToolFinding
from hunt.models import (
    Entity,
    EntityKind,
    EntityRelationship,
    Finding,
    SourceTool,
)

_IS_PG = _is_pg()

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class EdgeRule:
    name: str
    description: str
    lhs: EntityKind
    rhs: EntityKind
    weight: int = 1
    join_key: Callable[[ToolFinding], str] = lambda f: f.entity_value  # type: ignore[assignment]


@dataclass
class GraphSnapshot:
    nodes: List[Dict[str, Any]] = field(default_factory=list)
    edges: List[Dict[str, Any]] = field(default_factory=list)

    def as_dict(self) -> Dict[str, Any]:
        return {
            "nodes": self.nodes,
            "edges": self.edges,
            "node_count": len(self.nodes),
            "edge_count": len(self.edges),
        }


def _by_value(f: ToolFinding) -> str:
    return f.entity_value.lower()


def default_rules() -> List[EdgeRule]:
    """A small, high-signal rule set. Add new rules + fixtures in tests."""
    return [
        # Same IP observed by two different tools — strongest cross-source signal.
        EdgeRule(
            name="ip_cross_source",
            description="Same IP observed by multiple tools.",
            lhs=EntityKind.IPV4, rhs=EntityKind.IPV4, weight=4, join_key=_by_value,
        ),
        # Subdomain surfaced by crt.sh and theHarvester (or DNS).
        EdgeRule(
            name="subdomain_cross_source",
            description="Subdomain observed by multiple tools.",
            lhs=EntityKind.SUBDOMAIN, rhs=EntityKind.SUBDOMAIN,
            weight=3, join_key=_by_value,
        ),
        # crt.sh cert ↔ the domain it was issued for (the cert record
        # carries the domain in attributes).
        EdgeRule(
            name="crtsh_cert_to_domain",
            description="A certificate was issued for this domain.",
            lhs=EntityKind.CERT, rhs=EntityKind.DOMAIN, weight=2, join_key=_by_value,
        ),
        # IP ↔ ASN
        EdgeRule(
            name="ip_to_asn",
            description="An IP is announced by an ASN.",
            lhs=EntityKind.IPV4, rhs=EntityKind.ASN, weight=2, join_key=_by_value,
        ),
    ]


class CorrelationEngine:
    """Stateless engine — holds a per-instance in-memory graph for the
    current request, but persists every edge and entity to the DB."""

    def __init__(self, db: Session, rules: Iterable[EdgeRule]):
        self._db = db
        self._rules: List[EdgeRule] = list(rules)

    def ingest(
        self,
        findings: List[ToolFinding],
        investigation_id: Optional[uuid.UUID] = None,
    ) -> Tuple[List[EntityRelationship], List[Finding]]:
        """Persist findings, run the rules, return (new_edges, persisted_rows)."""
        rows: List[Finding] = []
        for tf in findings:
            lineage: Any = tf.attributes.pop("_hunt_lineage", None)
            if lineage is None:
                log.warning("Finding has no lineage — skipping: %s", tf)
                continue
            row = Finding(
                investigation_id=investigation_id,
                evidence_id=lineage.evidence_id,
                source_tool=tf.source_tool,
                entity_kind=tf.entity_kind,
                entity_value=tf.entity_value,
                attributes=tf.attributes,
            )
            self._db.add(row)
            rows.append(row)
        self._db.flush()

        for row in rows:
            self._ensure_entity(row.entity_kind, row.entity_value)

        # Build per-rule join-key indices
        indices: Dict[Tuple[str, str], List[Finding]] = {}
        for rule in self._rules:
            for row in rows:
                if row.entity_kind not in {rule.lhs, rule.rhs}:
                    continue
                tf = ToolFinding(
                    source_tool=row.source_tool,
                    entity_kind=row.entity_kind,
                    entity_value=row.entity_value,
                    attributes=row.attributes or {},
                )
                key = rule.join_key(tf)
                indices.setdefault((rule.name, key), []).append(row)

        new_edges: List[EntityRelationship] = []
        for rule in self._rules:
            for (rule_name, key), group in indices.items():
                if rule_name != rule.name or len(group) < 2:
                    continue
                lhs_rows = [r for r in group if r.entity_kind == rule.lhs]
                rhs_rows = [r for r in group if r.entity_kind == rule.rhs]
                if rule.lhs == rule.rhs:
                    self._merge_attribution(lhs_rows + rhs_rows, rule.name)
                else:
                    for lf in lhs_rows:
                        for rf in rhs_rows:
                            edge = self._emit_edge(rule, lf, rf, key)
                            if edge is not None:
                                new_edges.append(edge)

        # Built-in: two tools seeing the same entity record attribution.
        by_entity: Dict[Tuple[EntityKind, str], List[Finding]] = {}
        for row in rows:
            by_entity.setdefault(
                (row.entity_kind, row.entity_value), []
            ).append(row)
        for (_kind, _value), group in by_entity.items():
            tools: Set[str] = {r.source_tool.value for r in group}
            if len(tools) >= 2:
                self._merge_attribution(group, "cross_tool_observation")

        if new_edges:
            self._db.add_all(new_edges)
        self._db.commit()
        return new_edges, rows

    def snapshot(self) -> GraphSnapshot:
        entities = self._db.query(Entity).all()
        node_finding_count: Dict[uuid.UUID, int] = {}
        for ent in entities:
            n = (
                self._db.query(Finding)
                .filter(
                    Finding.entity_kind == ent.kind,
                    Finding.entity_value == ent.value,
                )
                .count()
            )
            node_finding_count[ent.id] = n

        nodes: List[Dict[str, Any]] = []
        for ent in entities:
            attrs = ent.attributes or {}
            nodes.append(
                {
                    "id": str(ent.id),
                    "kind": ent.kind.value,
                    "value": ent.value,
                    "seen_by": attrs.get("seen_by", []),
                    "rules": attrs.get("rules", []),
                    "attributes": attrs,
                    "first_seen": ent.first_seen.isoformat() if ent.first_seen else None,
                    "last_seen": ent.last_seen.isoformat() if ent.last_seen else None,
                    "finding_count": node_finding_count.get(ent.id, 0),
                }
            )

        edges: List[Dict[str, Any]] = []
        for edge in self._db.query(EntityRelationship).all():
            attrs = edge.attributes or {}
            lhs_tool = attrs.get("lhs_tool")
            rhs_tool = attrs.get("rhs_tool")
            cross_source = bool(
                lhs_tool and rhs_tool and lhs_tool != rhs_tool
            )
            edges.append(
                {
                    "id": str(edge.id),
                    "src": str(edge.src_entity_id),
                    "dst": str(edge.dst_entity_id),
                    "rule": edge.rule,
                    "weight": edge.weight,
                    "join_value": attrs.get("join_value"),
                    "evidence_ids": list(edge.evidence_ids or []),
                    "lhs_tool": lhs_tool,
                    "rhs_tool": rhs_tool,
                    "cross_source": cross_source,
                    "created_at": edge.created_at.isoformat() if edge.created_at else None,
                }
            )
        return GraphSnapshot(nodes=nodes, edges=edges)

    # --- rule application ------------------------------------------------

    def _emit_edge(
        self,
        rule: EdgeRule,
        lhs: Finding,
        rhs: Finding,
        join_value: str,
    ) -> Optional[EntityRelationship]:
        src = self._ensure_entity(lhs.entity_kind, lhs.entity_value)
        dst = self._ensure_entity(rhs.entity_kind, rhs.entity_value)
        if src.id == dst.id:
            return None
        existing = (
            self._db.query(EntityRelationship)
            .filter(
                EntityRelationship.src_entity_id == src.id,
                EntityRelationship.dst_entity_id == dst.id,
                EntityRelationship.rule == rule.name,
            )
            .one_or_none()
        )
        if existing is not None:
            return None
        return EntityRelationship(
            src_entity_id=src.id,
            dst_entity_id=dst.id,
            rule=rule.name,
            weight=rule.weight,
            evidence_ids=[str(lhs.evidence_id), str(rhs.evidence_id)],
            attributes={
                "join_value": join_value,
                "lhs_tool": lhs.source_tool.value,
                "rhs_tool": rhs.source_tool.value,
            },
        )

    def _ensure_entity(self, kind: EntityKind, value: str) -> Entity:
        if _IS_PG:
            from sqlalchemy.dialects.postgresql import insert as pg_insert

            stmt = (
                pg_insert(Entity)
                .values(kind=kind, value=value, attributes={})
                .on_conflict_do_nothing(index_elements=["kind", "value"])
                .returning(Entity.id)
            )
            row = self._db.execute(stmt).fetchone()
            if row is not None:
                return Entity(id=row[0], kind=kind, value=value)
            ent = (
                self._db.query(Entity)
                .filter(Entity.kind == kind, Entity.value == value)
                .one()
            )
            return ent
        ent = (
            self._db.query(Entity)
            .filter(Entity.kind == kind, Entity.value == value)
            .one_or_none()
        )
        if ent is None:
            ent = Entity(kind=kind, value=value, attributes={})
            self._db.add(ent)
            self._db.flush()
        return ent

    def _merge_attribution(self, rows: List[Finding], rule: str) -> None:
        if not rows:
            return
        kind, value = rows[0].entity_kind, rows[0].entity_value
        entity = (
            self._db.query(Entity)
            .filter(Entity.kind == kind, Entity.value == value)
            .one_or_none()
        )
        if entity is None:
            return
        seen_by = set((entity.attributes or {}).get("seen_by", []) or [])
        seen_by |= {r.source_tool.value for r in rows}
        seen_by_rules = set((entity.attributes or {}).get("rules", []) or [])
        seen_by_rules.add(rule)
        entity.attributes = {
            **(entity.attributes or {}),
            "seen_by": sorted(seen_by),
            "rules": sorted(seen_by_rules),
        }
        self._db.flush()
