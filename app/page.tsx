"use client";

/**
 * Project HUNT — single-pane terminal.
 *
 * One prompt, one scrolling text view, no panels. Commands:
 *   help              show this help
 *   modules           list the tool catalogue
 *   findings          show last 50 findings
 *   graph             show the live entity graph
 *   stats             show counters
 *   vault             show last 20 evidence rows
 *   investigations    show recent investigations
 *   export            download the latest bundle as JSON
 *   clear             clear the output
 *   <target>          run a hunt against the target
 *
 * Anything else is treated as a target. The view is just a <pre> —
 * no chips, no borders, no icons, no SaaS chrome.
 */

import { useEffect, useRef, useState } from "react";

type Line =
  | { kind: "cmd"; text: string }
  | { kind: "out"; text: string }
  | { kind: "err"; text: string }
  | { kind: "blank" };

const HELP_TEXT = [
  "help              show this help",
  "modules           list available osint tools",
  "findings          show last 50 findings",
  "graph             show the live entity graph",
  "stats             show counters",
  "vault             show last 20 evidence rows",
  "investigations    show recent investigations",
  "export            download the latest bundle as json",
  "clear             clear the output",
  "",
  "<target>          run a hunt against the target",
  "                  e.g. example.com, 8.8.8.8, alice@example.com",
  "                  +91xxxxxxxxxx",
].join("\n");

const BANNER =
  "─────────────────────────────────────────────────\n" +
  "project hunt // osint workstation\n" +
  "type 'help' for commands\n" +
  "─────────────────────────────────────────────────";

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + " ".repeat(n - s.length);
}

