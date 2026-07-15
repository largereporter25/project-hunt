"""crt.sh — certificate transparency log search.

No API key. Returns every certificate ever issued for a domain,
which is gold for subdomain enumeration and pivot-by-cert-fingerprint.
"""
from __future__ import annotations

import json
from typing import Any, List, Mapping

import httpx

from hunt.ingestion.base import Finding, ToolFunction
from hunt.models import EntityKind, SourceTool


class CrtshTool(ToolFunction):
    name = SourceTool.CRT_SH
    accepts = {"domain"}
    emits = {EntityKind.SUBDOMAIN, EntityKind.CERT, EntityKind.ORG}
    description = "Certificate Transparency log search via crt.sh."
    docs_url = "https://crt.sh/"
    per_request_timeout = 20.0

    URL = "https://crt.sh/"

    def _fetch(self, query: Mapping[str, Any]) -> httpx.Response:
        target = query["target"].strip().lower()
        with httpx.Client(timeout=self.per_request_timeout) as client:
            return client.get(
                self.URL,
                params={"q": f"%.{target}", "output": "json"},
            )

    def _parse(self, raw: bytes, query: Mapping[str, Any]) -> List[Finding]:
        try:
            rows = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return []
        if not isinstance(rows, list):
            return []
        findings: List[Finding] = []
        target = query["target"].strip().lower()
        seen_sub: set[str] = set()
        for row in rows[:200]:
            name = (row.get("name_value") or "").strip().lower()
            if not name:
                continue
            for sub in name.split("\n"):
                sub = sub.strip()
                if not sub.endswith(target) and sub != target:
                    continue
                if sub not in seen_sub:
                    seen_sub.add(sub)
                    findings.append(
                        Finding(
                            source_tool=self.name,
                            entity_kind=EntityKind.SUBDOMAIN,
                            entity_value=sub,
                            attributes={"parent_domain": target},
                        )
                    )
            cert_id = row.get("id")
            issuer = (row.get("issuer_name") or "").strip()
            if cert_id and issuer:
                findings.append(
                    Finding(
                        source_tool=self.name,
                        entity_kind=EntityKind.CERT,
                        entity_value=str(cert_id),
                        attributes={
                            "issuer": issuer,
                            "common_name": (row.get("common_name") or "").strip(),
                            "not_before": row.get("not_before"),
                            "not_after": row.get("not_after"),
                            "domain": target,
                        },
                    )
                )
        return findings
