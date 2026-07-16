"use client";

/**
 * Findings table. One row per finding, with the entity kind shown
 * as a 3-letter chip and the SHA-256 prefix beside it. Clicking a
 * row opens the Evidence Inspector pre-loaded with that finding's
 * evidence row.
 *
 * No colored left border (that was a SaaS-tell). Every row uses the
 * same single-color border, plus a "[open]" hint at the end. The
 * filter input is prefixed with a fixed ``filter:`` prompt.
 */

import { useEffect, useState } from "react";
import { useWorkstation } from "./lib/state";
import { api } from "./lib/api";
import { fmtTs, iconForTool, iconForKind, kindTag, shortSha } from "./lib/format";
import type { Finding } from "./lib/types";

const PAGE_SIZE = 200;

export function FindingsTable() {
  const ws = useWorkstation();
  const [filter, setFilter] = useState("");
  const [toolFilter, setToolFilter] = useState<string | "">("");
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<Finding[]>([]);

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
    <div className="flex flex-col h-full bg-bg-base">
      <header className="flex items-center gap-2 px-3 py-1.5 border-b border-line bg-bg-panel">
        <span className="h-label">findings</span>
        <span className="font-mono text-[10px] text-fg-muted">
          {filtered.length}/{items.length}
        </span>
        <div className="flex-1 flex items-center gap-1 ml-2">
          <span className="h-label shrink-0">filter:</span>
          <input
            className="flex-1 bg-transparent border-0 text-[11px] font-mono text-fg placeholder-fg-muted focus:outline-none"
            placeholder="ip, domain, email, sha…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <span className="h-label shrink-0">tool:</span>
        <select
          className="bg-bg-base border border-line text-[10px] font-mono text-fg-dim px-1 py-0.5 focus:outline-none"
          value={toolFilter}
          onChange={(e) => setToolFilter(e.target.value)}
        >
          <option value="">ALL</option>
          {allTools.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </header>

      <div className="flex-1 overflow-y-auto">
        {paged.length === 0 ? (
          <div className="p-4 font-mono text-[11px] text-fg-muted">
            no findings match the current filter.
          </div>
        ) : (
          <table className="w-full text-[11px] font-mono">
            <thead className="sticky top-0 bg-bg-base">
              <tr className="text-left text-[10px] uppercase tracking-widest text-fg-dim border-b border-line">
                <th className="px-2 py-1 w-24">tool</th>
                <th className="px-2 py-1 w-16">kind</th>
                <th className="px-2 py-1">entity</th>
                <th className="px-2 py-1 w-32">sha-256</th>
                <th className="px-2 py-1 w-36">observed</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((f) => {
                const ToolIcon = iconForTool(f.source_tool);
                const KindIcon = iconForKind(f.entity_kind);
                return (
                  <tr
                    key={f.id}
                    className="h-row cursor-pointer"
                    onClick={async () => {
                      try {
                        const ev = await api.vault(f.lineage.evidence_id, true);
                        ws.setEvidence(ev);
                        ws.select({ kind: "node", id: f.id });
                      } catch (e) {
                        console.warn("failed to load evidence", e);
                      }
                    }}
                  >
                    <td className="px-2 py-1 text-fg">
                      <span className="inline-flex items-center gap-1">
                        <ToolIcon className="w-3 h-3" strokeWidth={1.5} />
                        {f.source_tool}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-fg">
                      <span className="inline-flex items-center gap-1">
                        <KindIcon className="w-3 h-3" strokeWidth={1.5} />
                        <span className="h-chip">{kindTag(f.entity_kind)}</span>
                      </span>
                    </td>
                    <td className="px-2 py-1 text-fg break-all max-w-[28ch]">
                      {f.entity_value}
                    </td>
                    <td className="px-2 py-1 text-fg-dim">
                      {shortSha(f.lineage.payload_sha256)}
                    </td>
                    <td className="px-2 py-1 text-fg-dim">
                      {fmtTs(f.observed_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {filtered.length > PAGE_SIZE && (
        <footer className="flex items-center gap-2 px-3 py-1 border-t border-line bg-bg-panel font-mono text-[10px] text-fg-dim">
          <button
            className="h-chip"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            ‹ prev
          </button>
          <span>
            page {page + 1} / {Math.ceil(filtered.length / PAGE_SIZE)}
          </span>
          <button
            className="h-chip"
            onClick={() =>
              setPage((p) =>
                Math.min(Math.ceil(filtered.length / PAGE_SIZE) - 1, p + 1)
              )
            }
            disabled={end >= filtered.length}
          >
            next ›
          </button>
        </footer>
      )}
    </div>
  );
}
