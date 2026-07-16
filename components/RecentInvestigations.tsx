"use client";

/**
 * Recent investigations sidebar.
 *
 * Renders the most recent hunts as a tight ls-style list. No
 * indigo tint on the active row (the SaaS-tell). The active row
 * is marked with a leading `>` prompt, the way a shell highlights
 * the current selection.
 */

import { useEffect } from "react";
import { useWorkstation } from "./lib/state";
import { fmtTs } from "./lib/format";

export function RecentInvestigations() {
  const ws = useWorkstation();

  useEffect(() => {
    if (ws.recentInvestigations.length === 0) {
      ws.refreshRecentInvestigations();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = ws.recentInvestigations;
  const busy = items.length === 0 && ws.stage !== "idle";

  return (
    <aside className="h-full w-[240px] min-w-[200px] max-w-[16vw] border-r border-line bg-bg-base flex flex-col">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-line bg-bg-panel">
        <span className="h-label"># recent</span>
        <span className="ml-auto font-mono text-[10px] text-fg-muted">
          {items.length}
        </span>
      </header>
      <div className="flex-1 overflow-y-auto">
        {busy ? (
          <div className="p-3 flex items-center gap-2 font-mono text-[10px] text-fg-dim">
            <span className="hunt-blink">›</span> loading…
          </div>
        ) : items.length === 0 ? (
          <div className="p-3 font-mono text-[10px] text-fg-muted">
            no investigations yet.
            <br />
            <br />
            run a hunt to populate this list.
          </div>
        ) : (
          <ul>
            {items.map((inv) => {
              const active = ws.target.trim() === inv.target.trim();
              return (
                <li key={inv.id}>
                  <button
                    onClick={() => {
                      ws.setTarget(inv.target);
                      ws.setKind(inv.kind ?? null);
                      setTimeout(() => ws.runHunt(), 30);
                    }}
                    className={`w-full text-left px-3 py-2 border-b border-line/60 hover:bg-bg-row transition-colors ${
                      active ? "bg-bg-panel" : ""
                    }`}
                    title={`re-run ${inv.target}`}
                  >
                    <div className="font-mono text-[11px] text-fg break-all leading-tight">
                      {active ? (
                        <span className="text-accent-bright">&gt; </span>
                      ) : (
                        <span className="text-fg-muted">  </span>
                      )}
                      {inv.target}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[9px] font-mono text-fg-muted uppercase tracking-wider">
                      <span>{fmtTs(inv.created_at)}</span>
                      <span className="text-fg-muted">·</span>
                      <span>{inv.finding_count}F</span>
                      <span className="text-fg-muted">·</span>
                      <span>{inv.edge_count}E</span>
                      <span className="ml-auto text-fg-muted">
                        {inv.duration_ms}ms
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
