/**
 * POST /api/hunt — run a single investigation.
 *
 * Mirrors the Python `hunt()` function: validate body, narrow tools
 * by kind, insert an `investigations` row, run, ingest, return.
 *
 * The whole handler is wrapped in a top-level try/catch. Any pg
 * error (ECONNREFUSED, sslmode mismatch, auth, schema drift) is
 * surfaced in the JSON body as 503 with `error: "database_error"`,
 * never a bare 500 — the operator needs to see the real `pg` error
 * without digging through Vercel logs.
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

interface HuntResult {
  investigation_id: string;
  target: string;
  kind: string | null;
  findings: Array<{
    source_tool: string;
    entity_kind: string;
    entity_value: string;
    attributes: Record<string, unknown>;
    evidence_id?: string;
    payload_sha256?: string;
    tsa_authority?: string | null;
    tsa_stamped_at?: string | null;
    tsa_trusted?: boolean;
  }>;
  modules_run: string[];
  modules_skipped: Array<{ name: string; reason: string }>;
  module_errors: Record<string, string>;
  duration_ms: number;
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
    const result = await runHunt(target, kind, requestedModules);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof DatabaseNotConfigured) {
      return NextResponse.json(
        { error: "database_not_configured", detail: e.message },
        { status: 503 }
      );
    }
    const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return NextResponse.json(
      { error: "database_error", detail: message },
      { status: 503 }
    );
  }
}

async function runHunt(
  target: string,
  kind: string | null,
  requestedModules: string[] | null
): Promise<HuntResult> {
  // Decide which tools to run.
  let tools = availableTools();
  let modulesSkipped: Array<{ name: string; reason: string }> = [];
  if (requestedModules && requestedModules.length > 0) {
    const wanted = new Set(requestedModules.map((s) => s.toLowerCase()));
    const keep = tools.filter((t) => wanted.has(t.name));
    if (keep.length === 0) {
      throw new Error(`no_matching_modules: ${[...wanted].join(",")}`);
    }
    modulesSkipped = tools
      .filter((t) => !wanted.has(t.name))
      .map((t) => ({ name: t.name, reason: "not_requested" }));
    tools = keep;
  } else if (kind) {
    const narrowed = tools.filter((t) => t.accepts.has(kind));
    if (narrowed.length > 0) {
      modulesSkipped = tools
        .filter((t) => !t.accepts.has(kind))
        .map((t) => ({ name: t.name, reason: `accepts_no_${kind}` }));
      tools = narrowed;
    }
  } else {
    // Auto-infer kind from target shape. Use the narrow set ONLY if
    // it covers a meaningful portion of the available tools — for
    // a person/org target, a strict narrow would drop DNS/WHOIS/
    // crt.sh/Wayback/IPinfo, which all work fine with a free-text
    // query. If the narrow set is < 4 tools, fall back to running
    // all available tools (so the user sees the full attempt list).
    const k = inferKind(target);
    if (k) {
      const narrowed = tools.filter((t) => t.accepts.has(k));
      if (narrowed.length >= 4) {
        modulesSkipped = tools
          .filter((t) => !t.accepts.has(k))
          .map((t) => ({ name: t.name, reason: `accepts_no_${k}` }));
        tools = narrowed;
      }
      // else: keep all tools — better to try and return 0 findings
      // than silently skip 7 of 10.
    }
  }

  // Drop key-required tools whose env var is missing.
  const beforeKeyFilter = tools;
  tools = tools.filter((t) => !t.key_required || isKeyPresent(t.name));
  for (const t of beforeKeyFilter) {
    if (!tools.includes(t)) {
      modulesSkipped.push({ name: t.name, reason: "key_required" });
    }
  }

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
        JSON.stringify(modulesSkipped),
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

  // 5) Build the result.
  return {
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
    modules_skipped: modulesSkipped,
    module_errors: moduleErrors,
    duration_ms: durationMs,
  };
}
