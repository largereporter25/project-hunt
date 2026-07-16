/**
 * GET /api/stats — counters for the dashboard.
 */

import { NextResponse } from "next/server";
import { withClient } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const stats = await withClient(async (c) => {
    const [a, b, d, e, f] = await Promise.all([
      c.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM investigations`),
      c.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM evidence_vault`),
      c.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM findings`),
      c.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM entity_relationships`),
      c.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM entities`),
    ]);
    return {
      investigation_count: Number(a.rows[0].n),
      evidence_count: Number(b.rows[0].n),
      finding_count: Number(d.rows[0].n),
      edge_count: Number(e.rows[0].n),
      entity_count: Number(f.rows[0].n),
    };
  });
  return NextResponse.json(stats);
}
