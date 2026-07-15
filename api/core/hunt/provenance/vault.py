"""Evidence Vault logger.

Writes ``RawPayload`` + ``EvidenceRecord`` atomically and yields a
``LineageToken``. The TSA stamp happens *before* the DB insert so an
outage surfaces immediately (or falls back per ``tsa_required``).
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any, Mapping, Optional

from sqlalchemy.orm import Session

from hunt.models import EvidenceRecord, Finding, RawPayload, SourceTool, EntityKind
from hunt.provenance.hashing import base64_encode, sha256_bytes, verify_payload
from hunt.provenance.tsa import TsaClient, TsaError  # noqa: F401


class LineageError(RuntimeError):
    """Raised when a Finding's evidence cannot be validated."""


@dataclass(frozen=True)
class LineageToken:
    evidence_id: uuid.UUID
    payload_sha256: str
    tsa_authority: Optional[str] = None
    tsa_stamped_at: Optional[str] = None
    tsa_trusted: bool = False

    def as_dict(self) -> dict:
        return {
            "evidence_id": str(self.evidence_id),
            "payload_sha256": self.payload_sha256,
            "tsa_authority": self.tsa_authority,
            "tsa_stamped_at": self.tsa_stamped_at,
            "tsa_trusted": self.tsa_trusted,
        }


class EvidenceVaultLogger:
    def __init__(self, db: Session, tsa: TsaClient):
        self._db = db
        self._tsa = tsa

    def log(
        self,
        source_tool: SourceTool,
        query_params: Mapping[str, Any],
        raw_bytes: bytes,
        content_type: Optional[str] = None,
    ) -> LineageToken:
        if not raw_bytes:
            raise LineageError("Refusing to log an empty payload")
        digest = sha256_bytes(raw_bytes)
        tsa_token = self._tsa.stamp(digest)

        payload = self._get_or_create_payload(digest, raw_bytes, content_type)
        record = EvidenceRecord(
            source_tool=source_tool,
            query_params=dict(query_params),
            payload_sha256=digest,
            tsa_token_b64=tsa_token.token_b64 or None,
            tsa_authority=tsa_token.authority,
            tsa_stamped_at=tsa_token.stamped_at,
            tsa_trusted=1 if tsa_token.trusted else 0,
        )
        self._db.add(record)
        try:
            self._db.commit()
        except Exception:
            self._db.rollback()
            raise
        self._db.refresh(record)
        return LineageToken(
            evidence_id=record.id,
            payload_sha256=digest,
            tsa_authority=tsa_token.authority,
            tsa_stamped_at=tsa_token.stamped_at.isoformat() if tsa_token.stamped_at else None,
            tsa_trusted=tsa_token.trusted,
        )

    def validate_lineage(self, evidence_id: uuid.UUID) -> EvidenceRecord:
        record: Optional[EvidenceRecord] = (
            self._db.query(EvidenceRecord)
            .filter(EvidenceRecord.id == evidence_id)
            .one_or_none()
        )
        if record is None:
            raise LineageError(f"No evidence record {evidence_id}")
        payload: Optional[RawPayload] = (
            self._db.query(RawPayload)
            .filter(RawPayload.sha256 == record.payload_sha256)
            .one_or_none()
        )
        if payload is None:
            raise LineageError(
                f"Evidence {evidence_id} references missing payload "
                f"{record.payload_sha256}"
            )
        from hunt.provenance.hashing import base64_decode

        if not verify_payload(base64_decode(payload.content_b64), record.payload_sha256):
            raise LineageError(
                f"Evidence {evidence_id} payload hash mismatch — possible tampering"
            )
        return record

    def attach_finding(
        self,
        lineage: LineageToken,
        source_tool: SourceTool,
        entity_kind: EntityKind,
        entity_value: str,
        attributes: Mapping[str, Any],
    ) -> Finding:
        finding = Finding(
            evidence_id=lineage.evidence_id,
            source_tool=source_tool,
            entity_kind=entity_kind,
            entity_value=entity_value,
            attributes=dict(attributes),
        )
        self._db.add(finding)
        self._db.commit()
        self._db.refresh(finding)
        return finding

    def _get_or_create_payload(
        self, digest: str, raw_bytes: bytes, content_type: Optional[str]
    ) -> RawPayload:
        existing: Optional[RawPayload] = (
            self._db.query(RawPayload)
            .filter(RawPayload.sha256 == digest)
            .one_or_none()
        )
        if existing is not None:
            return existing
        payload = RawPayload(
            sha256=digest,
            content_b64=base64_encode(raw_bytes),
            byte_length=len(raw_bytes),
            content_type=content_type,
        )
        self._db.add(payload)
        try:
            self._db.flush()
        except Exception:
            self._db.rollback()
            raise
        return payload
