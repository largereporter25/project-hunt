"""Shared test fixtures.

We point the app at an in-memory SQLite via DATABASE_URL before the
modules are imported, and stub the TSA client with `LocalTsaClient` so
the suite has no Postgres or RFC 3161 dependency.
"""
from __future__ import annotations

import os
import sys

import pytest

# Make ``hunt`` importable. The HUNT package lives at ``api/core/hunt``
# in the Vercel monorepo; we add ``api/core`` to ``sys.path`` so the
# existing ``from hunt.config import ...`` imports keep working.
_PKG_PARENT = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "api", "core"
)
_PKG_PARENT = os.path.normpath(_PKG_PARENT)
if _PKG_PARENT not in sys.path:
    sys.path.insert(0, _PKG_PARENT)


# Configure env BEFORE the app code reads it.
os.environ.setdefault("TSA_URLS", "https://freetsa.org/tsr")
os.environ.setdefault("TSA_REQUIRED", "false")
os.environ.setdefault("TSA_TIMEOUT_SECONDS", "0.5")
os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")


@pytest.fixture()
def sqlite_db(monkeypatch):
    """A fresh in-memory SQLite engine, with the schema applied.

    Returns a ``SessionTesting`` factory bound to that engine; each
    test starts from an empty schema, so tests don't see each other's
    data. Also patches ``hunt.db.get_sync_engine`` so the app's
    internal SQLAlchemy engine points at the same in-memory DB.
    """
    import hunt.db as hunt_db
    from sqlalchemy import create_engine
    from sqlalchemy.pool import StaticPool
    from sqlalchemy.orm import sessionmaker

    from hunt.models import Base

    # StaticPool + a single connection so all sessions see the same
    # in-memory database (default per-connection isolation would give
    # each session a fresh empty DB).
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        future=True,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    SessionTesting = sessionmaker(
        bind=engine, autoflush=False, expire_on_commit=False, future=True
    )

    # Make the app's global engine point at this test engine.
    monkeypatch.setattr(hunt_db, "_sync_engine", engine, raising=False)
    monkeypatch.setattr(hunt_db, "_SessionLocal", SessionTesting, raising=False)
    return SessionTesting


@pytest.fixture()
def stub_tsa():
    """A `LocalTsaClient` configured for fast, non-trusted stamping."""
    from hunt.provenance.tsa import LocalTsaClient

    return LocalTsaClient(label="test")
