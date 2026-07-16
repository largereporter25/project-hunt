/**
 * GET /api/graph — live entity graph snapshot.
 *
 * Same shape the Python `/api/v1/graph` returned: { nodes, edges,
 * node_count, edge_count }. The engine is stateless; this just
 * reads entities + entity_relationships and joins findings for the
 * per-node finding count.
 */

import { NextResponse } from "next/server";
import { CorrelationEngine, defaultRules } from "@/lib/correlation";

export const dynamic = "force-dynamic";

export async function GET() {
  const snap = await new CorrelationEngine(defaultRules()).snapshot();
  return NextResponse.json({
    nodes: snap.nodes,
    edges: snap.edges,
    node_count: snap.nodes.length,
    edge_count: snap.edges.length,
  });
}
