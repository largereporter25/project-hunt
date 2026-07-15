"""Pydantic request/response models for the FastAPI surface.

Kept separate from ``main.py`` so the route handlers stay readable
and so the schemas can be imported by tests without booting the app.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


def _lineage_from_row(row: Any) -> "LineageRef":
    """Best-effort LineageRef from a Finding ORM row."""
    ev = getattr(row, "evidence", None)
    return LineageRef(
        evidence_id=str(row.evidence_id),
        payload_sha256=(getattr(ev, "payload_sha256", "") or ""),
        tsa_authority=(getattr(ev, "tsa_authority", None) if ev else None),
        tsa_stamped_at=(
            ev.tsa_stamped_at.isoformat() if ev and ev.tsa_stamped_at else None
        ),
        tsa_trusted=bool(getattr(ev, "tsa_trusted", 0) if ev else 0),
    )


# --- Modules --------------------------------------------------------------


class ModuleInfo(BaseModel):
    name: str
    accepts: List[str]
    emits: List[str]
    key_required: bool = False
    docs_url: Optional[str] = None
    description: str = ""


# --- Hunt -----------------------------------------------------------------


class HuntRequest(BaseModel):
    target: str = Field(..., min_length=1, description="Domain, IP, email, phone, …")
    kind: Optional[str] = Field(
        None, description="Optional hint: 'domain', 'ipv4', 'email', …"
    )
    modules: Optional[List[str]] = Field(
        None,
        description="Optional subset of module names to run. "
        "Defaults to every module whose `accepts` matches the inferred kind.",
    )


class LineageRef(BaseModel):
    evidence_id: str
    payload_sha256: str
    tsa_authority: Optional[str] = None
    tsa_stamped_at: Optional[str] = None
    tsa_trusted: bool = False


class FindingView(BaseModel):
    id: str
    source_tool: str
    entity_kind: str
    entity_value: str
    attributes: Dict[str, Any]
    observed_at: Optional[str] = None
    lineage: LineageRef

    @classmethod
    def from_row(cls, row: Any) -> "FindingView":
        return cls(
            id=str(row.id),
            source_tool=row.source_tool.value,
            entity_kind=row.entity_kind.value,
            entity_value=row.entity_value,
            attributes=row.attributes or {},
            observed_at=row.observed_at.isoformat() if row.observed_at else None,
            lineage=_lineage_from_row(row),
        )


class HuntResponse(BaseModel):
    investigation_id: str
    target: str
    kind: Optional[str]
    findings: List[FindingView]
    modules_run: List[str]
    modules_skipped: List[str]
    module_errors: Dict[str, str] = Field(default_factory=dict)
    duration_ms: int


# --- Investigations sidebar ---------------------------------------------


class InvestigationSummary(BaseModel):
    id: str
    target: str
    kind: Optional[str]
    finding_count: int
    edge_count: int
    duration_ms: int
    created_at: str


class InvestigationDetail(BaseModel):
    id: str
    target: str
    kind: Optional[str]
    modules_run: List[str]
    modules_skipped: List[str]
    finding_count: int
    edge_count: int
    duration_ms: int
    created_at: str
    findings: List[FindingView]


# --- Findings / Graph / Vault / Stats ----------------------------------


class ModuleErrorView(BaseModel):
    module: str
    error: str


class GraphNode(BaseModel):
    id: str
    kind: str
    value: str
    seen_by: List[str] = Field(default_factory=list)
    rules: List[str] = Field(default_factory=list)
    first_seen: Optional[str] = None
    last_seen: Optional[str] = None
    finding_count: int = 0


class GraphEdge(BaseModel):
    id: str
    src: str
    dst: str
    rule: str
    weight: int = 1
    join_value: Optional[str] = None
    evidence_ids: List[str] = Field(default_factory=list)
    lhs_tool: Optional[str] = None
    rhs_tool: Optional[str] = None
    cross_source: bool = False
    created_at: Optional[str] = None


class GraphSnapshot(BaseModel):
    nodes: List[GraphNode] = Field(default_factory=list)
    edges: List[GraphEdge] = Field(default_factory=list)
    node_count: int = 0
    edge_count: int = 0


class VaultSummary(BaseModel):
    id: str
    source_tool: str
    query_params: Dict[str, Any]
    payload_sha256: str
    tsa_authority: Optional[str] = None
    tsa_stamped_at: Optional[str] = None
    tsa_trusted: bool = False
    created_at: str


class VaultDetail(VaultSummary):
    raw_payload: Optional[Any] = None
    raw_payload_text: Optional[str] = None
    byte_length: Optional[int] = None
    content_type: Optional[str] = None
    lineage_valid: bool = True
    data_bleed_flags: List[Dict[str, str]] = Field(default_factory=list)


class StatsView(BaseModel):
    investigation_count: int
    evidence_count: int
    finding_count: int
    edge_count: int
    entity_count: int


# --- AI pivot -----------------------------------------------------------


class SummarizeRequest(BaseModel):
    target: str
    findings: List[FindingView] = Field(default_factory=list)
    question: Optional[str] = None


class SummarizeResponse(BaseModel):
    summary: str
    model: str


# --- Export -------------------------------------------------------------


class ExportBundle(BaseModel):
    schema_version: str = "1.0"
    exported_at: str
    investigation: Optional[InvestigationSummary] = None
    findings: List[FindingView] = Field(default_factory=list)
    graph: GraphSnapshot
    stats: StatsView
