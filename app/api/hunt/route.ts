/**
 * POST /api/hunt — run a single investigation.
 *
 * Mirrors the Python `hunt()` function: validate body, narrow tools
 * by kind, insert an `investigations` row, run, ingest, return.
 *
 * Errors caught at the top level and turned into a 200 response
 * with `module_errors` filled in (so the UI shows "tool X failed"
 * rather than a 500). The single non-happy path is "DB not
 * configured" → 503.
 *
 * Same `HuntResponse` shape as the Python version.
 */

import { NextRequest, NextResponse } from "next/server";
import { availableTools, toolByName } from "@/lib/tools/registry";
import { runTools, type RunResult } from "@/lib/tools/runner";
import { CorrelationEngine, defaultRules } from "@/lib/correlation";
import { inferKind } from "@/lib/infer";
import { DatabaseNotConfigured, ensureSchema, withClient } from "@/lib/db";
import { isKeyPresent } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface HuntBody {
  target?: string;
  kind?: string | null;
  modules?: string[] | null;
}

export async function POST(req: NextRequest) {
  let body: HuntBody = {};
  try {
    body = (await req.json()) as HuntBody;
  } catch {
    return NextResponse.json(
      { error: "invalid_json", detail: "body must be JSON" },
      { status: 400 }
    );
  }
  const target = (body.target ?? "").trim();
  if (!target) {
    return NextResponse.json(
      { error: "missing_target", detail: "target is required" },
      { status: 400 }
    );
  }
  const kind = body.kind ?? null;
  const requestedModules = body.modules ?? null;

  try {
    await ensureSchema();
  } catch (e) {
    if (e instanceof DatabaseNotConfigured) {
      return NextResponse.json(
        { error: "database_not_configured", detail: e.message },
        { status: 503 }
      );
    }
    throw e;
  }

  // Decide which tools to run.
  let tools = availableTools();
  if (requestedModules && requestedModules.length > 0) {
    const wanted = new Set(requestedModules.map((s) => s.toLowerCase()));
    tools = tools.filter((t) => wanted.has(t.name));
    if (tools.length === 0) {
      return NextResponse.json(
        { error: "no_matching_modules", detail: [...wanted].join(",") },
        { status: 400 }
      );
    }
  } else if (kind) {
    const narrowed = tools.filter((t) => t.accepts.has(kind));
    if (narrowed.length > 0) tools = narrowed;
  } else {
    // Auto-infer kind from target shape.
    const k = inferKind(target);
    if (k) {
      const narrowed = tools.filter((t) => t.accepts.has(k));
      if (narrowed.length > 0) tools = narrowed;
    }
  }

  // Filter out key-required tools that don't have a key. (The
  // registry already does this, but defensive against custom lists.)
  tools = tools.filter((t) => !t.key_required || isKeyPresent(t.name));

  // 1) Insert investigation row up front so findings can FK to it.
  const investigationId = await withClient(async (c) => {
    const r = await c.query(
      `INSERT INTO investigations
         (target, kind, modules_run, modules_skipped, finding_count, edge_count, duration_ms)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, 0, 0, 0)
       RETURNING id`,
      [
        target,
        kind,
        JSON.stringify(tools.map((t) => t.name)),
        JSON.stringify([]),
      ]
    );
    return r.rows[0].id as string;
  });

  // 2) Run all tools in parallel.
  const t0 = Date.now();
  const results: RunResult[] = await runTools(tools, { target, kind });
  const findings = results.flatMap((r) => r.findings);

  // 3) Persist findings + run correlation.
  let edgeCount = 0;
  let findingCount = 0;
  const moduleErrors: Record<string, string> = {};
  for (const r of results) {
    if (r.error) moduleErrors[r.tool] = r.error;
    for (const f of r.findings) {
      if (f.attributes?.module_error) {
        moduleErrors[r.tool] = String(f.attributes.module_error);
      }
    }
  }
  try {
    const out = await new CorrelationEngine(defaultRules()).ingest(
      investigationId,
      findings
    );
    edgeCount = out.edges.length;
    findingCount = out.finding_count;
  } catch (e) {
    moduleErrors["correlation"] = String(e).slice(0, 240);
  }

  const durationMs = Date.now() - t0;

  // 4) Update the investigation row with the final counters.
  await withClient(async (c) => {
    await c.query(
      `UPDATE investigations
       SET finding_count = $1, edge_count = $2, duration_ms = $3
       WHERE id = $4`,
      [findingCount, edgeCount, durationMs, investigationId]
    );
  });

  // 5) Build the response.
  return NextResponse.json({
    investigation_id: investigationId,
    target,
    kind,
    findings: findings.map((f) => ({
      source_tool: f.source_tool,
      entity_kind: f.entity_kind,
      entity_value: f.entity_value,
      attributes: f.attributes || {},
      evidence_id: f._hunt_lineage?.evidence_id,
      payload_sha256: f._hunt_lineage?.payload_sha256,
      tsa_authority: f._hunt_lineage?.tsa_authority,
      tsa_stamped_at: f._hunt_lineage?.tsa_stamped_at,
      tsa_trusted: f._hunt_lineage?.tsa_trusted,
    })),
    modules_run: tools.map((t) => t.name),
    modules_skipped: [],
    module_errors: moduleErrors,
    duration_ms: durationMs,
  });
}
