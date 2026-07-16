/**
 * GET /api/investigations — recent investigations (for the sidebar).
 */

import { NextRequest, NextResponse } from "next/server";
import { withClient } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limit = Math.min(
    Math.max(Number(req.nextUrl.searchParams.get("limit") ?? 20), 1),
    200
  );
  const rows = await withClient(async (c) => {
    const r = await c.query(
      `SELECT id, target, kind, finding_count, edge_count, duration_ms, created_at
       FROM investigations
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    return r.rows;
  });
  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      target: r.target,
      kind: r.kind,
      finding_count: r.finding_count,
      edge_count: r.edge_count,
      duration_ms: r.duration_ms,
      created_at: new Date(r.created_at).toISOString(),
    }))
  );
}
