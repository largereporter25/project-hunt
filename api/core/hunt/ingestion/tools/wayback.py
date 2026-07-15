"""Wayback Machine CDX API.

Lists every archived snapshot of a domain. No API key.
"""
from __future__ import annotations

import json
from typing import Any, List, Mapping

import httpx

from hunt.ingestion.base import Finding, ToolFunction
from hunt.models import EntityKind, SourceTool


class WaybackTool(ToolFunction):
    name = SourceTool.WAYBACK_CDX
    accepts = {"domain", "url"}
    emits = {EntityKind.URL}
    description = "Archive.org Wayback CDX — historic URL snapshots."
    docs_url = "https://web.archive.org/cdx/"
    per_request_timeout = 15.0

    URL = "https://web.archive.org/cdx/search/cdx"

    def _fetch(self, query: Mapping[str, Any]) -> httpx.Response:
        target = query["target"].strip().lower()
        match = f"*.{target}" if "." in target else target
        with httpx.Client(timeout=self.per_request_timeout) as client:
            return client.get(
                self.URL,
                params={
                    "url": match,
                    "limit": 100,
                    "output": "json",
                    "fl": "timestamp,original,statuscode,mimetype",
                },
            )

    def _parse(self, raw: bytes, query: Mapping[str, Any]) -> List[Finding]:
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return []
        if not isinstance(data, list) or len(data) < 2:
            return []
        header = data[0]
        findings: List[Finding] = []
        for row in data[1:]:
            entry = dict(zip(header, row))
            url = entry.get("original")
            ts = entry.get("timestamp")
            if not url or not ts:
                continue
            archive_url = f"https://web.archive.org/web/{ts}/{url}"
            findings.append(
                Finding(
                    source_tool=self.name,
                    entity_kind=EntityKind.URL,
                    entity_value=archive_url,
                    attributes={
                        "original": url,
                        "timestamp": ts,
                        "status": entry.get("statuscode"),
                        "mimetype": entry.get("mimetype"),
                    },
                )
            )
        return findings
