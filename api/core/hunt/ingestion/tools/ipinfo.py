"""IPinfo — IP geolocation + ASN + org.

The free tier (50k requests/month) requires no key for the first
install. Set ``IPINFO_API_KEY`` for higher rate limits.
"""
from __future__ import annotations

import json
from typing import Any, List, Mapping

import httpx

from hunt.ingestion.base import Finding, ToolFunction
from hunt.config import get_settings
from hunt.models import EntityKind, SourceTool


class IpinfoTool(ToolFunction):
    name = SourceTool.IPINFO
    accepts = {"ipv4", "ipv6", "domain"}
    emits = {EntityKind.IPV4, EntityKind.ORG, EntityKind.ASN}
    description = "IPinfo — IP geolocation, ASN, and organization."
    docs_url = "https://ipinfo.io/developers"
    per_request_timeout = 8.0

    URL = "https://ipinfo.io/{target}/json"

    def _fetch(self, query: Mapping[str, Any]) -> httpx.Response:
        key = get_settings().ipinfo_api_key
        headers = {"Authorization": f"Bearer {key}"} if key else {}
        with httpx.Client(timeout=self.per_request_timeout) as client:
            return client.get(
                self.URL.format(target=query["target"]), headers=headers
            )

    def _parse(self, raw: bytes, query: Mapping[str, Any]) -> List[Finding]:
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return []
        findings: List[Finding] = []
        ip = data.get("ip") or query["target"]
        findings.append(
            Finding(
                source_tool=self.name,
                entity_kind=EntityKind.IPV4,
                entity_value=ip,
                attributes={
                    "city": data.get("city"),
                    "region": data.get("region"),
                    "country": data.get("country"),
                    "loc": data.get("loc"),
                    "org": data.get("org"),
                    "hostname": data.get("hostname"),
                },
            )
        )
        org = data.get("org")
        if org and org.startswith("AS"):
            parts = org.split(" ", 1)
            if len(parts) == 2:
                asn, name = parts
                findings.append(
                    Finding(
                        source_tool=self.name,
                        entity_kind=EntityKind.ASN,
                        entity_value=asn,
                        attributes={"name": name, "ip": ip},
                    )
                )
                findings.append(
                    Finding(
                        source_tool=self.name,
                        entity_kind=EntityKind.ORG,
                        entity_value=name,
                        attributes={"asn": asn, "ip": ip},
                    )
                )
        return findings
