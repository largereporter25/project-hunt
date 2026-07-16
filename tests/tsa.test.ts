/**
 * RFC 3161 unit tests.
 *
 * We don't hit a real TSA in tests — the request builder and the
 * genTime parser are pure functions and the local-clock fallback is
 * also covered.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildTspRequest,
  parseGenTime,
  HttpTsa,
  LocalTsa,
  TsaClient,
  sha256Hex,
} from "../lib/tsa";

describe("tsa.buildTspRequest", () => {
  it("builds a SEQUENCE with INTEGER 1 + SHA-256 OID + digest", () => {
    const digest = Buffer.alloc(32, 0xab);
    const req = buildTspRequest(digest);
    // Outer SEQUENCE tag + length 58.
    assert.equal(req[0], 0x30);
    assert.equal(req[1], 58);
    // INTEGER 1 (version).  tag=02, length=01, value=01
    assert.equal(req[2], 0x02);
    assert.equal(req[3], 0x01);
    assert.equal(req[4], 0x01);
    // AlgorithmIdentifier SEQUENCE at offset 5.
    assert.equal(req[5], 0x30);
    // Inner SEQUENCE for { OID, NULL } at offset 7.
    assert.equal(req[7], 0x30);
    // OID tag at offset 9, length 9.
    assert.equal(req[9], 0x06);
    assert.equal(req[10], 0x09);
    // OID 2.16.840.1.101.3.4.2.1 (SHA-256) — bytes 11..19.
    const oid = req.subarray(11, 20);
    assert.deepEqual(
      [...oid],
      [0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]
    );
    // NULL parameter at offset 20.
    assert.equal(req[20], 0x05);
    assert.equal(req[21], 0x00);
    // messageImprint SEQUENCE at offset 22: tag=48, length=51.
    assert.equal(req[22], 0x30);
    assert.equal(req[23], 51);
    // Digest OCTET STRING at offset 24: tag=04, length=32.
    assert.equal(req[24], 0x04);
    assert.equal(req[25], 0x20);
  });

  it("rejects an empty digest", () => {
    assert.throws(() => buildTspRequest(Buffer.alloc(0)));
  });

  it("rejects a non-32-byte digest", () => {
    // SHA-256 only for now; buildTspRequest is happy with any non-empty
    // length, but the dispatcher enforces 32 bytes (64 hex chars).
    const c = new TsaClient({
      database_url: "postgresql://x",
      is_vercel: false,
      is_postgres: true,
      app_env: "test",
      log_level: "ERROR",
      shodan_api_key: null,
      hibp_api_key: null,
      virustotal_api_key: null,
      greynoise_api_key: null,
      securitytrails_api_key: null,
      ipinfo_api_key: null,
      maltego_api_key: null,
      factchecktools_api_key: null,
      gemini_api_key: null,
      tsa_urls: [],
      tsa_required: false,
      tsa_timeout_seconds: 1,
    });
    return assert.rejects(() => c.stamp("not-hex"));
  });
});

describe("tsa.parseGenTime", () => {
  it("extracts a YYYYMMDDHHMMSSZ string from a synthetic TSTInfo-like blob", () => {
    // Build a tiny blob with the GeneralizedTime tag (0x18) followed
    // by a 14-byte string. The parser scans for the first such tag.
    const t = "20240115093045Z";
    const blob = Buffer.concat([
      Buffer.from([0x18, t.length]),
      Buffer.from(t, "ascii"),
      // trailing junk
      Buffer.from([0x00, 0xff, 0xab]),
    ]);
    const parsed = parseGenTime(blob);
    assert.ok(parsed instanceof Date);
    assert.equal(parsed!.toISOString(), "2024-01-15T09:30:45.000Z");
  });

  it("returns null for a blob with no genTime", () => {
    assert.equal(parseGenTime(Buffer.from([0x00, 0x01, 0x02, 0x03])), null);
  });

  it("handles long-form length encoding (0x81 NN)", () => {
    const t = "20240630235959Z";
    // 14 bytes — that's already short-form, but exercise the parser
    // branch with a constructed 0x81-prefixed length by wrapping.
    const blob = Buffer.concat([
      Buffer.from([0x18, 0x81, t.length]),
      Buffer.from(t, "ascii"),
    ]);
    const parsed = parseGenTime(blob);
    assert.ok(parsed);
    assert.equal(parsed!.toISOString(), "2024-06-30T23:59:59.000Z");
  });
});

describe("tsa.LocalTsa", () => {
  it("returns an untrusted, local-clock token", async () => {
    const t = new LocalTsa();
    const tok = await t.stamp(sha256Hex(Buffer.from("hello")));
    assert.equal(tok.authority, "local-clock");
    assert.equal(tok.trusted, false);
    assert.equal(tok.token_b64, "");
    assert.ok(tok.stamped_at instanceof Date);
  });
});

describe("tsa.TsaClient fallback chain", () => {
  it("falls back to local clock when all authorities fail and tsa_required is false", async () => {
    const failing = { stamp: async () => { throw new Error("nope"); } };
    const c = new TsaClient(
      {
        database_url: "",
        is_vercel: false,
        is_postgres: false,
        app_env: "test",
        log_level: "ERROR",
        shodan_api_key: null,
        hibp_api_key: null,
        virustotal_api_key: null,
        greynoise_api_key: null,
        securitytrails_api_key: null,
        ipinfo_api_key: null,
        maltego_api_key: null,
        factchecktools_api_key: null,
        gemini_api_key: null,
        tsa_urls: [],
        tsa_required: false,
        tsa_timeout_seconds: 1,
      },
      [failing]
    );
    const tok = await c.stamp("0".repeat(64));
    assert.equal(tok.trusted, false);
  });

  it("throws when all authorities fail and tsa_required is true", async () => {
    const failing = { stamp: async () => { throw new Error("nope"); } };
    const c = new TsaClient(
      {
        database_url: "",
        is_vercel: false,
        is_postgres: false,
        app_env: "test",
        log_level: "ERROR",
        shodan_api_key: null,
        hibp_api_key: null,
        virustotal_api_key: null,
        greynoise_api_key: null,
        securitytrails_api_key: null,
        ipinfo_api_key: null,
        maltego_api_key: null,
        factchecktools_api_key: null,
        gemini_api_key: null,
        tsa_urls: [],
        tsa_required: true,
        tsa_timeout_seconds: 1,
      },
      [failing]
    );
    await assert.rejects(() => c.stamp("0".repeat(64)));
  });
});
