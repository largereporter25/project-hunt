"""Centralized settings for Project HUNT.

Every secret is optional — the app boots and serves traffic with no
configuration at all. Setting an env var unlocks a feature. This makes
the app safe to deploy on Vercel without leaking any keys to the
public repo.

All env vars are read from the process environment; on Vercel they are
configured via the project dashboard. Locally, a developer can copy
``.env.example`` to ``.env`` and fill in only the keys they want to
test.
"""
from __future__ import annotations

from functools import lru_cache
from typing import List, Optional

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Database. SQLite is the default for local dev; Postgres is
    # REQUIRED for the Vercel deployment (Vercel serverless functions
    # have no writable filesystem, so SQLite would lose all data
    # between invocations). Vercel Postgres, Neon, and Supabase all
    # expose ``postgresql+psycopg2://`` URLs.
    database_url: str = "sqlite+pysqlite:///./hunt.db"

    # ``VERCEL`` is set by the Vercel runtime. We branch on it in
    # ``db.py`` to refuse to start without ``DATABASE_URL`` (a silent
    # "in-memory SQLite per request" deployment would be a footgun:
    # everything looks empty after a cold start).
    @property
    def vercel(self) -> bool:  # noqa: D401
        import os

        return bool(os.environ.get("VERCEL")) or bool(
            os.environ.get("VERCEL_ENV")
        )

    # App
    app_env: str = "dev"
    log_level: str = "INFO"

    # ---- OSINT provider keys (ALL OPTIONAL) ----------------------------
    # Each key enables a specific tool. Missing key → tool gracefully
    # reports "key required" and returns no findings; it never 500s.
    shodan_api_key: Optional[str] = None
    hibp_api_key: Optional[str] = None
    virustotal_api_key: Optional[str] = None
    greynoise_api_key: Optional[str] = None
    securitytrails_api_key: Optional[str] = None
    ipinfo_api_key: Optional[str] = None
    maltego_api_key: Optional[str] = None
    factchecktools_api_key: Optional[str] = None
    gemini_api_key: Optional[str] = None

    # RFC 3161 trusted timestamping. The default is freetsa.org; if it
    # is unreachable, the Evidence Vault falls back to a local-clock
    # stamp and records ``trusted=False``. This is fine for dev; for
    # production, set ``tsa_required=true`` to refuse non-trusted
    # stamps.
    tsa_urls: str = "https://freetsa.org/tsr"
    tsa_required: bool = False
    # Per-TSA hard timeout in seconds. FreeTSAs can hang for 10s+;
    # 3s is a sensible production default.
    tsa_timeout_seconds: float = 3.0

    # Correlation toggles — these are knobs an operator can flip.
    correlation_email_match: bool = True
    correlation_domain_cert: bool = True
    correlation_ip_asn: bool = True

    @field_validator("tsa_urls")
    @classmethod
    def _strip_urls(cls, v: str) -> str:
        return v.strip()


def tsa_chain(settings: Settings) -> List[str]:
    return [u.strip() for u in settings.tsa_urls.split(",") if u.strip()]


def is_postgres(settings: Optional[Settings] = None) -> bool:
    if settings is None:
        settings = get_settings()
    return settings.database_url.startswith(("postgres", "postgresql"))


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
