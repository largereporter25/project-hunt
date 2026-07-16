"""Project HUNT — FastAPI app entrypoint (Vercel-compatible).

The handler exposes a small, versioned set of routes the Next.js
dashboard consumes:

    GET  /healthz                       — liveness probe
    GET  /api/v1/modules                — static tool catalogue
    POST /api/v1/hunt                   — run a single investigation
    GET  /api/v1/investigations         — recent hunts (sidebar)
    GET  /api/v1/investigations/{id}    — full detail of one hunt
    GET  /api/v1/findings               — recent findings (most recent first)
    GET  /api/v1/graph                  — live entity graph (rebuilt from DB)
    GET  /api/v1/vault/{evidence_id}    — Evidence Vault record (incl. raw payload)
    GET  /api/v1/vault                  — recent evidence records
    GET  /api/v1/stats                  — counters for the dashboard
    POST /api/v1/summarize              — optional Gemini-backed pivot hint
    GET  /api/v1/export                 — JSON evidence bundle
"""
from __future__ import annotations

import base64
import json
import logging
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from hunt.config import get_settings
from hunt.correlation import CorrelationEngine, default_rules
from hunt.db import DatabaseNotConfigured, get_db, get_sync_engine
from hunt.ingestion.registry import available_tools, catalogue_metadata
from hunt.ingestion.runner import ParallelRunner
from hunt.models import (
    Base,
    Entity,
    EntityRelationship,
    EvidenceRecord,
    Finding as FindingRow,
    Investigation,
)
from hunt.provenance.hashing import base64_decode, verify_payload
from hunt.provenance.vault import EvidenceVaultLogger, LineageError
from hunt.schemas import (
    ExportBundle,
    FindingView,
    GraphSnapshot as GraphSnapshotSchema,
    HuntRequest,
    HuntResponse,
    InvestigationDetail,
    InvestigationSummary,
    LineageRef,
    ModuleInfo,
    StatsView,
    SummarizeRequest,
    SummarizeResponse,
    VaultDetail,
    VaultSummary,
)

log = logging.getLogger("hunt")
logging.basicConfig(level=get_settings().log_level)


# --- Lifespan -------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Idempotent schema bootstrap. Cheap on every cold start.
    # On Vercel without DATABASE_URL we want a clear 503 with a
    # human-readable message rather than a 500 stack trace.
    try:
        Base.metadata.create_all(bind=get_sync_engine())
    except DatabaseNotConfigured as exc:
        # Persist the message so the exception handler can return
        # it as a JSON body — a stack trace would only confuse the
        # operator who just needs to set the env var.
        app.state.startup_error = str(exc)
        log.error("startup aborted: %s", exc)
        yield
        return
    except Exception as exc:  # noqa: BLE001
        log.warning("schema create_all failed: %s", exc)
    _ = get_settings()
    log.info("HUNT handler initialised; env=%s", get_settings().app_env)
    yield


# --- App factory ----------------------------------------------------------


