"""Tool registry — single source of truth for the catalogue and
runtime instantiation.

Defines every tool the dashboard can see, in one place. Each entry
declares whether the tool needs an API key. The ``all_tools()``
factory is the only thing ``main.py`` calls to build a hunt; it
filters out key-required tools whose env var is not set.
"""
from __future__ import annotations

import logging
from typing import Dict, List, Type

from sqlalchemy.orm import Session

from hunt.config import get_settings
from hunt.ingestion.base import ToolFunction
from hunt.ingestion.tools import (
    DnsTool,
    WhoisTool,
    CrtshTool,
    WaybackTool,
    FactCheckTool,
    IpinfoTool,
    ShodanStub,
    VirusTotalStub,
    HibpStub,
    GreyNoiseStub,
    SecurityTrailsStub,
    MaltegoStub,
)
from hunt.models import SourceTool
from hunt.specialized.india import (
    IndianKanoonTool,
    ECourtsTool,
    TafcopTool,
    MyNetaAdrTool,
)

log = logging.getLogger(__name__)


# Single ordered list of (key, class). Order = display order in the UI.
TOOL_CATALOGUE: List[Type[ToolFunction]] = [
    # --- Free, no-key tools (work out of the box) ---
    DnsTool,
    WhoisTool,
    CrtshTool,
    WaybackTool,
    IpinfoTool,
    IndianKanoonTool,
    ECourtsTool,
    TafcopTool,
    MyNetaAdrTool,
    FactCheckTool,
    # --- Key-required tools (shown as 'key required' until env var is set) ---
    ShodanStub,
    VirusTotalStub,
    HibpStub,
    GreyNoiseStub,
    SecurityTrailsStub,
    MaltegoStub,
]


def _key_for(tool: Type[ToolFunction]) -> str:
    """Map a tool class to the env var that enables it (if key_required)."""
    return {
        "shodan": "shodan_api_key",
        "virustotal": "virustotal_api_key",
        "hibp": "hibp_api_key",
        "greynoise": "greynoise_api_key",
        "securitytrails": "securitytrails_api_key",
        "maltego": "maltego_api_key",
        "factcheck": "factchecktools_api_key",
    }.get(tool.name.value, "")


def available_tools(db: Session) -> List[ToolFunction]:
    """Instantiate the tools that are usable for this deployment.

    Key-required tools whose env var is not set are *skipped* (not
    included). The frontend still shows them in the catalogue, with a
    'key required' chip, so the operator knows what to configure.
    """
    settings = get_settings()
    out: List[ToolFunction] = []
    for cls in TOOL_CATALOGUE:
        env_name = _key_for(cls)
        if cls.key_required and not getattr(settings, env_name, None):
            continue
        try:
            out.append(cls(db))
        except Exception as exc:  # noqa: BLE001
            log.warning("Tool %s failed to instantiate: %s", cls.name, exc)
    return out


def catalogue_metadata() -> List[Dict[str, object]]:
    """The static catalogue the dashboard renders. No DB, no instantiation."""
    settings = get_settings()
    out: List[Dict[str, object]] = []
    for cls in TOOL_CATALOGUE:
        env_name = _key_for(cls)
        key_present = bool(getattr(settings, env_name, None)) if env_name else True
        out.append(
            {
                "name": cls.name.value,
                "accepts": sorted(cls.accepts),
                "emits": sorted(k.value for k in cls.emits),
                "key_required": cls.key_required,
                "key_present": key_present,
                "docs_url": cls.docs_url,
                "description": cls.description,
            }
        )
    return out


def tool_by_name(db: Session, name: str) -> ToolFunction:
    """Look up a single tool class by its enum value, instantiate it."""
    target = SourceTool(name)
    for cls in TOOL_CATALOGUE:
        if cls.name == target:
            return cls(db)
    raise KeyError(f"unknown tool: {name}")
