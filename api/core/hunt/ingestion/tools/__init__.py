"""OSINT tool implementations.

Each module exports a single ``ToolFunction`` subclass. Working tools
are full implementations; key-required tools are honest ``StubTool``
subclasses that emit a single 'configure API key' finding so the
dashboard can still display them in the catalogue.
"""
from hunt.ingestion.tools.dns import DnsTool
from hunt.ingestion.tools.whois import WhoisTool
from hunt.ingestion.tools.crtsh import CrtshTool
from hunt.ingestion.tools.wayback import WaybackTool
from hunt.ingestion.tools.factcheck import FactCheckTool
from hunt.ingestion.tools.ipinfo import IpinfoTool
from hunt.ingestion.tools.stubs import (
    ShodanStub,
    VirusTotalStub,
    HibpStub,
    GreyNoiseStub,
    SecurityTrailsStub,
    MaltegoStub,
)

__all__ = [
    "DnsTool",
    "WhoisTool",
    "CrtshTool",
    "WaybackTool",
    "FactCheckTool",
    "IpinfoTool",
    "ShodanStub",
    "VirusTotalStub",
    "HibpStub",
    "GreyNoiseStub",
    "SecurityTrailsStub",
    "MaltegoStub",
]
