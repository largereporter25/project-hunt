/**
 * Deterministic correlation engine.
 *
 * Same four rules as the Python version, ported bit-for-bit:
 *   - ip_cross_source        (weight 4)
 *   - subdomain_cross_source (weight 3)
 *   - crtsh_cert_to_domain   (weight 2)
 *   - ip_to_asn              (weight 2)
 *
 * Plus the built-in `cross_tool_observation` rule that marks an
 * entity as "seen by" multiple tools.
 *
 * Engine is stateless: every request rebuilds the snapshot from
 * Postgres. Vercel serverless functions are short-lived, so the DB
 * is the source of truth.
 */

import { withClient } from "./db";
import type { PoolClient } from "pg";

export type EntityKind = string;

export interface ToolFinding {
  source_tool: string;
  entity_kind: EntityKind;
  entity_value: string;
  attributes: Record<string, unknown>;
}

export interface EdgeRule {
  name: string;
  description: string;
  lhs: EntityKind;
  rhs: EntityKind;
  weight: number;
  join_key: (f: ToolFinding) => string;
}

const byValue = (f: ToolFinding) => (f.entity_value || "").toLowerCase();

export function defaultRules(): EdgeRule[] {
  return [
    {
      name: "ip_cross_source",
      description: "Same IP observed by multiple tools.",
      lhs: "ipv4",
      rhs: "ipv4",
      weight: 4,
      join_key: byValue,
    },
    {
      name: "subdomain_cross_source",
      description: "Subdomain observed by multiple tools.",
      lhs: "subdomain",
      rhs: "subdomain",
      weight: 3,
      join_key: byValue,
    },
    {
      name: "crtsh_cert_to_domain",
      description: "A certificate was issued for this domain.",
      lhs: "cert",
      rhs: "domain",
      weight: 2,
      join_key: byValue,
    },
    {
      name: "ip_to_asn",
      description: "An IP is announced by an ASN.",
      lhs: "ipv4",
      rhs: "asn",
      weight: 2,
      join_key: byValue,
    },
  ];
}

export interface GraphNode {
  id: string;
  kind: string;
  value: string;
  seen_by: string[];
  rules: string[];
  attributes: Record<string, unknown>;
  first_seen: string | null;
  last_seen: string | null;
  finding_count: number;
}

export interface GraphEdge {
  id: string;
  src: string;
  dst: string;
  rule: string;
  weight: number;
  join_value: string | null;
  evidence_ids: string[];
  lhs_tool: string | null;
  rhs_tool: string | null;
  cross_source: boolean;
  created_at: string | null;
}

export interface GraphSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export class CorrelationEngine {
  constructor(private rules: EdgeRule[] = defaultRules()) {}