function fmtTs(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`
  );
}

function shortSha(s: string | null | undefined, n = 12): string {
  if (!s) return "—";
  return s.slice(0, n);
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
  }
  return (await r.json()) as T;
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
  }
  return (await r.json()) as T;
}

interface HuntResp {
  investigation_id: string;
  target: string;
  kind: string | null;
  findings: Array<{
    id?: string;
    source_tool: string;
    entity_kind: string;
    entity_value: string;
    attributes: Record<string, unknown>;
    lineage?: { evidence_id?: string; payload_sha256?: string; tsa_trusted?: boolean; tsa_authority?: string | null };
  }>;
  modules_run: string[];
  module_errors: Record<string, string>;
  duration_ms: number;
}

interface ModuleInfo {
  name: string;
  accepts: string[];
  emits: string[];
  key_required: boolean;
  key_present: boolean;
  docs_url?: string;
  description: string;
}

interface FindingView {
  id: string;
  source_tool: string;
  entity_kind: string;
  entity_value: string;
  attributes: Record<string, unknown>;
  observed_at: string | null;
  lineage: {
    payload_sha256: string;
    tsa_authority: string | null;
    tsa_stamped_at: string | null;
    tsa_trusted: boolean;
  };
}

interface GraphNode {
  id: string;
  kind: string;
  value: string;
  seen_by: string[];
  rules: string[];
  finding_count: number;
}

interface GraphEdge {
  id: string;
  src: string;
  dst: string;
  rule: string;
  weight: number;
  join_value: string | null;
  cross_source: boolean;
}

interface VaultSummary {
  id: string;
  source_tool: string;
  payload_sha256: string;
  tsa_authority: string | null;
  tsa_trusted: boolean;
  created_at: string;
}

interface InvestigationSummary {
  id: string;
  target: string;
  kind: string | null;
  finding_count: number;
  edge_count: number;
  duration_ms: number;
  created_at: string;
}

interface StatsResp {
  investigation_count: number;
  evidence_count: number;
  finding_count: number;
  edge_count: number;
  entity_count: number;
}

function renderModules(mods: ModuleInfo[]): string {
  const lines: string[] = [];
  lines.push(pad("name", 16) + pad("accepts", 22) + pad("emits", 22) + "status");
  lines.push("─".repeat(76));
  for (const m of mods) {
    const status = m.key_required
      ? m.key_present
        ? "on (key set)"
        : "key required"
      : "on (free)";
    lines.push(
      pad(m.name, 16) +
        pad(m.accepts.join(","), 22) +
        pad(m.emits.join(","), 22) +
        status
    );
  }
  return lines.join("\n");
}

function renderHunt(resp: HuntResp): string {
  const lines: string[] = [];
  const inferred = resp.kind ?? "(auto)";
  lines.push(`TARGET ${resp.target}  (${inferred})`);
  lines.push("─".repeat(60));

  // Group findings by source_tool.
  const byTool = new Map<string, HuntResp["findings"]>();
  for (const f of resp.findings) {
    const list = byTool.get(f.source_tool) ?? [];
    list.push(f);
    byTool.set(f.source_tool, list);
  }
  for (const t of resp.modules_run) {
    const toolFindings = byTool.get(t) ?? [];
    const real = toolFindings.filter((f) => !f.attributes?.module_error);
    const errs = toolFindings.filter((f) => f.attributes?.module_error);
    const tag = real.length === 0 && errs.length === 0 ? "— skipped" : `${real.length} records`;
    lines.push(`[${t.toUpperCase()}]  ${tag}`);
    if (real.length > 0) {
      for (const f of real.slice(0, 8)) {
        const attr = formatAttrs(f.attributes);
        const val = f.entity_value || "(empty)";
        lines.push("         " + pad(f.entity_kind, 10) + val + (attr ? "  " + attr : ""));
      }
      if (real.length > 8) {
        lines.push(`         … +${real.length - 8} more`);
      }
    }
    if (errs.length > 0) {
      for (const f of errs) {
        const code = f.attributes.module_error;
        const msg = f.attributes.message || "";
        lines.push(`         ! ${code}${msg ? ": " + String(msg).slice(0, 80) : ""}`);
      }
    }
  }

  const errors = Object.entries(resp.module_errors).filter(
    ([k]) => k !== "correlation"
  );
  if (errors.length > 0) {
    lines.push("─".repeat(60));
    lines.push("ERRORS");
    for (const [k, v] of errors) lines.push(`  ${k}: ${String(v).slice(0, 100)}`);
  }

  lines.push("─".repeat(60));
  const ok = resp.findings.filter((f) => !f.attributes?.module_error).length;
  lines.push(
    `SUMMARY  ${ok} findings · ${resp.modules_run.length} tools · ` +
      `${resp.duration_ms}ms · vault=${resp.findings.length} entries`
  );
  return lines.join("\n");
}

function renderFindings(rows: FindingView[]): string {
  if (rows.length === 0) return "(no findings yet — run a hunt first)";
  const lines: string[] = [];
  lines.push(pad("tool", 16) + pad("kind", 12) + pad("value", 36) + "sha");
  lines.push("─".repeat(80));
  for (const f of rows.slice(0, 50)) {
    const val =
      f.entity_value.length > 34 ? f.entity_value.slice(0, 33) + "…" : f.entity_value;
    lines.push(
      pad(f.source_tool, 16) +
        pad(f.entity_kind, 12) +
        pad(val, 36) +
        shortSha(f.lineage?.payload_sha256, 12)
    );
  }
  return lines.join("\n");
}

function renderGraph(graph: { nodes: GraphNode[]; edges: GraphEdge[] }): string {
  const lines: string[] = [];
  if (graph.nodes.length === 0) {
    return "(empty graph — run a hunt first)";
  }
  lines.push("NODES");
  for (const n of graph.nodes.slice(0, 50)) {
    const seen = n.seen_by.length > 0 ? `  seen_by: ${n.seen_by.join(",")}` : "";
    lines.push(`  ${pad(n.kind, 10)} ${n.value}  (${n.finding_count}F)${seen}`);
  }
  if (graph.edges.length > 0) {
    lines.push("EDGES");
    const idx = new Map(graph.nodes.map((n) => [n.id, n]));
    for (const e of graph.edges.slice(0, 50)) {
      const src = idx.get(e.src)?.value ?? e.src.slice(0, 8);
      const dst = idx.get(e.dst)?.value ?? e.dst.slice(0, 8);
      const x = e.cross_source ? " *cross-source*" : "";
      lines.push(`  ${pad(src, 28)} <─[${e.rule}]─> ${dst}  w=${e.weight}${x}`);
    }
  }
  return lines.join("\n");
}

function renderVault(rows: VaultSummary[]): string {
  if (rows.length === 0) return "(empty vault)";
  const lines: string[] = [];
  lines.push(pad("tool", 16) + pad("sha256", 16) + pad("tsa", 20) + "trusted");
  lines.push("─".repeat(72));
  for (const v of rows.slice(0, 20)) {
    const tsa = v.tsa_authority ? v.tsa_authority.replace(/^https?:\/\//, "") : "—";
    lines.push(
      pad(v.source_tool, 16) +
        pad(v.payload_sha256.slice(0, 14), 16) +
        pad(tsa.slice(0, 18), 20) +
        (v.tsa_trusted ? "yes" : "no")
    );
  }
  return lines.join("\n");
}

function renderInvestigations(rows: InvestigationSummary[]): string {
  if (rows.length === 0) return "(no investigations yet)";
  const lines: string[] = [];
  lines.push(pad("target", 32) + pad("findings", 10) + pad("edges", 8) + "when");
  lines.push("─".repeat(72));
  for (const i of rows.slice(0, 20)) {
    const tgt = i.target.length > 30 ? i.target.slice(0, 29) + "…" : i.target;
    lines.push(
      pad(tgt, 32) +
        pad(String(i.finding_count), 10) +
        pad(String(i.edge_count), 8) +
        fmtTs(i.created_at)
    );
  }
  return lines.join("\n");
}

function renderStats(s: StatsResp): string {
  return [
    `investigations : ${s.investigation_count}`,
    `evidence       : ${s.evidence_count}`,
    `findings       : ${s.finding_count}`,
    `edges          : ${s.edge_count}`,
    `entities       : ${s.entity_count}`,
  ].join("\n");
}

function formatAttrs(a: Record<string, unknown>): string {
  // Pick the most useful attribute for a one-liner.
  const interesting = [
    "record_type",
    "host",
    "issuer",
    "status",
    "city",
    "country",
    "deep_link",
  ];
  for (const k of interesting) {
    const v = a?.[k];
    if (v) return `${k}=${String(v).slice(0, 40)}`;
  }
  return "";
}

export default function Terminal() {
  const [lines, setLines] = useState<Line[]>([
    { kind: "out", text: BANNER },
    { kind: "blank" },
  ]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [hIndex, setHIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Always keep input focused; refocus after every keystroke / busy flip.
  useEffect(() => {
    inputRef.current?.focus();
  }, [busy, lines.length]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  const push = (line: Line) => setLines((prev) => [...prev, line]);

  const run = async (raw: string) => {
    const cmd = raw.trim();
    push({ kind: "cmd", text: `$ hunt> ${cmd}` });
    if (!cmd) {
      push({ kind: "blank" });
      return;
    }
    setHistory((h) => [...h, cmd].slice(-100));
    setHIndex(null);

    const lower = cmd.toLowerCase();
    if (lower === "clear" || lower === "cls") {
      setLines([{ kind: "out", text: BANNER }, { kind: "blank" }]);
      setInput("");
      return;
    }
    if (lower === "help" || lower === "?") {
      push({ kind: "out", text: HELP_TEXT });
      push({ kind: "blank" });
      setInput("");
      return;
    }

    setBusy(true);
    try {
      if (lower === "modules") {
        const m = await getJson<ModuleInfo[]>("/api/modules");
        push({ kind: "out", text: renderModules(m) });
      } else if (lower === "findings") {
        const f = await getJson<FindingView[]>("/api/findings?limit=50");
        push({ kind: "out", text: renderFindings(f) });
      } else if (lower === "graph") {
        const g = await getJson<{ nodes: GraphNode[]; edges: GraphEdge[] }>(
          "/api/graph"
        );
        push({ kind: "out", text: renderGraph(g) });
      } else if (lower === "stats") {
        const s = await getJson<StatsResp>("/api/stats");
        push({ kind: "out", text: renderStats(s) });
      } else if (lower === "vault") {
        const v = await getJson<VaultSummary[]>("/api/vault?limit=20");
        push({ kind: "out", text: renderVault(v) });
      } else if (lower === "investigations") {
        const invs = await getJson<InvestigationSummary[]>(
          "/api/investigations?limit=20"
        );
        push({ kind: "out", text: renderInvestigations(invs) });
      } else if (lower === "export") {
        window.location.href = "/api/export";
        push({ kind: "out", text: "(downloading json bundle…)" });
      } else {
        // Treat as a target.
        const resp = await postJson<HuntResp>("/api/hunt", {
          target: cmd,
          modules: null,
        });
        push({ kind: "out", text: renderHunt(resp) });
      }
    } catch (e) {
      push({ kind: "err", text: `! ${String(e).slice(0, 200)}` });
    } finally {
      push({ kind: "blank" });
      setBusy(false);
      setInput("");
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (busy) return;
      void run(input);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;
      const next = hIndex === null ? history.length - 1 : Math.max(0, hIndex - 1);
      setHIndex(next);
      setInput(history[next]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (hIndex === null) return;
      const next = hIndex + 1;
      if (next >= history.length) {
        setHIndex(null);
        setInput("");
      } else {
        setHIndex(next);
        setInput(history[next]);
      }
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      setLines([{ kind: "out", text: BANNER }, { kind: "blank" }]);
    }
  };

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      style={{
        height: "100vh",
        width: "100vw",
        display: "flex",
        flexDirection: "column",
        padding: "12px 16px",
        cursor: "text",
      }}
    >
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          fontSize: 12,
          lineHeight: 1.45,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {lines.map((l, i) => {
          if (l.kind === "blank") return <div key={i}>&nbsp;</div>;
          const color =
            l.kind === "cmd"
              ? "#b45309"
              : l.kind === "err"
                ? "#dc2626"
                : "#cbd5e1";
          return (
            <div key={i} style={{ color }}>
              {l.text}
            </div>
          );
        })}
        <div style={{ display: "flex", alignItems: "center" }}>
          <span style={{ color: "#b45309" }}>$ hunt&gt;&nbsp;</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            disabled={busy}
            spellCheck={false}
            autoComplete="off"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              color: "#cbd5e1",
              font: "inherit",
              caretColor: "#b45309",
              outline: "none",
              padding: 0,
            }}
          />
          {busy && (
            <span className="hunt-blink" style={{ color: "#94a3b8" }}>
              ▌
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
