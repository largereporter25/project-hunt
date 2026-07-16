"""SQLAlchemy engine factory + session helpers.

Single sync engine — no async. The FastAPI handler is fully
synchronous end-to-end; this keeps deployment simple (Vercel serverless
functions don't need an asyncio event loop) and side-steps asyncpg
cold-start timeouts.

Schema is created with ``Base.metadata.create_all`` on first use
(idempotent).

Deployment matrix
-----------------

* **Local dev** (``VERCEL`` unset): SQLite file next to the script
  (``./hunt.db``). No setup, easy to wipe, perfect for hacking.
* **Vercel** (``VERCEL=1``): SQLite is unusable — the runtime has no
  writable filesystem and each cold start gets a fresh ``/tmp`` that
  is *not* shared with the next invocation. We therefore **require**
  ``DATABASE_URL`` to point at a hosted Postgres (Neon, Supabase,
  Vercel Postgres, etc). The lifespan startup fails fast with a 503
  if the env var is missing or doesn't look like Postgres — a silent
  "modules load but everything's empty" deployment is worse than an
  honest refusal.
"""
from __future__ import annotations

import logging
import os
from contextlib import contextmanager
from typing import Iterator, Optional

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from hunt.config import get_settings

log = logging.getLogger(__name__)


class DatabaseNotConfigured(RuntimeError):
    """Raised at startup when Vercel is running but DATABASE_URL is unset."""


# --- env detection --------------------------------------------------------


_settings = get_settings()
_vercel = bool(os.environ.get("VERCEL") or os.environ.get("VERCEL_ENV"))
_is_pg = _settings.database_url.startswith(("postgres", "postgresql"))


def _validate_database_url() -> str:
    """For Vercel, refuse anything that isn't a Postgres URL.

    Returns the validated URL on success, raises DatabaseNotConfigured
    with a human-readable message on failure.
    """
    url = _settings.database_url
    if _vercel and not url.startswith(("postgres", "postgresql")):
        raise DatabaseNotConfigured(
            "Project HUNT on Vercel requires DATABASE_URL to point at a "
            "Postgres database. Set it in the Vercel project's Environment "
            "Variables to a postgresql:// or postgresql+psycopg2:// URL from "
            "Neon, Supabase, or Vercel Postgres. SQLite cannot persist "
            "across serverless invocations."
        )
    if not url:
        raise DatabaseNotConfigured("DATABASE_URL is empty")
    return url


# --- Sync engine ----------------------------------------------------------


_sync_engine: Optional[Engine] = None
_SessionLocal: Optional[sessionmaker] = None


def _build_sync_engine() -> Engine:
    url = _validate_database_url()
    kwargs: dict = {"future": True}
    is_pg = url.startswith(("postgres", "postgresql"))
    if is_pg:
        # Vercel Postgres connections die after ~30s idle; pool_pre_ping
        # and a small pool keep cold-starts cheap.
        kwargs.update(
            pool_pre_ping=True,
            pool_size=2,
            max_overflow=2,
            pool_recycle=120,
        )
    else:
        # SQLite: enforce FKs + allow multi-threaded access under
        # FastAPI's thread pool. The FK pragma is per-connection so
        # we register a listener on the engine right after creation.
        kwargs["connect_args"] = {"check_same_thread": False}
    log.info(
        "DB engine: dialect=%s vercel=%s",
        "postgres" if is_pg else "sqlite",
        _vercel,
    )
    eng = create_engine(url, **kwargs)
    if not is_pg:
        @event.listens_for(eng, "connect")
        def _on_connect(dbapi_connection, _):  # noqa: ANN001
            cur = dbapi_connection.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.close()
    return eng


def get_sync_engine() -> Engine:
    """Return (or build) the singleton sync engine.

    On Vercel without ``DATABASE_URL`` this raises DatabaseNotConfigured.
    Callers (the FastAPI lifespan) should translate that to a 503
    response so the operator sees the problem instead of a stack trace.
    """
    global _sync_engine
    if _sync_engine is None:
        _sync_engine = _build_sync_engine()
    return _sync_engine


def get_session_factory() -> sessionmaker:
    global _SessionLocal
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(
            bind=get_sync_engine(),
            autoflush=False,
            autocommit=False,
            future=True,
        )
    return _SessionLocal


# Backwards-compatible aliases used by older code. Built lazily so
# importing this module never fails — the error only surfaces when
# the engine is actually requested.
def _lazy_engine() -> Engine:
    return get_sync_engine()


def _lazy_factory() -> sessionmaker:
    return get_session_factory()


# The legacy names — created on first access. Tests and tools that do
# ``from hunt.db import engine, SessionLocal`` at import time would
# otherwise explode on a misconfigured Vercel deploy.
class _LazyProxy:
    def __getattr__(self, name):
        return getattr(_lazy_engine(), name)


class _LazyFactoryProxy:
    def __getattr__(self, name):
        return getattr(_lazy_factory(), name)


engine = _LazyProxy()
SessionLocal = _LazyFactoryProxy()


def _enable_sqlite_fk_unused(_engine: Engine) -> None:  # pragma: no cover
    """Retained for backward-compat with any external code that imports it.

    The FK pragma is now installed inside ``_build_sync_engine`` for
    SQLite, so this function is a no-op. Defined (rather than removed)
    so a stray ``from hunt.db import _enable_sqlite_fk`` keeps working.
    """
    return None


# --- FastAPI dependency ---------------------------------------------------


def get_db() -> Iterator[Session]:
    """FastAPI dependency yielding a sync session."""
    factory = get_session_factory()
    db = factory()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    """Context manager for use outside the FastAPI request lifecycle."""
    factory = get_session_factory()
    db = factory()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