def create_app() -> FastAPI:
    app = FastAPI(
        title="Project HUNT",
        version="0.2.0",
        description=(
            "Unified OSINT orchestration dashboard with cryptographic provenance."
        ),
        lifespan=lifespan,
    )

    # CORS: the Vercel deployment serves the Next.js frontend from the
    # same origin, but during local dev (Next on :3000, api on :8000)
    # the browser preflight needs to succeed.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
        allow_credentials=False,
    )

    @app.middleware("http")
    async def _check_startup(request, call_next):
        # If the lifespan refused to bring up the database (e.g. Vercel
        # without DATABASE_URL), every request gets a clear 503 with
        # the explanation, instead of a 500 from the get_db() dep.
        err = getattr(app.state, "startup_error", None)
        if err and request.url.path != "/healthz":
            from fastapi.responses import JSONResponse

            return JSONResponse(
                status_code=503,
                content={
                    "error": "database_not_configured",
                    "detail": err,
                },
            )
        return await call_next(request)

    @app.get("/healthz")
    def healthz() -> dict:
        err = getattr(app.state, "startup_error", None)
        if err:
            from fastapi.responses import JSONResponse

            return JSONResponse(
                status_code=503,
                content={
                    "status": "misconfigured",
                    "app": "hunt",
                    "version": "0.2.0",
                    "error": "database_not_configured",
                    "detail": err,
                },
            )
        return {"status": "ok", "app": "hunt", "version": "0.2.0"}

    # -- /api/v1/modules ---------------------------------------------------

    @app.get("/api/v1/modules", response_model=List[ModuleInfo])
    def list_modules() -> List[ModuleInfo]:
        # The catalogue is read straight from the registry. No DB
        # session, no tool instantiation, no upstream calls: this
        # route is impossible to 500 in normal operation. If for
        # any reason the registry comes up empty, the dashboard
        # falls back to its own static catalogue.
        return [ModuleInfo(**row) for row in catalogue_metadata()]

    # -- /api/v1/hunt ------------------------------------------------------

    @app.post("/api/v1/hunt", response_model=HuntResponse)
    def hunt(req: HuntRequest, db: Session = Depends(get_db)) -> HuntResponse:
        t0 = time.perf_counter()
        tools = available_tools(db)

        # Optional: caller can pick a subset by name.
        if req.modules:
            wanted = {m.lower() for m in req.modules}
            tools = [t for t in tools if t.name.value in wanted]
            if not tools:
                raise HTTPException(
                    status_code=400,
                    detail=f"No matching modules for {sorted(wanted)}",
                )
        # Optional: caller can hint a kind and we narrow to accept.
        elif req.kind:
            narrowed = [t for t in tools if req.kind in t.accepts]
            if narrowed:
                tools = narrowed

        # Refine: only run tools whose accepts overlap with the
        # inferred kind when we *can* infer one. We do a light inference
        # from the target shape so a bare domain doesn't spawn the
        # TAFCOP phone tool.
        if not req.modules and not req.kind:
            tools = _tools_for_target(tools, req.target)

        modules_run = [t.name.value for t in tools]
        # Stub tools are filtered into a "skipped" list (they emit
        # a single key-required finding, which we suppress from the
        # response so the dashboard doesn't see them as a 1-finding
        # investigation).
        skipped: List[str] = []
        active_tools = []
        for t in tools:
            if getattr(t, "key_required", False) and not _key_present(t.name.value):
                skipped.append(t.name.value)
                continue
            active_tools.append(t)

        # Create the investigation row up-front so findings can FK to it.
        investigation = Investigation(
            target=req.target,
            kind=req.kind,
            modules_run=modules_run,
            modules_skipped=skipped,
            finding_count=0,
            edge_count=0,
            duration_ms=0,
        )
        db.add(investigation)
        db.commit()
        db.refresh(investigation)

        try:
            findings = ParallelRunner(active_tools).run(
                {"target": req.target, "kind": req.kind or ""}
            )
        except Exception as exc:  # noqa: BLE001
            log.exception("ParallelRunner crashed: %s", exc)
            findings = []

        engine = CorrelationEngine(db, default_rules())
        module_errors: Dict[str, str] = {}
        try:
            new_edges, rows = engine.ingest(findings, investigation_id=investigation.id)
        except Exception as exc:  # noqa: BLE001
            log.exception("Correlation engine failed: %s", exc)
            db.rollback()
            module_errors["correlation"] = str(exc)
            new_edges, rows = [], []

        # Refresh counters on the investigation row.
        investigation.finding_count = len(rows)
        investigation.edge_count = len(new_edges)
        investigation.duration_ms = int((time.perf_counter() - t0) * 1000)
        db.commit()

        return HuntResponse(
            investigation_id=str(investigation.id),
            target=req.target,
            kind=req.kind,
            findings=[FindingView.from_row(r) for r in rows[:500]],
            modules_run=modules_run,
            modules_skipped=skipped,
            module_errors=module_errors,
            duration_ms=investigation.duration_ms,
        )

    # -- /api/v1/investigations ------------------------------------------

    @app.get("/api/v1/investigations", response_model=List[InvestigationSummary])
    def list_investigations(
        limit: int = Query(20, ge=1, le=200),
        db: Session = Depends(get_db),
    ) -> List[InvestigationSummary]:
        rows = (
            db.query(Investigation)
            .order_by(Investigation.created_at.desc())
            .limit(limit)
            .all()
        )
        return [
            InvestigationSummary(
                id=str(r.id),
                target=r.target,
                kind=r.kind,
                finding_count=r.finding_count,
                edge_count=r.edge_count,
                duration_ms=r.duration_ms,
                created_at=r.created_at.isoformat(),
            )
            for r in rows
        ]

    @app.get(
        "/api/v1/investigations/{investigation_id}",
        response_model=InvestigationDetail,
    )
    def get_investigation(
        investigation_id: str,
        db: Session = Depends(get_db),
    ) -> InvestigationDetail:
        try:
            token_uuid = uuid.UUID(investigation_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        inv = (
            db.query(Investigation)
            .filter(Investigation.id == token_uuid)
            .one_or_none()
        )
        if inv is None:
            raise HTTPException(status_code=404, detail="Investigation not found")
        findings = (
            db.query(FindingRow)
            .filter(FindingRow.investigation_id == token_uuid)
            .order_by(FindingRow.observed_at.desc())
            .all()
        )
        return InvestigationDetail(
            id=str(inv.id),
            target=inv.target,
            kind=inv.kind,
            modules_run=inv.modules_run or [],
            modules_skipped=inv.modules_skipped or [],
            finding_count=inv.finding_count,
            edge_count=inv.edge_count,
            duration_ms=inv.duration_ms,
            created_at=inv.created_at.isoformat(),
            findings=[FindingView.from_row(f) for f in findings],
        )

    # -- /api/v1/findings --------------------------------------------------

    @app.get("/api/v1/findings", response_model=List[FindingView])
    def findings(
        limit: int = Query(500, ge=1, le=5000),
        db: Session = Depends(get_db),
    ) -> List[FindingView]:
        rows = (
            db.query(FindingRow)
            .order_by(FindingRow.observed_at.desc())
            .limit(limit)
            .all()
        )
        return [FindingView.from_row(r) for r in rows]

    # -- /api/v1/graph -----------------------------------------------------

    @app.get("/api/v1/graph", response_model=GraphSnapshotSchema)
    def graph(db: Session = Depends(get_db)) -> GraphSnapshotSchema:
        snap = CorrelationEngine(db, default_rules()).snapshot()
        return GraphSnapshotSchema(**snap.as_dict())

    # -- /api/v1/vault -----------------------------------------------------

    @app.get("/api/v1/vault", response_model=List[VaultSummary])
    def vault_recent(
        limit: int = Query(100, ge=1, le=1000),
        db: Session = Depends(get_db),
    ) -> List[VaultSummary]:
        rows = (
            db.query(EvidenceRecord)
            .order_by(EvidenceRecord.created_at.desc())
            .limit(limit)
            .all()
        )
        return [
            VaultSummary(
                id=str(r.id),
                source_tool=r.source_tool.value,
                query_params=r.query_params or {},
                payload_sha256=r.payload_sha256,
                tsa_authority=r.tsa_authority,
                tsa_stamped_at=(
                    r.tsa_stamped_at.isoformat() if r.tsa_stamped_at else None
                ),
                tsa_trusted=bool(r.tsa_trusted),
                created_at=r.created_at.isoformat(),
            )
            for r in rows
        ]

    @app.get("/api/v1/vault/{evidence_id}", response_model=VaultDetail)
    def vault_record(
        evidence_id: str,
        include_payload: bool = Query(False),
        db: Session = Depends(get_db),
    ) -> VaultDetail:
        try:
            token_uuid = uuid.UUID(evidence_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        try:
            record = EvidenceVaultLogger(db, _NoTsa()).validate_lineage(token_uuid)
        except LineageError as exc:
            raise HTTPException(status_code=404, detail=str(exc))

        body = VaultDetail(
            id=str(record.id),
            source_tool=record.source_tool.value,
            query_params=record.query_params or {},
            payload_sha256=record.payload_sha256,
            tsa_authority=record.tsa_authority,
            tsa_stamped_at=(
                record.tsa_stamped_at.isoformat() if record.tsa_stamped_at else None
            ),
            tsa_trusted=bool(record.tsa_trusted),
            created_at=record.created_at.isoformat(),
            lineage_valid=True,
            data_bleed_flags=[],
        )

        if include_payload and record.payload is not None:
            try:
                raw = base64_decode(record.payload.content_b64)
            except Exception:  # noqa: BLE001
                raw = b""
            try:
                body.raw_payload = json.loads(raw.decode("utf-8"))
            except Exception:  # noqa: BLE001
                body.raw_payload_text = raw.decode("utf-8", errors="replace")
            body.byte_length = record.payload.byte_length
            body.content_type = record.payload.content_type
            if not verify_payload(raw, record.payload_sha256):
                body.data_bleed_flags.append(
                    {
                        "code": "PAYLOAD_HASH_MISMATCH",
                        "severity": "critical",
                        "detail": "Decoded payload no longer matches its stored SHA-256.",
                    }
                )
                body.lineage_valid = False
        return body

    # -- /api/v1/stats -----------------------------------------------------

    @app.get("/api/v1/stats", response_model=StatsView)
    def stats(db: Session = Depends(get_db)) -> StatsView:
        return StatsView(
            investigation_count=db.query(Investigation).count(),
            evidence_count=db.query(EvidenceRecord).count(),
            finding_count=db.query(FindingRow).count(),
            edge_count=db.query(EntityRelationship).count(),
            entity_count=db.query(Entity).count(),
        )

    # -- /api/v1/summarize -------------------------------------------------
    #
    # Optional Gemini pivot hint. Without a key (or on upstream failure)
    # we return a deterministic fallback so the UI never blows up.

    @app.post("/api/v1/summarize", response_model=SummarizeResponse)
    def summarize(req: SummarizeRequest) -> SummarizeResponse:
        settings = get_settings()
        if not settings.gemini_api_key:
            return _deterministic_fallback(req)

        findings_blob = "\n".join(
            f"- {f.entity_kind}:{f.entity_value}  (tool={f.source_tool}, "
            f"sha={f.lineage.payload_sha256[:12]})"
            for f in req.findings[:40]
        )
        prompt = (
            "You are an OSINT analyst.\n"
            f"Target: {req.target}\n"
            "Findings (entity:value, source tool, sha256 prefix):\n"
            f"{findings_blob}\n\n"
            f"Question: {req.question or 'Summarise the strongest pivots and the cross-source corroborations.'}\n"
            "Answer in 6 short bullet points. Cite each bullet with the "
            "tool and the sha256 prefix it came from."
        )
        try:
            import httpx

            r = httpx.post(
                "https://generativelanguage.googleapis.com/v1beta/models/"
                "gemini-1.5-flash:generateContent",
                params={"key": settings.gemini_api_key},
                json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {
                        "temperature": 0.2,
                        "maxOutputTokens": 600,
                    },
                },
                timeout=20.0,
            )
            r.raise_for_status()
            data = r.json()
            text = (
                data.get("candidates", [{}])[0]
                .get("content", {})
                .get("parts", [{}])[0]
                .get("text", "")
            )
            return SummarizeResponse(
                summary=text.strip() or "(empty response)",
                model="gemini-1.5-flash",
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("Gemini summarization failed: %s", exc)
            return _deterministic_fallback(req)

    # -- /api/v1/export ----------------------------------------------------

    @app.get("/api/v1/export", response_model=ExportBundle)
    def export(
        investigation_id: Optional[str] = Query(None),
        db: Session = Depends(get_db),
    ) -> ExportBundle:
        snap = CorrelationEngine(db, default_rules()).snapshot()
        body = ExportBundle(
            exported_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            graph=GraphSnapshotSchema(**snap.as_dict()),
            stats=StatsView(
                investigation_count=db.query(Investigation).count(),
                evidence_count=db.query(EvidenceRecord).count(),
                finding_count=db.query(FindingRow).count(),
                edge_count=db.query(EntityRelationship).count(),
                entity_count=db.query(Entity).count(),
            ),
        )
        if investigation_id:
            try:
                token_uuid = uuid.UUID(investigation_id)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc))
            inv = (
                db.query(Investigation)
                .filter(Investigation.id == token_uuid)
                .one_or_none()
            )
            if inv is None:
                raise HTTPException(status_code=404, detail="Investigation not found")
            body.investigation = InvestigationSummary(
                id=str(inv.id),
                target=inv.target,
                kind=inv.kind,
                finding_count=inv.finding_count,
                edge_count=inv.edge_count,
                duration_ms=inv.duration_ms,
                created_at=inv.created_at.isoformat(),
            )
            findings = (
                db.query(FindingRow)
                .filter(FindingRow.investigation_id == token_uuid)
                .all()
            )
            body.findings = [FindingView.from_row(f) for f in findings]
        else:
            rows = (
                db.query(FindingRow)
                .order_by(FindingRow.observed_at.desc())
                .limit(2000)
                .all()
            )
            body.findings = [FindingView.from_row(f) for f in rows]
        return body

    return app


