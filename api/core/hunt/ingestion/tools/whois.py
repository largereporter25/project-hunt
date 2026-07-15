"""WHOIS / RDAP lookup.

Tries RDAP first (returns structured JSON with registrant
information), then falls back to a text-based WHOIS server.

No API key required. Works for domains.
"""
from __future__ import annotations

import json
import re
from typing import Any, List, Mapping

import httpx

from hunt.ingestion.base import Finding, ToolFunction
from hunt.models import EntityKind, SourceTool


_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")


class WhoisTool(ToolFunction):
    name = SourceTool.WHOIS
    accepts = {"domain"}
    emits = {EntityKind.ORG, EntityKind.EMAIL, EntityKind.PERSON, EntityKind.DOMAIN}
    description = "RDAP/WHOIS registrant + registrar + email extraction."
    per_request_timeout = 10.0

    RDAP_URL = "https://rdap.org/domain/{target}"
    WHOIS_FALLBACK_HOST = "whois.iana.org"

    def _fetch(self, query: Mapping[str, Any]) -> httpx.Response:
        target = query["target"].strip().lower()
        with httpx.Client(timeout=self.per_request_timeout) as client:
            try:
                resp = client.get(self.RDAP_URL.format(target=target))
                if resp.status_code < 400:
                    resp.headers["content-type"] = (
                        resp.headers.get("content-type") or "application/rdap+json"
                    )
                    return resp
            except httpx.HTTPError:
                pass
            # Fallback: text WHOIS over the IANA referral server.
            with client.stream(
                "GET", f"https://{self.WHOIS_FALLBACK_HOST}/{target}"
            ) as r:
                body = r.read()
            return httpx.Response(
                200, content=body, headers={"content-type": "text/plain"}
            )

    def _parse(self, raw: bytes, query: Mapping[str, Any]) -> List[Finding]:
        target = query["target"].strip().lower()
        findings: List[Finding] = []
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            data = None

        if isinstance(data, dict) and "entities" in data:
            for entity in data.get("entities", []):
                roles = entity.get("roles", [])
                vcard = entity.get("vcardArray", [None, []])
                name = ""
                email = ""
                if isinstance(vcard, list) and len(vcard) > 1:
                    for entry in vcard[1]:
                        if entry and entry[0] == "fn":
                            name = entry[3]
                        if entry and entry[0] == "email":
                            email = entry[3]
                if "registrant" in roles and email:
                    findings.append(
                        Finding(
                            source_tool=self.name,
                            entity_kind=EntityKind.EMAIL,
                            entity_value=email,
                            attributes={
                                "role": "registrant",
                                "name": name,
                                "domain": target,
                            },
                        )
                    )
                if "registrar" in roles and name:
                    findings.append(
                        Finding(
                            source_tool=self.name,
                            entity_kind=EntityKind.ORG,
                            entity_value=name,
                            attributes={"role": "registrar", "domain": target},
                        )
                    )
            return findings

        text = raw.decode("utf-8", errors="replace")
        for m in _EMAIL_RE.findall(text):
            findings.append(
                Finding(
                    source_tool=self.name,
                    entity_kind=EntityKind.EMAIL,
                    entity_value=m.lower(),
                    attributes={"role": "registrant", "domain": target, "source": "whois-text"},
                )
            )
        m = re.search(r"Registrar:\s*(.+)", text)
        if m:
            findings.append(
                Finding(
                    source_tool=self.name,
                    entity_kind=EntityKind.ORG,
                    entity_value=m.group(1).strip(),
                    attributes={"role": "registrar", "domain": target},
                )
            )
        return findings
