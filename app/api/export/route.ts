/**
 * GET /api/export — JSON evidence bundle.
 *
 * `?investigation_id=<uuid>` scopes to a single investigation; without
 * it, returns the most recent 2000 findings. Always includes the live
 * graph + counters.
 */

import { NextRequest, NextResponse } from "next/server";
import { withClient } from "@/lib/db";
import { CorrelationEngine, defaultRules } from "@/lib/correlation";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const investigationId = req.nextUrl.searchParams.get("investigation_id");

  const graph = await new CorrelationEngine(defaultRules()).snapshot();

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

  let investigation = null;
  let findings: any[] = [];
  if (investigationId) {
    if (!/^[0-9a-f-]{36}$/i.test(investigationId)) {
      return NextResponse.json(
        { error: "bad_id", detail: "investigation_id must be a UUID" },
        { status: 400 }
      );
    }
    investigation = await withClient(async (c) => {
      const r = await c.query(
        `SELECT id, target, kind, finding_count, edge_count, duration_ms, created_at
         FROM investigations WHERE id = $1`,
        [investigationId]
      );
      if (r.rows.length === 0) return null;
      const row = r.rows[0];
      return {
        id: row.id,
        target: row.target,
        kind: row.kind,
        finding_count: row.finding_count,
        edge_count: row.edge_count,
        duration_ms: row.duration_ms,
        created_at: new Date(row.created_at).toISOString(),
      };
    });
    if (!investigation) {
      return NextResponse.json(
        { error: "not_found", detail: "investigation not found" },
        { status: 404 }
      );
    }
    findings = await withClient(async (c) => {
      const r = await c.query(
        `SELECT f.id, f.source_tool, f.entity_kind, f.entity_value,
                f.attributes, f.observed_at,
                ev.payload_sha256, ev.tsa_authority, ev.tsa_stamped_at, ev.tsa_trusted
         FROM findings f
         JOIN evidence_vault ev ON ev.id = f.evidence_id
         WHERE f.investigation_id = $1
         ORDER BY f.observed_at DESC`,
        [investigationId]
      );
      return r.rows.map((row) => ({
        id: row.id,
        source_tool: row.source_tool,
        entity_kind: row.entity_kind,
        entity_value: row.entity_value,
        attributes: row.attributes,
        observed_at: row.observed_at,
        lineage: {
          payload_sha256: row.payload_sha256,
          tsa_authority: row.tsa_authority,
          tsa_stamped_at: row.tsa_stamped_at
            ? new Date(row.tsa_stamped_at).toISOString()
            : null,
          tsa_trusted: Boolean(row.tsa_trusted),
        },
      }));
    });
  } else {
    findings = await withClient(async (c) => {
      const r = await c.query(
        `SELECT f.id, f.source_tool, f.entity_kind, f.entity_value,
                f.attributes, f.observed_at,
                ev.payload_sha256, ev.tsa_authority, ev.tsa_stamped_at, ev.tsa_trusted
         FROM findings f
         JOIN evidence_vault ev ON ev.id = f.evidence_id
         ORDER BY f.observed_at DESC
         LIMIT 2000`
      );
      return r.rows.map((row) => ({
        id: row.id,
        source_tool: row.source_tool,
        entity_kind: row.entity_kind,
        entity_value: row.entity_value,
        attributes: row.attributes,
        observed_at: row.observed_at,
        lineage: {
          payload_sha256: row.payload_sha256,
          tsa_authority: row.tsa_authority,
          tsa_stamped_at: row.tsa_stamped_at
            ? new Date(row.tsa_stamped_at).toISOString()
            : null,
          tsa_trusted: Boolean(row.tsa_trusted),
        },
      }));
    });
  }

  return NextResponse.json({
    schema_version: "1.0",
    exported_at: new Date().toISOString(),
    investigation,
    findings,
    graph: { ...graph, node_count: graph.nodes.length, edge_count: graph.edges.length },
    stats,
  });
}
