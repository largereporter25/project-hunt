"use client";

/**
 * Findings table. Sits below the command bar in the left column. One
 * row per finding, with a clickable lineage chip that opens the
 * Evidence Inspector pre-loaded with the finding's evidence row.
 */

import { useEffect, useState } from "react";
import { Search, Filter, ChevronRight } from "lucide-react";
import { useWorkstation } from "./lib/state";
import { api } from "./lib/api";
import { fmtTs, iconForTool, iconForKind, accentForKind, shortSha } from "./lib/format";
import type { Finding } from "./lib/types";

const PAGE_SIZE = 200;

export function FindingsTable() {
  const ws = useWorkstation();
  const [filter, setFilter] = useState("");
  const [toolFilter, setToolFilter] = useState<string | "">("");
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(false);

  // Re-fetch when the most recent investigation completes; we just
  // pull the latest 200 findings the server already returned in the
  // hunt response, but if the user wants more history we can call the
  // /findings endpoint.
  useEffect(() => {
    if (ws.findings.length > 0) {
      setItems(ws.findings);
      setPage(0);
    }
  }, [ws.findings]);

  const allTools = Array.from(new Set(items.map((f) => f.source_tool))).sort();

  const filtered = items.filter((f) => {
    if (toolFilter && f.source_tool !== toolFilter) return false;
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      f.entity_value.toLowerCase().includes(q) ||
      f.entity_kind.toLowerCase().includes(q) ||
      f.source_tool.toLowerCase().includes(q) ||
      shortSha(f.lineage.payload_sha256).toLowerCase().includes(q)
    );
  });

  const start = page * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const paged = filtered.slice(start, end);

  return (
    <div className="flex flex-col h-full bg-slate-950">
      <header className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-800 bg-panel-900">
        <span className="hunt-label">FINDINGS</span>
        <span className="font-mono text-[10px] text-slate-600">
          {filtered.length}/{items.length}
        </span>
        <div className="flex-1 flex items-center gap-1 ml-2">
          <Search className="w-3 h-3 text-slate-600" />
          <input
            className="flex-1 bg-transparent border-0 text-[11px] font-mono text-slate-300 placeholder-slate-600 focus:outline-none"
            placeholder="filter: ip, domain, email, sha…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <Filter className="w-3 h-3 text-slate-600" />
        <select
          className="bg-slate-950 border border-slate-800 text-[10px] font-mono text-slate-400 px-1 py-0.5 focus:outline-none"
          value={toolFilter}
          onChange={(e) => setToolFilter(e.target.value)}
        >
          <option value="">ALL TOOLS</option>
          {allTools.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </header>

      <div className="flex-1 overflow-y-auto">
        {paged.length === 0 ? (
          <div className="p-4 font-mono text-[11px] text-slate-600">
            no findings match the current filter.
          </div>
        ) : (
          <table className="w-full text-[11px] font-mono">
            <thead className="sticky top-0 bg-slate-950">
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800">
                <th className="px-2 py-1 w-24">TOOL</th>
                <th className="px-2 py-1 w-24">KIND</th>
                <th className="px-2 py-1">ENTITY</th>
                <th className="px-2 py-1 w-32">SHA-256</th>
                <th className="px-2 py-1 w-32">OBSERVED</th>
                <th className="px-2 py-1 w-4"></th>
              </tr>
            </thead>
            <tbody>
              {paged.map((f) => {
                const ToolIcon = iconForTool(f.source_tool);
                const KindIcon = iconForKind(f.entity_kind);
                const accent = accentForKind(f.entity_kind);
                return (
                  <tr
                    key={f.id}
                    className={`hunt-row cursor-pointer border-l-2 ${accent.border}`}
                    onClick={async () => {
                      // Open the inspector for this finding's evidence.
                      try {
                        const ev = await api.vault(f.lineage.evidence_id, true);
                        ws.setEvidence(ev);
                        // The drawer renders `ws.evidence` directly, so
                        // we don't need a node/edge selection to show
                        // the row. We still mark the selection so the
                        // close button works as expected.
                        ws.select({ kind: "node", id: f.id });
                      } catch (e) {
                        console.warn("failed to load evidence", e);
                      }
                    }}
                  >
                    <td className="px-2 py-1 text-slate-300">
                      <span className="inline-flex items-center gap-1">
                        <ToolIcon className="w-3 h-3" strokeWidth={1.5} />
                        {f.source_tool}
                      </span>
                    </td>
                    <td className={`px-2 py-1 ${accent.text}`}>
                      <span className="inline-flex items-center gap-1">
                        <KindIcon className="w-3 h-3" strokeWidth={1.5} />
                        {f.entity_kind}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-slate-100 break-all max-w-[28ch]">
                      {f.entity_value}
                    </td>
                    <td className="px-2 py-1 text-slate-500">
                      {shortSha(f.lineage.payload_sha256)}
                    </td>
                    <td className="px-2 py-1 text-slate-500">
                      {fmtTs(f.observed_at)}
                    </td>
                    <td className="px-2 py-1 text-slate-600">
                      <ChevronRight className="w-3 h-3" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {filtered.length > PAGE_SIZE && (
        <footer className="flex items-center gap-2 px-3 py-1 border-t border-slate-800 bg-panel-900 font-mono text-[10px] text-slate-500">
          <button
            className="hunt-chip"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            ‹ PREV
          </button>
          <span>
            page {page + 1} / {Math.ceil(filtered.length / PAGE_SIZE)}
          </span>
          <button
            className="hunt-chip"
            onClick={() =>
              setPage((p) =>
                Math.min(Math.ceil(filtered.length / PAGE_SIZE) - 1, p + 1)
              )
            }
            disabled={end >= filtered.length}
          >
            NEXT ›
          </button>
        </footer>
      )}
    </div>
  );
}
