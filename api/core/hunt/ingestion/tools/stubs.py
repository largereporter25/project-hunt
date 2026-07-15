"""Honest stubs for tools that need an API key.

These never make an upstream call. They emit a single
``module_error=key_required`` finding so the dashboard can still
render them in the catalogue with a 'key required' chip, and the
operator can see the docs URL in the findings table.
"""
from __future__ import annotations

from hunt.ingestion.base import StubTool
from hunt.models import EntityKind, SourceTool


class ShodanStub(StubTool):
    name = SourceTool.SHODAN
    accepts = {"domain", "ipv4", "ipv6"}
    emits = {EntityKind.IPV4, EntityKind.ASN, EntityKind.ORG, EntityKind.URL}
    docs_url = "https://developer.shodan.io/api"
    description = "Shodan — internet-wide host scanning & banners."


class VirusTotalStub(StubTool):
    name = SourceTool.VIRUSTOTAL
    accepts = {"domain", "ipv4", "url", "hash"}
    emits = {EntityKind.DOMAIN, EntityKind.HASH, EntityKind.URL}
    docs_url = "https://docs.virustotal.com/"
    description = "VirusTotal — file/URL/domain reputation."


class HibpStub(StubTool):
    name = SourceTool.HIBP
    accepts = {"email"}
    emits = {EntityKind.BREACH, EntityKind.EMAIL}
    docs_url = "https://haveibeenpwned.com/API/v3"
    description = "HaveIBeenPwned — email breach exposure."


class GreyNoiseStub(StubTool):
    name = SourceTool.GREYNOISE
    accepts = {"ipv4"}
    emits = {EntityKind.IPV4}
    docs_url = "https://docs.greynoise.io/"
    description = "GreyNoise — internet scanner/benign classification."


class SecurityTrailsStub(StubTool):
    name = SourceTool.SECURITYTRAILS
    accepts = {"domain"}
    emits = {EntityKind.DOMAIN, EntityKind.IPV4}
    docs_url = "https://docs.securitytrails.com/"
    description = "SecurityTrails — historical DNS + subdomain enumeration."


class MaltegoStub(StubTool):
    name = SourceTool.MALTEGO
    accepts = {"domain", "email", "ipv4", "person"}
    emits = {EntityKind.DOMAIN, EntityKind.EMAIL, EntityKind.ORG, EntityKind.PERSON}
    docs_url = "https://docs.maltego.com/"
    description = "Maltego transform hub — commercial OSINT transforms."
