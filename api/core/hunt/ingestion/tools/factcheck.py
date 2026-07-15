"""Google Fact Check Tools — claim verification.

API key REQUIRED (set ``FACTCHECKTOOLS_API_KEY``). When the key is
missing the tool returns zero findings (the runner is responsible
for filtering out the key-required stubs at registration time).
"""
from __future__ import annotations

import json
from typing import Any, List, Mapping

import httpx

from hunt.ingestion.base import Finding, ToolFunction
from hunt.config import get_settings
from hunt.models import EntityKind, SourceTool


class FactCheckTool(ToolFunction):
    name = SourceTool.FACTCHECK
    accepts = {"claim", "domain"}
    emits = {EntityKind.CLAIM, EntityKind.URL}
    key_required = True
    description = "Google Fact Check Tools — claim verification search."
    docs_url = "https://developers.google.com/fact-check/tools/api"
    per_request_timeout = 10.0

    URL = "https://factchecktools.googleapis.com/v1alpha1/claims:search"

    def _fetch(self, query: Mapping[str, Any]) -> httpx.Response:
        key = get_settings().factchecktools_api_key
        with httpx.Client(timeout=self.per_request_timeout) as client:
            return client.get(
                self.URL,
                params={"query": query["target"], "key": key, "pageSize": 20},
            )

    def _parse(self, raw: bytes, query: Mapping[str, Any]) -> List[Finding]:
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return []
        findings: List[Finding] = []
        for claim in data.get("claims", []):
            text = claim.get("text", "")
            claim_url = claim.get("claimReview", [{}])[0].get("url") if claim.get("claimReview") else None
            publisher = (
                claim.get("claimReview", [{}])[0].get("publisher", {}).get("name")
                if claim.get("claimReview")
                else None
            )
            rating = (
                claim.get("claimReview", [{}])[0].get("textualRating")
                if claim.get("claimReview")
                else None
            )
            if text:
                findings.append(
                    Finding(
                        source_tool=self.name,
                        entity_kind=EntityKind.CLAIM,
                        entity_value=text,
                        attributes={
                            "publisher": publisher,
                            "rating": rating,
                            "url": claim_url,
                        },
                    )
                )
        return findings