  /**
   * Persist the new findings, run the rules, return the new edges
   * and the persisted rows. Everything happens in one transaction.
   */
  async ingest(
    investigationId: string | null,
    findings: ToolFinding[]
  ): Promise<{ edges: GraphEdge[]; finding_count: number }> {
    if (findings.length === 0) return { edges: [], finding_count: 0 };

    return withClient(async (c) => {
      await c.query("BEGIN");
      try {
        // 1) Insert findings (one INSERT per row, parameters are
        //    simpler than a multi-VALUES + RETURNING).
        const persisted: {
          id: string;
          source_tool: string;
          entity_kind: string;
          entity_value: string;
        }[] = [];
        for (const f of findings) {
          // Pull out the lineage token if the runner attached one.
          const lineage = f.attributes?._hunt_lineage as
            | { evidence_id: string }
            | undefined;
          if (!lineage?.evidence_id) continue;
          const attrs = { ...(f.attributes || {}) };
          delete (attrs as Record<string, unknown>)._hunt_lineage;
          const r = await c.query(
            `INSERT INTO findings
               (investigation_id, evidence_id, source_tool,
                entity_kind, entity_value, attributes)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb)
             RETURNING id, source_tool, entity_kind, entity_value`,
            [
              investigationId,
              lineage.evidence_id,
              f.source_tool,
              f.entity_kind,
              f.entity_value,
              JSON.stringify(attrs),
            ]
          );
          if (r.rows.length > 0) persisted.push(r.rows[0]);
        }

        // 2) Ensure each (kind, value) entity exists, capturing IDs.
        const entCache = new Map<string, string>(); // `${kind}::${value}` -> id
        for (const f of persisted) {
          const key = `${f.entity_kind}::${f.entity_value}`;
          if (entCache.has(key)) continue;
          const id = await ensureEntity(c, f.entity_kind, f.entity_value);
          entCache.set(key, id);
        }

        // 3) Run each rule.
        const newEdges: GraphEdge[] = [];
        for (const rule of this.rules) {
          // Group persisted findings by their join key.
          const idx = new Map<string, typeof persisted>();
          for (const row of persisted) {
            if (row.entity_kind !== rule.lhs && row.entity_kind !== rule.rhs) continue;
            const k = rule.join_key({
              source_tool: row.source_tool,
              entity_kind: row.entity_kind,
              entity_value: row.entity_value,
              attributes: {},
            });
            const list = idx.get(k) ?? [];
            list.push(row);
            idx.set(k, list);
          }
          for (const [key, group] of idx.entries()) {
            if (group.length < 2) continue;
            if (rule.lhs === rule.rhs) {
              await mergeAttribution(
                c,
                group[0].entity_kind,
                group[0].entity_value,
                group.map((g) => g.source_tool),
                rule.name
              );
            } else {
              const lhs = group.filter((g) => g.entity_kind === rule.lhs);
              const rhs = group.filter((g) => g.entity_kind === rule.rhs);
              for (const l of lhs) {
                for (const r of rhs) {
                  const e = await emitEdge(
                    c,
                    rule,
                    l,
                    r,
                    key,
                    newEdges.length
                  );
                  if (e) newEdges.push(e);
                }
              }
            }
          }
        }

        // 4) Built-in: cross-tool observation.
        const byEntity = new Map<string, typeof persisted>();
        for (const row of persisted) {
          const key = `${row.entity_kind}::${row.entity_value}`;
          const list = byEntity.get(key) ?? [];
          list.push(row);
          byEntity.set(key, list);
        }
        for (const [, group] of byEntity.entries()) {
          const tools = new Set(group.map((g) => g.source_tool));
          if (tools.size >= 2) {
            await mergeAttribution(
              c,
              group[0].entity_kind,
              group[0].entity_value,
              [...tools],
              "cross_tool_observation"
            );
          }
        }

        await c.query("COMMIT");
        return { edges: newEdges, finding_count: persisted.length };
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        throw e;
      }
    });
  }

  /**
   * Rebuild the live graph from the DB. Used by /api/graph.
   */
  async snapshot(): Promise<GraphSnapshot> {
    return withClient(async (c) => {
      const entRes = await c.query(
        `SELECT id, kind, value, first_seen, last_seen, attributes
         FROM entities`
      );
      const ents = entRes.rows as {
        id: string;
        kind: string;
        value: string;
        first_seen: string;
        last_seen: string;
        attributes: Record<string, unknown>;
      }[];

      // Finding count per entity.
      const countRes = await c.query(
        `SELECT entity_kind, entity_value, COUNT(*)::int AS n
         FROM findings
         GROUP BY entity_kind, entity_value`
      );
      const countIdx = new Map<string, number>();
      for (const r of countRes.rows as {
        entity_kind: string;
        entity_value: string;
        n: number;
      }[]) {
        countIdx.set(`${r.entity_kind}::${r.entity_value}`, r.n);
      }

      const nodes: GraphNode[] = ents.map((e) => {
        const attrs = e.attributes || {};
        return {
          id: e.id,
          kind: e.kind,
          value: e.value,
          seen_by: (attrs.seen_by as string[]) ?? [],
          rules: (attrs.rules as string[]) ?? [],
          attributes: attrs,
          first_seen: e.first_seen,
          last_seen: e.last_seen,
          finding_count: countIdx.get(`${e.kind}::${e.value}`) ?? 0,
        };
      });

      const edgeRes = await c.query(
        `SELECT id, src_entity_id, dst_entity_id, rule, weight,
                evidence_ids, attributes, created_at
         FROM entity_relationships`
      );
      const edges: GraphEdge[] = (edgeRes.rows as {
        id: string;
        src_entity_id: string;
        dst_entity_id: string;
        rule: string;
        weight: number;
        evidence_ids: string[];
        attributes: Record<string, unknown>;
        created_at: string;
      }[]).map((e) => {
        const lhsTool = (e.attributes?.lhs_tool as string) ?? null;
        const rhsTool = (e.attributes?.rhs_tool as string) ?? null;
        return {
          id: e.id,
          src: e.src_entity_id,
          dst: e.dst_entity_id,
          rule: e.rule,
          weight: e.weight,
          join_value: (e.attributes?.join_value as string) ?? null,
          evidence_ids: e.evidence_ids || [],
          lhs_tool: lhsTool,
          rhs_tool: rhsTool,
          cross_source: Boolean(lhsTool && rhsTool && lhsTool !== rhsTool),
          created_at: e.created_at,
        };
      });

      return { nodes, edges };
    });
  }
}

