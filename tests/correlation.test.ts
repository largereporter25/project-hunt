/**
 * Correlation engine unit tests.
 *
 * Tests the pure-function parts (default rules, rule definitions) and
 * the in-memory helpers without a DB. The DB round-trip test lives in
 * schema.test.ts.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defaultRules } from "../lib/correlation";

describe("correlation.defaultRules", () => {
  it("returns the four documented rules", () => {
    const rules = defaultRules();
    const names = rules.map((r) => r.name);
    assert.deepEqual(names.sort(), [
      "crtsh_cert_to_domain",
      "ip_cross_source",
      "ip_to_asn",
      "subdomain_cross_source",
    ]);
  });

  it("every rule has a name, lhs, rhs, weight, and join_key", () => {
    for (const r of defaultRules()) {
      assert.ok(r.name);
      assert.ok(r.lhs);
      assert.ok(r.rhs);
      assert.ok(Number.isFinite(r.weight));
      assert.equal(typeof r.join_key, "function");
    }
  });

  it("ip_cross_source has the highest weight (4)", () => {
    const rules = defaultRules();
    const ip = rules.find((r) => r.name === "ip_cross_source")!;
    assert.equal(ip.weight, 4);
  });

  it("join_key is case-insensitive (by_value lowercases)", () => {
    const r = defaultRules()[0];
    const out = r.join_key({
      source_tool: "x",
      entity_kind: r.lhs,
      entity_value: "EXAMPLE.com",
      attributes: {},
    });
    assert.equal(out, "example.com");
  });
});
