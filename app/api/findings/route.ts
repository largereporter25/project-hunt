/**
 * GET /api/findings — recent findings, most-recent first.
 *
 * Joins evidence so the lineage block (sha256, tsa, etc.) is
 * available for each finding.
 */

import { NextRequest, NextResponse } from "next/server";
import { withClient } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limit = Math.min(
    Math.max(Number(req.nextUrl.searchParams.get("limit") ?? 500), 1),
    5000
  );
  const rows = await withClient(async (c) => {
    const r = await c.query(
      `SELECT f.id, f.source_tool, f.entity_kind, f.entity_value,
              f.attributes, f.observed_at,
              ev.payload_sha256, ev.tsa_authority, ev.tsa_stamped_at, ev.tsa_trusted
       FROM findings f
       JOIN evidence_vault ev ON ev.id = f.evidence_id
       ORDER BY f.observed_at DESC
       LIMIT $1`,
      [limit]
    );
    return r.rows;
  });
  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      source_tool: r.source_tool,
      entity_kind: r.entity_kind,
      entity_value: r.entity_value,
      attributes: r.attributes,
      observed_at: r.observed_at,
      lineage: {
        evidence_id: r.id, // not the evidence_id; findings.id is fine for display
        payload_sha256: r.payload_sha256,
        tsa_authority: r.tsa_authority,
        tsa_stamped_at: r.tsa_stamped_at
          ? new Date(r.tsa_stamped_at).toISOString()
          : null,
        tsa_trusted: Boolean(r.tsa_trusted),
      },
    }))
  );
}