# --- helpers --------------------------------------------------------------


def _key_present(tool_name: str) -> bool:
    """Whether the env var for a key-required tool is set."""
    s = get_settings()
    return {
        "shodan": bool(s.shodan_api_key),
        "virustotal": bool(s.virustotal_api_key),
        "hibp": bool(s.hibp_api_key),
        "greynoise": bool(s.greynoise_api_key),
        "securitytrails": bool(s.securitytrails_api_key),
        "maltego": bool(s.maltego_api_key),
        "factcheck": bool(s.factchecktools_api_key),
    }.get(tool_name, True)


def _tools_for_target(tools: List[Any], target: str) -> List[Any]:
    """Best-effort narrowing of tools to the inferred kind."""
    t = target.strip()
    if not t:
        return tools
    if "@" in t:
        kind = "email"
    elif _looks_like_ipv4(t) or _looks_like_ipv6(t):
        kind = "ipv4" if _looks_like_ipv4(t) else "ipv6"
    elif t.lower().startswith("http://") or t.lower().startswith("https://"):
        kind = "url"
    elif t.replace("+", "").isdigit() and 7 <= len(t) <= 15:
        kind = "phone"
    elif "." in t and " " not in t and "/" not in t:
        kind = "domain"
    else:
        kind = "person"
    return [tool for tool in tools if kind in tool.accepts]


