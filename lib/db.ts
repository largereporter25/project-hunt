/**
 * Postgres connection pool + schema bootstrap.
 *
 * Single module-level `pg.Pool`. On the first DB use we ensure
 * the `pgcrypto` extension (for `gen_random_uuid()`) and run the
 * `lib/schema.sql` migration. Both are idempotent.
 *
 * The previous Python version had two paths (SQLite + Postgres). We
 * only need Postgres now: the user explicitly asked for "Neon or
 * Supabase, something that works with Vercel". Vercel serverless
 * functions have no writable FS, so SQLite would lose data on cold
 * start anyway.
 *
 * If `DATABASE_URL` is missing or unreachable, every API route
 * returns a 503 with `error: "database_not_configured"` — the same
 * 503 contract the Python version had.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { getSettings } from "./config";

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

export class DatabaseNotConfigured extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "DatabaseNotConfigured";
  }
}

function makePool(): Pool {
  const s = getSettings();
  return new Pool({
    connectionString: s.database_url,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl:
      s.is_postgres && !s.database_url.includes("localhost")
        ? { rejectUnauthorized: false }
        : undefined,
  });
}

export function getPool(): Pool {
  if (pool) return pool;
  const s = getSettings();
  if (!s.database_url) {
    throw new DatabaseNotConfigured(
      "DATABASE_URL is empty. Set it in your Vercel project's environment " +
        "variables to a postgresql:// URL from Neon, Supabase, or Vercel Postgres."
    );
  }
  pool = makePool();
  return pool;
}

/**
 * Lazy schema bootstrap. Safe to call from every request — the
 * underlying `CREATE TABLE IF NOT EXISTS` and `CREATE EXTENSION IF
 * NOT EXISTS` are no-ops on a warm DB.
 */
export function ensureSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const p = getPool();
    const sqlPath = join(process.cwd(), "lib", "schema.sql");
    let sql: string;
    try {
      sql = readFileSync(sqlPath, "utf-8");
    } catch (e) {
      // Fall back to a single-line attempt — better than a hard fail
      // when the bundler omits the file.
      sql = "";
    }
    const c = await p.connect();
    try {
      await c.query("CREATE EXTENSION IF NOT EXISTS pgcrypto;");
      if (sql) {
        await c.query(sql);
      }
    } finally {
      c.release();
    }
  })().catch((e) => {
    // Force a re-attempt on the next call.
    schemaReady = null;
    throw e;
  });
  return schemaReady;
}

/**
 * Borrow a client, ensure the schema is up, run `fn`, and release.
 * `fn` is responsible for its own transaction (BEGIN/COMMIT/ROLLBACK).
 */
export async function withClient<T>(
  fn: (c: PoolClient) => Promise<T>
): Promise<T> {
  await ensureSchema();
  const c = await getPool().connect();
  try {
    return await fn(c);
  } finally {
    c.release();
  }
}

/**
 * Helper for the common "I just need a single query" case. Opens a
 * client, runs `fn` on it, releases. Does NOT manage a transaction.
 */
export async function withConn<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  return withClient(fn);
}
