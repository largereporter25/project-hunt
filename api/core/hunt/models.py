"""SQLAlchemy ORM models.

The Evidence Vault is the root of trust. Every ``Finding`` row
references exactly one ``EvidenceRecord``; the ``RawPayload`` holds
the bytes that were hashed. UI/render code MUST verify the lineage
chain (Finding → EvidenceRecord → RawPayload) before displaying
anything.
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    JSON,
    BigInteger,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    TypeDecorator,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class GUID(TypeDecorator):
    """Platform-independent UUID column.

    Native UUID on Postgres; CHAR(36) on SQLite. Always a `uuid.UUID`
    in Python.
    """

    impl = PG_UUID(as_uuid=True)
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name.startswith("postgres"):
            return dialect.type_descriptor(PG_UUID(as_uuid=True))
        return dialect.type_descriptor(String(36))

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if not isinstance(value, uuid.UUID):
            value = uuid.UUID(str(value))
        if dialect.name.startswith("postgres"):
            return value
        return str(value)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, uuid.UUID):
            return value
        return uuid.UUID(str(value))


class Base(DeclarativeBase):
    pass


# --- Enums ----------------------------------------------------------------


class SourceTool(str, enum.Enum):
    """Canonical list of OSINT sources.

    Add a new entry here when you add a new tool wrapper.
    """

    DNS = "dns"
    WHOIS = "whois"
    CRT_SH = "crt_sh"
    WAYBACK_CDX = "wayback_cdx"
    FACTCHECK = "factcheck"
    IPINFO = "ipinfo"
    SHODAN = "shodan"
    VIRUSTOTAL = "virustotal"
    HIBP = "hibp"
    GREYNOISE = "greynoise"
    SECURITYTRAILS = "securitytrails"
    MALTEGO = "maltego"
    INDIAN_KANOON = "indian_kanoon"
    ECOURTS = "ecourts"
    TAFCOP = "tafcop"
    MYNETA_ADR = "myneta_adr"


class EntityKind(str, enum.Enum):
    DOMAIN = "domain"
    SUBDOMAIN = "subdomain"
    IPV4 = "ipv4"
    IPV6 = "ipv6"
    EMAIL = "email"
    PHONE = "phone"
    USERNAME = "username"
    PERSON = "person"
    ORG = "org"
    CERT = "cert"
    ASN = "asn"
    URL = "url"
    HASH = "hash"
    BREACH = "breach"
    COMPANY_REGISTRATION = "company_registration"
    COURT_CASE = "court_case"
    CLAIM = "claim"


# --- Core provenance tables ----------------------------------------------


class RawPayload(Base):
    """Immutable bytes of an API response, with its SHA-256 hash.

    The hash is the anchor: the EvidenceRecord's ``payload_sha256`` must
    match a row here, and the bytes must reproduce that hash.
    """

    __tablename__ = "raw_payloads"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(), primary_key=True, default=uuid.uuid4
    )
    sha256: Mapped[str] = mapped_column(
        String(64), nullable=False, unique=True, index=True
    )
    content_b64: Mapped[str] = mapped_column(Text, nullable=False)
    byte_length: Mapped[int] = mapped_column(BigInteger, nullable=False)
    content_type: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class EvidenceRecord(Base):
    """The Evidence Vault row. Created for every external tool invocation."""

    __tablename__ = "evidence_vault"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(), primary_key=True, default=uuid.uuid4
    )
    source_tool: Mapped[SourceTool] = mapped_column(
        Enum(SourceTool, name="source_tool"), nullable=False, index=True
    )
    query_params: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    payload_sha256: Mapped[str] = mapped_column(
        String(64), ForeignKey("raw_payloads.sha256"), nullable=False, index=True
    )
    tsa_token_b64: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    tsa_authority: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    tsa_stamped_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    tsa_trusted: Mapped[bool] = mapped_column(
        Integer, nullable=False, default=0
    )
    operator: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    payload: Mapped[RawPayload] = relationship("RawPayload", lazy="joined")
    findings: Mapped[list["Finding"]] = relationship("Finding", back_populates="evidence")


class Finding(Base):
    """A normalized observation derived from a tool response."""

    __tablename__ = "findings"
    __table_args__ = (
        Index(
            "ix_findings_tool_kind_value",
            "source_tool",
            "entity_kind",
            "entity_value",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(), primary_key=True, default=uuid.uuid4
    )
    investigation_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID(), ForeignKey("investigations.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    evidence_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("evidence_vault.id"), nullable=False, index=True
    )
    source_tool: Mapped[SourceTool] = mapped_column(
        Enum(SourceTool, name="source_tool"), nullable=False
    )
    entity_kind: Mapped[EntityKind] = mapped_column(
        Enum(EntityKind, name="entity_kind"), nullable=False
    )
    entity_value: Mapped[str] = mapped_column(String(2048), nullable=False)
    attributes: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    observed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    evidence: Mapped[EvidenceRecord] = relationship(
        "EvidenceRecord", back_populates="findings"
    )


# --- Entity graph --------------------------------------------------------


class Entity(Base):
    """A deduplicated node in the live entity graph."""

    __tablename__ = "entities"
    __table_args__ = (
        UniqueConstraint("kind", "value", name="uq_entity_kind_value"),
        Index("ix_entities_value", "value"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(), primary_key=True, default=uuid.uuid4
    )
    kind: Mapped[EntityKind] = mapped_column(
        Enum(EntityKind, name="entity_kind"), nullable=False
    )
    value: Mapped[str] = mapped_column(String(2048), nullable=False)
    first_seen: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_seen: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    attributes: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)


class EntityRelationship(Base):
    """A directed edge between two entities, with provenance."""

    __tablename__ = "entity_relationships"
    __table_args__ = (
        Index("ix_rel_src", "src_entity_id"),
        Index("ix_rel_dst", "dst_entity_id"),
        UniqueConstraint(
            "src_entity_id", "dst_entity_id", "rule", name="uq_rel_triplet"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(), primary_key=True, default=uuid.uuid4
    )
    src_entity_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("entities.id"), nullable=False
    )
    dst_entity_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("entities.id"), nullable=False
    )
    rule: Mapped[str] = mapped_column(String(128), nullable=False)
    weight: Mapped[float] = mapped_column(Integer, nullable=False, default=1)
    evidence_ids: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    attributes: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


# --- Investigations ------------------------------------------------------


class Investigation(Base):
    """One row per run of the dashboard, used by the Recent sidebar."""

    __tablename__ = "investigations"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(), primary_key=True, default=uuid.uuid4
    )
    target: Mapped[str] = mapped_column(String(2048), nullable=False, index=True)
    kind: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    modules_run: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    modules_skipped: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    finding_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    edge_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
