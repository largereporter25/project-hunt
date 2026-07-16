/**
 * GET /api/vault — recent evidence records (most recent first).
 */

import { NextRequest, NextResponse } from "next/server";
import { withClient } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limit = Math.min(
    Math.max(Number(req.nextUrl.searchParams.get("limit") ?? 100), 1),
    1000
  );
  const rows = await withClient(async (c) => {
    const r = await c.query(
      `SELECT id, source_tool, query_params, payload_sha256,
              tsa_authority, tsa_stamped_at, tsa_trusted, created_at
       FROM evidence_vault
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    return r.rows;
  });
  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      source_tool: r.source_tool,
      query_params: r.query_params,
      payload_sha256: r.payload_sha256,
      tsa_authority: r.tsa_authority,
      tsa_stamped_at: r.tsa_stamped_at
        ? new Date(r.tsa_stamped_at).toISOString()
        : null,
      tsa_trusted: Boolean(r.tsa_trusted),
      created_at: new Date(r.created_at).toISOString(),
    }))
  );
}
