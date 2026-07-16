/**
 * Schema + vault DB round-trip test.
 *
 * Auto-skips when `TEST_DATABASE_URL` is not set. The user can run
 * the full suite (including this test) against a local Postgres or
 * Neon branch by setting the env var:
 *
 *   TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/hunt_test \
 *     npx tsx --test tests/*.test.ts
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

const URL = process.env.TEST_DATABASE_URL;
const skip = URL ? describe : describe.skip;

skip("schema + vault (Postgres)", () => {
  before(async () => {
    // Point the db module at the test DB.
    process.env.DATABASE_URL = URL;
    // Force a fresh module load so config picks up the override.
    // tsx will reuse the cache between describe blocks, so this is
    // best-effort; in practice users run with DATABASE_URL set from
    // the start when targeting a test DB.
  });

  it("applies the schema and round-trips a payload", async (t) => {
    const { Pool } = await import("pg");
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { sha256Hex } = await import("../lib/tsa");

    const pool = new Pool({ connectionString: URL });
    const c = await pool.connect();
    try {
      // Use a uniquely-named schema so this test is safe against a
      // shared DB. We drop + recreate it.
      const schema = "hunt_test_" + Math.random().toString(36).slice(2, 8);
      await c.query(`CREATE SCHEMA "${schema}"`);
      await c.query(`SET search_path TO "${schema}"`);
      await c.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
      // Substitute "TABLE " with the schema prefix so the SQL runs
      // in our isolated namespace. A bit gross but means we don't
      // need to keep a parallel test schema file.
      const raw = readFileSync(join(process.cwd(), "lib", "schema.sql"), "utf-8");
      const names = [
        "raw_payloads",
        "evidence_vault",
        "findings",
        "entities",
        "entity_relationships",
        "investigations",
      ];
      let sql = raw;
      for (const n of names) {
        sql = sql.replaceAll(`TABLE ${n}`, `TABLE "${schema}".${n}`);
      }
      await c.query(sql);

      // Insert a payload, an evidence record, and a finding.
      const bytes = Buffer.from("hello world");
      const digest = sha256Hex(bytes);
      const p = await c.query(
        `INSERT INTO "${schema}".raw_payloads (sha256, content_b64, byte_length, content_type)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [digest, bytes.toString("base64"), bytes.length, "text/plain"]
      );
      assert.ok(p.rows[0].id);

      const ev = await c.query(
        `INSERT INTO "${schema}".evidence_vault
           (source_tool, query_params, payload_sha256, tsa_trusted)
         VALUES ($1, $2::jsonb, $3, 0) RETURNING id`,
        ["dns", JSON.stringify({ target: "example.com" }), digest]
      );
      assert.ok(ev.rows[0].id);

      const f = await c.query(
        `INSERT INTO "${schema}".findings
           (evidence_id, source_tool, entity_kind, entity_value, attributes)
         VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id`,
        [ev.rows[0].id, "dns", "ipv4", "1.2.3.4", JSON.stringify({})]
      );
      assert.ok(f.rows[0].id);

      // Query back.
      const back = await c.query(
        `SELECT f.entity_value, f.source_tool, ev.payload_sha256
         FROM "${schema}".findings f
         JOIN "${schema}".evidence_vault ev ON ev.id = f.evidence_id
         WHERE f.id = $1`,
        [f.rows[0].id]
      );
      assert.equal(back.rows[0].entity_value, "1.2.3.4");
      assert.equal(back.rows[0].payload_sha256, digest);

      // Cleanup.
      await c.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally {
      c.release();
      await pool.end();
    }
  });
});
