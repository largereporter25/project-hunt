"""DNS resolution + record enumeration.

Pure stdlib socket — no upstream HTTP, no API key, always works.
The output goes through the Evidence Vault so the resolver's answer
is hash-attested, even though no third party is involved.
"""
from __future__ import annotations

import json
import socket
from typing import Any, List, Mapping

import httpx

from hunt.ingestion.base import Finding, ToolFunction
from hunt.models import EntityKind, SourceTool


class DnsTool(ToolFunction):
    name = SourceTool.DNS
    accepts = {"domain"}
    emits = {EntityKind.IPV4, EntityKind.IPV6, EntityKind.SUBDOMAIN}
    description = "Resolves A/AAAA records via the system resolver."
    per_request_timeout = 5.0

    def _fetch(self, query: Mapping[str, Any]) -> httpx.Response:
        target = query["target"].strip().lower()
        records: dict = {"target": target, "records": {}}
        try:
            infos = socket.getaddrinfo(target, None)
            v4, v6 = set(), set()
            for fam, *_rest, sockaddr in infos:
                ip = sockaddr[0]
                if fam == socket.AF_INET:
                    v4.add(ip)
                elif fam == socket.AF_INET6:
                    v6.add(ip)
            records["records"]["A"] = sorted(v4)
            records["records"]["AAAA"] = sorted(v6)
        except socket.gaierror as exc:
            records["error"] = str(exc)
        body = json.dumps(records).encode("utf-8")
        return httpx.Response(
            200, content=body, headers={"content-type": "application/json"}
        )

    def _parse(self, raw: bytes, query: Mapping[str, Any]) -> List[Finding]:
        records = json.loads(raw.decode("utf-8"))
        findings: List[Finding] = []
        host = records.get("target") or query["target"]
        for ip in records.get("records", {}).get("A", []):
            findings.append(
                Finding(
                    source_tool=self.name,
                    entity_kind=EntityKind.IPV4,
                    entity_value=ip,
                    attributes={"record_type": "A", "host": host},
                )
            )
        for ip in records.get("records", {}).get("AAAA", []):
            findings.append(
                Finding(
                    source_tool=self.name,
                    entity_kind=EntityKind.IPV6,
                    entity_value=ip,
                    attributes={"record_type": "AAAA", "host": host},
                )
            )
        return findings
