"""Tool function abstraction.

A ``ToolFunction`` is the only thing the rest of the system knows
about an external OSINT service. Subclasses declare their name,
``accepts`` kinds, and ``emits`` kinds, and implement ``_fetch`` /
``_parse``.

The base class wires SHA-256 → RFC 3161 → Evidence Vault in front
of ``_parse`` automatically, so implementations can never
accidentally skip provenance. Failures inside ``_fetch`` or
``_parse`` are caught and converted to a single "module error"
finding so one bad upstream cannot poison an entire hunt.
"""
from __future__ import annotations

import abc
import logging
from dataclasses import dataclass, field
from typing import Any, ClassVar, Dict, List, Mapping, Optional, Set

import httpx
from sqlalchemy.orm import Session

from hunt.config import get_settings
from hunt.models import EntityKind, Finding as FindingRow, SourceTool
from hunt.provenance.tsa import TsaClient
from hunt.provenance.vault import EvidenceVaultLogger, LineageToken

log = logging.getLogger(__name__)


@dataclass
class Finding:
    """Normalized observation returned by a ``ToolFunction``."""

    source_tool: SourceTool
    entity_kind: EntityKind
    entity_value: str
    attributes: Dict[str, Any] = field(default_factory=dict)


class ToolFunction(abc.ABC):
    """Base class for every OSINT service wrapper."""

    name: ClassVar[SourceTool]
    accepts: ClassVar[Set[str]] = set()
    emits: ClassVar[Set[EntityKind]] = set()
    key_required: ClassVar[bool] = False
    docs_url: ClassVar[Optional[str]] = None
    description: ClassVar[str] = ""
    per_request_timeout: ClassVar[float] = 8.0

    def __init__(self, db: Session, *, tsa: Optional[TsaClient] = None):
        self._db = db
        self._vault = EvidenceVaultLogger(db, tsa or TsaClient(get_settings()))

    # --- public API -------------------------------------------------------

    def run(self, query: Mapping[str, Any]) -> List[Finding]:
        """Fetch + log provenance + parse. Never raises; returns [] on failure."""
        try:
            token, raw = self._fetch_with_provenance(query)
        except Exception as exc:  # noqa: BLE001
            log.warning("fetch failed for tool=%s query=%s: %s", self.name, query, exc)
            return [
                Finding(
                    source_tool=self.name,
                    entity_kind=EntityKind.DOMAIN,
                    entity_value="",
                    attributes={
                        "module_error": "fetch_failed",
                        "message": str(exc)[:240],
                    },
                )
            ]
        try:
            findings = self._parse(raw, query)
        except Exception as exc:  # noqa: BLE001
            log.warning("parse failed for tool=%s query=%s: %s", self.name, query, exc)
            return [
                Finding(
                    source_tool=self.name,
                    entity_kind=EntityKind.DOMAIN,
                    entity_value="",
                    attributes={
                        "module_error": "parse_failed",
                        "message": str(exc)[:240],
                    },
                )
            ]
        for f in findings:
            f.attributes.setdefault(
                "_hunt_lineage",
                LineageToken(
                    evidence_id=token.evidence_id,
                    payload_sha256=token.payload_sha256,
                    tsa_authority=token.tsa_authority,
                    tsa_stamped_at=token.tsa_stamped_at,
                    tsa_trusted=token.tsa_trusted,
                ),
            )
        return findings

    def commit(self, findings: List[Finding]) -> List[FindingRow]:
        rows: List[FindingRow] = []
        for f in findings:
            lineage: LineageToken = f.attributes.pop("_hunt_lineage", None)  # type: ignore[arg-type]
            if lineage is None:
                continue
            rows.append(
                self._vault.attach_finding(
                    lineage=lineage,
                    source_tool=f.source_tool,
                    entity_kind=f.entity_kind,
                    entity_value=f.entity_value,
                    attributes=f.attributes,
                )
            )
        return rows

    # --- hooks ------------------------------------------------------------

    @abc.abstractmethod
    def _fetch(self, query: Mapping[str, Any]) -> httpx.Response:
        """Perform the HTTP request. Should never raise; return an error response."""

    @abc.abstractmethod
    def _parse(self, raw: bytes, query: Mapping[str, Any]) -> List[Finding]:
        """Turn raw bytes into normalized ``Finding`` objects."""

    # --- internals --------------------------------------------------------

    def _fetch_with_provenance(
        self, query: Mapping[str, Any]
    ) -> tuple[LineageToken, bytes]:
        with httpx.Client(timeout=self.per_request_timeout) as client:
            response = self._fetch(query)
        if response.status_code >= 400:
            raise RuntimeError(
                f"upstream HTTP {response.status_code} for {self.name.value}"
            )
        token = self._vault.log(
            source_tool=self.name,
            query_params=dict(query),
            raw_bytes=response.content,
            content_type=response.headers.get("content-type"),
        )
        return token, response.content


class StubTool(ToolFunction):
    """A tool that returns a single "key required" finding.

    Used for paid / key-required OSINT sources: the dashboard shows
    them in the catalogue with a 'key required' chip, and the tool
    itself emits one entity that documents how to enable it.
    """

    name: ClassVar[SourceTool]
    accepts: ClassVar[Set[str]] = set()
    emits: ClassVar[Set[EntityKind]] = set()
    key_required: ClassVar[bool] = True
    docs_url: ClassVar[Optional[str]] = None
    description: ClassVar[str] = ""

    def _fetch(self, query: Mapping[str, Any]) -> httpx.Response:  # pragma: no cover
        import json
        body = json.dumps(
            {"stub": True, "tool": self.name.value}
        ).encode("utf-8")
        return httpx.Response(200, content=body, headers={"content-type": "application/json"})

    def _parse(self, raw: bytes, query: Mapping[str, Any]) -> List[Finding]:
        return [
            Finding(
                source_tool=self.name,
                entity_kind=EntityKind.DOMAIN,
                entity_value="",
                attributes={
                    "module_error": "key_required",
                    "docs_url": self.docs_url,
                    "description": self.description,
                    "message": (
                        f"{self.name.value} requires an API key. "
                        f"Set the corresponding env var to enable this tool."
                    ),
                },
            )
        ]
