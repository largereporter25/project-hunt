/**
 * Liveness probe.
 *
 * Returns `{ status: "ok", app: "hunt", version: "0.3.0" }` when the
 * backend is fully wired up (DB reachable). On Vercel without
 * DATABASE_URL, returns 503 with `error: "database_not_configured"`
 * and the human-readable message — same contract as the Python
 * version, so the operator sees the actual problem instead of a 500.
 */

import { NextResponse } from "next/server";
import { ensureSchema, DatabaseNotConfigured } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSchema();
    return NextResponse.json({ status: "ok", app: "hunt", version: "0.3.0" });
  } catch (e) {
    if (e instanceof DatabaseNotConfigured) {
      return NextResponse.json(
        {
          status: "misconfigured",
          app: "hunt",
          version: "0.3.0",
          error: "database_not_configured",
          detail: e.message,
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { status: "error", error: String(e) },
      { status: 500 }
    );
  }
}