def _looks_like_ipv4(s: str) -> bool:
    parts = s.split(".")
    if len(parts) != 4:
        return False
    return all(p.isdigit() and 0 <= int(p) <= 255 for p in parts)


def _looks_like_ipv6(s: str) -> bool:
    return ":" in s and "." in s or (s.count(":") >= 2 and all(
        c in "0123456789abcdefABCDEF:" for c in s
    ))


def _deterministic_fallback(req: SummarizeRequest) -> SummarizeResponse:
    by_tool: Dict[str, int] = {}
    for f in req.findings:
        by_tool[f.source_tool] = by_tool.get(f.source_tool, 0) + 1
    bullets = [
        f"- target={req.target}, {len(req.findings)} findings, "
        f"{len(by_tool)} distinct tools",
    ]
    for tool, count in sorted(by_tool.items(), key=lambda x: -x[1]):
        bullets.append(f"- {tool}: {count} findings")
    return SummarizeResponse(
        summary="\n".join(bullets),
        model="deterministic-fallback",
    )


class _NoTsa:
    """TSA shim that just stamps locally — used by the read-only /vault
    endpoint to avoid hitting a TSA at all when the row already has one."""

    def stamp(self, digest: str):  # noqa: D401
        from hunt.provenance.tsa import TsaStamp

        return TsaStamp(token_b64=None, authority=None, stamped_at=None, trusted=False)


# Vercel's @vercel/python runtime imports a module-level ``app``.
app = create_app()