async function ensureEntity(
  c: PoolClient,
  kind: string,
  value: string
): Promise<string> {
  const r = await c.query(
    `INSERT INTO entities (kind, value)
     VALUES ($1, $2)
     ON CONFLICT (kind, value) DO UPDATE
       SET last_seen = now()
     RETURNING id`,
    [kind, value]
  );
  return r.rows[0].id as string;
}

async function mergeAttribution(
  c: PoolClient,
  kind: string,
  value: string,
  tools: string[],
  rule: string
) {
  const entRes = await c.query(
    `SELECT id, attributes FROM entities WHERE kind = $1 AND value = $2`,
    [kind, value]
  );
  if (entRes.rows.length === 0) return;
  const id = entRes.rows[0].id as string;
  const attrs = (entRes.rows[0].attributes as Record<string, unknown>) || {};
  const seenBy = new Set<string>(((attrs.seen_by as string[]) ?? []).concat(tools));
  const rules = new Set<string>(((attrs.rules as string[]) ?? []).concat([rule]));
  await c.query(
    `UPDATE entities
     SET attributes = $1::jsonb, last_seen = now()
     WHERE id = $2`,
    [
      JSON.stringify({
        ...attrs,
        seen_by: [...seenBy].sort(),
        rules: [...rules].sort(),
      }),
      id,
    ]
  );
}

async function emitEdge(
  c: PoolClient,
  rule: EdgeRule,
  lhs: { entity_kind: string; entity_value: string; source_tool: string },
  rhs: { entity_kind: string; entity_value: string; source_tool: string },
  joinValue: string,
  order: number
): Promise<GraphEdge | null> {
  // Make sure both endpoints exist (they should — we ensured them
  // before iterating rules — but be defensive).
  const srcId = await ensureEntity(c, lhs.entity_kind, lhs.entity_value);
  const dstId = await ensureEntity(c, rhs.entity_kind, rhs.entity_value);
  if (srcId === dstId) return null;

  const ins = await c.query(
    `INSERT INTO entity_relationships
       (src_entity_id, dst_entity_id, rule, weight, evidence_ids, attributes)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
     ON CONFLICT (src_entity_id, dst_entity_id, rule) DO NOTHING
     RETURNING id, created_at`,
    [
      srcId,
      dstId,
      rule.name,
      rule.weight,
      JSON.stringify([]), // evidence_ids are filled in below by lookup
      JSON.stringify({
        join_value: joinValue,
        lhs_tool: lhs.source_tool,
        rhs_tool: rhs.source_tool,
      }),
    ]
  );
  if (ins.rows.length === 0) return null;
  return {
    id: ins.rows[0].id,
    src: srcId,
    dst: dstId,
    rule: rule.name,
    weight: rule.weight,
    join_value: joinValue,
    evidence_ids: [],
    lhs_tool: lhs.source_tool,
    rhs_tool: rhs.source_tool,
    cross_source: lhs.source_tool !== rhs.source_tool,
    created_at: ins.rows[0].created_at,
  };
}
