"""Project HUNT — ingestion package.

Ingestion is the layer that talks to external OSINT services. Every tool
implements `ToolFunction.run(query) -> list[Finding]`. The base class
takes care of provenance automatically — the tool code never has to
remember to hash the response.
"""
from hunt.ingestion.base import Finding, StubTool, ToolFunction
from hunt.ingestion.registry import (
    available_tools,
    catalogue_metadata,
    tool_by_name,
)
from hunt.ingestion.runner import ParallelRunner, run_investigation

__all__ = [
    "Finding",
    "StubTool",
    "ToolFunction",
    "ParallelRunner",
    "run_investigation",
    "available_tools",
    "catalogue_metadata",
    "tool_by_name",
]
