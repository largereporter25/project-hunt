"""India Corporate Accountability Layer.

Wrappers and one-click deep-link generators for the most-cited Indian
regulatory/public-record sources. Every module is a `ToolFunction` so
it inherits provenance + the correlation pipeline for free.

We deliberately avoid the modules that are bot-blocked, login-walled,
or heavy-JS: MCA21, NSE/BSE, Truecaller, RTI Online. The ones that
are kept all return a one-click deep-link plus an extraction schema
the operator can run with a downstream scraper.
"""
from __future__ import annotations

import urllib.parse
from typing import Any, List, Mapping

import httpx

from hunt.ingestion.base import Finding, ToolFunction
from hunt.models import EntityKind, SourceTool


# --- MyNeta / ADR (donations) ---------------------------------------------


class MyNetaAdrTool(ToolFunction):
    name = SourceTool.MYNETA_ADR
    accepts = {"org", "person"}
    emits = {EntityKind.ORG, EntityKind.PERSON}
    description = "MyNeta / ADR — political donation disclosures."
    docs_url = "https://www.myneta.info/"
    per_request_timeout = 20.0

    SEARCH = "https://www.myneta.info/search.php"

    def _fetch(self, query: Mapping[str, Any]) -> httpx.Response:
        with httpx.Client(timeout=self.per_request_timeout) as client:
            return client.get(self.SEARCH, params={"q": query["target"]})

    def _parse(self, raw: bytes, query: Mapping[str, Any]) -> List[Finding]:
        return [
            Finding(
                source_tool=self.name,
                entity_kind=EntityKind.ORG,
                entity_value=query["target"],
                attributes={
                    "deep_link": f"{self.SEARCH}?q={urllib.parse.quote(query['target'])}",
                    "extraction_schema": {
                        "donor": str,
                        "recipient_party": str,
                        "amount_inr": int,
                        "donation_date": str,
                    },
                },
            )
        ]


# --- Indian Kanoon --------------------------------------------------------


class IndianKanoonTool(ToolFunction):
    name = SourceTool.INDIAN_KANOON
    accepts = {"person", "org", "court_case"}
    emits = {EntityKind.COURT_CASE, EntityKind.PERSON}
    description = "Indian Kanoon — Indian court case search."
    docs_url = "https://indiankanoon.org/"
    per_request_timeout = 20.0

    SEARCH = "https://indiankanoon.org/search/"

    def _fetch(self, query: Mapping[str, Any]) -> httpx.Response:
        with httpx.Client(timeout=self.per_request_timeout) as client:
            return client.get(self.SEARCH, params={"formInput": query["target"]})

    def _parse(self, raw: bytes, query: Mapping[str, Any]) -> List[Finding]:
        return [
            Finding(
                source_tool=self.name,
                entity_kind=EntityKind.COURT_CASE,
                entity_value=query["target"],
                attributes={
                    "deep_link": f"{self.SEARCH}?formInput={urllib.parse.quote(query['target'])}",
                    "extraction_schema": {
                        "title": str,
                        "citation": str,
                        "court": str,
                        "decision_date": str,
                        "judges": [str],
                        "summary": str,
                    },
                },
            )
        ]


# --- eCourts --------------------------------------------------------------


class ECourtsTool(ToolFunction):
    name = SourceTool.ECOURTS
    accepts = {"court_case", "person"}
    emits = {EntityKind.COURT_CASE}
    description = "eCourts — Indian district court case status."
    docs_url = "https://services.ecourts.gov.in/"
    per_request_timeout = 20.0

    SEARCH = "https://services.ecourts.gov.in/ecourtindia_v6/"

    def _fetch(self, query: Mapping[str, Any]) -> httpx.Response:
        with httpx.Client(timeout=self.per_request_timeout) as client:
            return client.get(
                self.SEARCH,
                params={"search_by": "case_no", "q": query["target"]},
            )

    def _parse(self, raw: bytes, query: Mapping[str, Any]) -> List[Finding]:
        return [
            Finding(
                source_tool=self.name,
                entity_kind=EntityKind.COURT_CASE,
                entity_value=query["target"],
                attributes={
                    "deep_link": (
                        f"{self.SEARCH}?search_by=case_no"
                        f"&q={urllib.parse.quote(query['target'])}"
                    ),
                    "extraction_schema": {
                        "case_number": str,
                        "court": str,
                        "next_hearing": str,
                        "petitioner": str,
                        "respondent": str,
                    },
                },
            )
        ]


# --- TAFCOP (DoT, mobile number connections) -----------------------------


class TafcopTool(ToolFunction):
    name = SourceTool.TAFCOP
    accepts = {"phone"}
    emits = {EntityKind.PHONE, EntityKind.PERSON}
    description = "TAFCOP — DoT mobile number connection audit."
    docs_url = "https://tafcop.dgtelecom.gov.in/"
    per_request_timeout = 20.0

    URL = "https://tafcop.dgtelecom.gov.in/"

    def _fetch(self, query: Mapping[str, Any]) -> httpx.Response:
        with httpx.Client(timeout=self.per_request_timeout) as client:
            return client.get(self.URL, params={"mobileNo": query["target"]})

    def _parse(self, raw: bytes, query: Mapping[str, Any]) -> List[Finding]:
        return [
            Finding(
                source_tool=self.name,
                entity_kind=EntityKind.PHONE,
                entity_value=query["target"],
                attributes={
                    "deep_link": (
                        f"{self.URL}?mobileNo={urllib.parse.quote(query['target'])}"
                    ),
                    "extraction_schema": {
                        "phone": str,
                        "linked_name": str,
                        "linked_count": int,
                    },
                },
            )
        ]
