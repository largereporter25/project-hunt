"use client";

/**
 * Recent investigations sidebar. Sits to the left of the main workstation
 * and lists the last 20 hunts. Clicking a row re-runs the hunt by setting
 * the target and triggering the run pipeline.
 *
 * The list is fetched from /api/v1/investigations on mount and after every
 * successful hunt (the WorkstationProvider triggers a refresh).
 */

import { useEffect } from "react";
import { History, Loader2 } from "lucide-react";
import { useWorkstation } from "./lib/state";
import { fmtTs } from "./lib/format";

export function RecentInvestigations() {
  const ws = useWorkstation();

  // Defensive refresh — the workstation state also pulls on mount, but
  // a render before the first hunt should still show the empty state
  // without errors.
  useEffect(() => {
    if (ws.recentInvestigations.length === 0) {
      ws.refreshRecentInvestigations();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = ws.recentInvestigations;
  const busy = items.length === 0 && ws.stage !== "idle";

  return (
    <aside className="h-full w-[220px] min-w-[200px] max-w-[16vw] border-r border-slate-800 bg-slate-950 flex flex-col">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-slate-800 bg-panel-900">
        <History className="w-3.5 h-3.5 text-slate-400" strokeWidth={1.5} />
        <span className="hunt-label">RECENT</span>
        <span className="ml-auto font-mono text-[10px] text-slate-600">
          {items.length}
        </span>
      </header>
      <div className="flex-1 overflow-y-auto">
        {busy ? (
          <div className="p-3 flex items-center gap-2 font-mono text-[10px] text-slate-500">
            <Loader2 className="w-3 h-3 animate-spin" />
            loading…
          </div>
        ) : items.length === 0 ? (
          <div className="p-3 font-mono text-[10px] text-slate-600">
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
                      // small delay so the input has time to update before
                      // the pipeline reads `target`.
                      setTimeout(() => ws.runHunt(), 30);
                    }}
                    className={`w-full text-left px-3 py-2 border-b border-slate-800/60 hover:bg-panel-800 transition-colors ${
                      active ? "bg-indigo-950/30" : ""
                    }`}
                    title={`re-run ${inv.target}`}
                  >
                    <div className="font-mono text-[11px] text-slate-100 break-all leading-tight">
                      {inv.target}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[9px] font-mono text-slate-500 uppercase tracking-wider">
                      <span>{fmtTs(inv.created_at)}</span>
                      <span className="text-slate-700">·</span>
                      <span>
                        {inv.finding_count}F
                      </span>
                      <span className="text-slate-700">·</span>
                      <span>
                        {inv.edge_count}E
                      </span>
                      <span className="ml-auto text-slate-600">
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
