"""SQLAlchemy engine factory + session helpers.

Single sync engine — no async. The FastAPI handler is fully
synchronous end-to-end; this keeps deployment simple (Vercel serverless
functions don't need an asyncio event loop) and side-steps asyncpg
cold-start timeouts.

Schema is created with ``Base.metadata.create_all`` on first use
(idempotent). For Postgres in production, set ``DATABASE_URL`` to a
``postgresql+psycopg2://…`` connection string.
"""
from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator, Optional

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from hunt.config import get_settings

_settings = get_settings()
_is_pg = _settings.database_url.startswith(("postgres", "postgresql"))

# --- Sync engine ----------------------------------------------------------


_sync_engine: Optional[Engine] = None
_SessionLocal: Optional[sessionmaker] = None


def _build_sync_engine() -> Engine:
    kwargs: dict = {"future": True}
    if _is_pg:
        kwargs.update(
            pool_pre_ping=True,
            pool_size=2,
            max_overflow=4,
            pool_recycle=180,
        )
    else:
        # SQLite: enforce FKs + allow multi-threaded access under
        # FastAPI's thread pool.
        kwargs["connect_args"] = {"check_same_thread": False}
    return create_engine(_settings.database_url, **kwargs)


def get_sync_engine() -> Engine:
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


# Backwards-compatible aliases used by older code.
engine: Engine = get_sync_engine()
SessionLocal = get_session_factory()


def _enable_sqlite_fk(engine: Engine) -> None:
    """Ensure SQLite enforces foreign keys (off by default)."""
    if not _is_pg:
        @event.listens_for(engine, "connect")
        def _on_connect(dbapi_connection, _):  # noqa: ANN001
            cur = dbapi_connection.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.close()


_enable_sqlite_fk(get_sync_engine())


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
