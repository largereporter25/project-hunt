/**
 * Kind detection tests. Mirrors the Python _tools_for_target
 * heuristic.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inferKind, looksLikeIpv4, looksLikeIpv6 } from "../lib/infer";

describe("infer.looksLikeIpv4", () => {
  it("accepts canonical addresses", () => {
    assert.equal(looksLikeIpv4("8.8.8.8"), true);
    assert.equal(looksLikeIpv4("127.0.0.1"), true);
    assert.equal(looksLikeIpv4("255.255.255.255"), true);
  });
  it("rejects non-addresses", () => {
    assert.equal(looksLikeIpv4("example.com"), false);
    assert.equal(looksLikeIpv4("256.0.0.0"), false);
    assert.equal(looksLikeIpv4("1.2.3"), false);
  });
});

describe("infer.looksLikeIpv6", () => {
  it("accepts IPv6 with colons", () => {
    assert.equal(looksLikeIpv6("::1"), true);
    assert.equal(looksLikeIpv6("2001:db8::1"), true);
  });
  it("rejects non-IPv6", () => {
    assert.equal(looksLikeIpv6("example.com"), false);
    assert.equal(looksLikeIpv6("8.8.8.8"), false);
  });
});

describe("infer.inferKind", () => {
  it("detects email", () => {
    assert.equal(inferKind("alice@example.com"), "email");
  });
  it("detects ipv4", () => {
    assert.equal(inferKind("8.8.8.8"), "ipv4");
  });
  it("detects domain (with dot, no spaces, no slashes)", () => {
    assert.equal(inferKind("example.com"), "domain");
    assert.equal(inferKind("sub.example.co.uk"), "domain");
  });
  it("detects url", () => {
    assert.equal(inferKind("https://example.com/page"), "url");
    assert.equal(inferKind("http://example.com"), "url");
  });
  it("detects phone (7-15 digits)", () => {
    assert.equal(inferKind("+919876543210"), "phone");
    assert.equal(inferKind("9876543210"), "phone");
  });
  it("falls back to person for a free-text name", () => {
    assert.equal(inferKind("Jane Doe"), "person");
  });
  it("returns null for empty input", () => {
    assert.equal(inferKind(""), null);
    assert.equal(inferKind("   "), null);
  });
});
