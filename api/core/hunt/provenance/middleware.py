"""FastAPI middleware + a callable wrapper for synchronous ingestion.

`ProvenanceMiddleware` protects *every* HTTP request that returns a
non-empty body whose Content-Type starts with `application/`. It refuses
to forward the response downstream unless the body is logged in the
Evidence Vault.

`provenance_wrapper` is the synchronous version for ingestion code: wrap
any tool's `fetch()` and you get a `LineageToken` back, or an exception
that aborts parsing.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Awaitable, Callable, Optional

import httpx
from fastapi import Request, Response
from sqlalchemy.orm import Session
from starlette.middleware.base import BaseHTTPMiddleware

from hunt.config import get_settings
from hunt.db import SessionLocal
from hunt.models import SourceTool
from hunt.provenance.tsa import TsaClient
from hunt.provenance.vault import EvidenceVaultLogger, LineageToken

log = logging.getLogger(__name__)

_HEADER_TOOL = "x-hunt-source-tool"
_HEADER_LINEAGE = "x-hunt-lineage"


def _parse_tool(header: Optional[str]) -> SourceTool:
    if not header:
        # Default for unauthenticated public APIs; the caller can override
        # in the ingestion code.
        return SourceTool.SHODAN
    try:
        return SourceTool(header.lower())
    except ValueError:
        log.warning("Unknown X-Hunt-Source-Tool header: %r — defaulting to SHODAN", header)
        return SourceTool.SHODAN


class ProvenanceMiddleware(BaseHTTPMiddleware):
    """Logs the body of every proxied OSINT response in the Evidence Vault.

    The dashboard can verify any number it shows against the lineage
    header that gets injected into the downstream response.
    """

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        # We only intercept *outbound* proxy calls. The dashboard itself
        # passes through untouched.
        if not request.url.path.startswith("/osint/"):
            return await call_next(request)

        response: Response = await call_next(request)

        try:
            body = await response.body()
        except Exception:  # noqa: BLE001
            return response

        if not body:
            return response

        tool = _parse_tool(request.headers.get(_HEADER_TOOL))
        with SessionLocal() as db:
            try:
                token = EvidenceVaultLogger(db, TsaClient(get_settings())).log(
                    source_tool=tool,
                    query_params={"path": request.url.path, "query": dict(request.query_params)},
                    raw_bytes=body,
                    content_type=response.headers.get("content-type"),
                )
            except Exception as exc:  # noqa: BLE001
                log.error("Failed to log provenance for %s: %s", request.url.path, exc)
                # Hard fail: do not return data that lacks provenance.
                from fastapi.responses import JSONResponse

                return JSONResponse(
                    status_code=502,
                    content={"error": "provenance_failure", "detail": str(exc)},
                )

        response.headers[_HEADER_LINEAGE] = json.dumps(token.as_dict())
        return response


# --- Synchronous wrapper for ingestion code ---------------------------------


def provenance_wrapper(
    db: Session,
    tool: SourceTool,
    query_params: dict,
    fetch: Callable[[], httpx.Response],
) -> tuple[LineageToken, bytes]:
    """Fetch a response and log it in the Evidence Vault before parsing.

    Returns `(lineage, raw_bytes)`. Parse `raw_bytes` yourself — the
    ingestion layer is responsible for turning it into a `Finding`.
    """
    response = fetch()
    response.raise_for_status()
    raw = response.content
    logger = EvidenceVaultLogger(db, TsaClient(get_settings()))
    token = logger.log(
        source_tool=tool,
        query_params=query_params,
        raw_bytes=raw,
        content_type=response.headers.get("content-type"),
    )
    return token, raw
