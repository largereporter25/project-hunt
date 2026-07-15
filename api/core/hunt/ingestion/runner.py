"""Parallel runner — fans a query out to many tools concurrently.

Uses a thread pool. Per-tool failures are caught and turned into
empty finding lists, so one slow/broken upstream cannot poison a
hunt. A global per-run timeout bounds the worst case.
"""
from __future__ import annotations

import concurrent.futures
import logging
from typing import Any, Iterable, List, Mapping, Sequence

from hunt.ingestion.base import Finding, ToolFunction

log = logging.getLogger(__name__)


class ParallelRunner:
    def __init__(self, tools: Sequence[ToolFunction], max_workers: int = 6):
        self._tools = list(tools)
        self._max_workers = max(1, max_workers)

    def run(self, query: Mapping[str, Any]) -> List[Finding]:
        findings: List[Finding] = []
        with concurrent.futures.ThreadPoolExecutor(
            max_workers=self._max_workers,
            thread_name_prefix="hunt-tool",
        ) as ex:
            futures = {
                ex.submit(_safe_run, tool, dict(query)): tool for tool in self._tools
            }
            for fut in concurrent.futures.as_completed(futures, timeout=120):
                tool = futures[fut]
                try:
                    res = fut.result(timeout=30)
                except concurrent.futures.TimeoutError:
                    log.warning("Tool %s timed out", tool.name)
                    continue
                except Exception as exc:  # noqa: BLE001
                    log.warning("Tool %s crashed: %s", tool.name, exc)
                    continue
                findings.extend(res)
        return findings


def _safe_run(tool: ToolFunction, query: Mapping[str, Any]) -> List[Finding]:
    try:
        return tool.run(query)
    except Exception as exc:  # noqa: BLE001
        log.warning("Tool %s failed: %s", tool.name, exc)
        return []


def run_investigation(tools: Sequence[ToolFunction], query: Mapping[str, Any]) -> List[Finding]:
    return ParallelRunner(tools).run(query)
