"use client";

/**
 * Pivot suggestions panel. Calls ``/api/v1/summarize`` against the
 * most recent findings and renders the response as a tight,
 * evidence-cited bullet list. Compact, sits to the side, never
 * blocks the graph.
 *
 * Renamed from ``AiPivot`` to ``PivotSummary`` to drop the AI-SaaS
 * tell. The Gemini endpoint behind it is unchanged; this is purely
 * a UI rename + restyle. The label is "PIVOT SUGGESTIONS" so the
 * analyst can see at a glance what the panel does.
 */

import { useState } from "react";
import { useWorkstation } from "./lib/state";
import { api } from "./lib/api";

export function PivotSummary() {
  const ws = useWorkstation();
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (!ws.target.trim() || ws.findings.length === 0) {
      setErr("run a hunt first.");
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const r = await api.summarize({
        target: ws.target,
        findings: ws.findings.slice(0, 40),
      });
      setSummary(r.summary);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-panel border-t border-line">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-line">
        <span className="h-label">PIVOT SUGGESTIONS</span>
        <button
          className="h-button ml-auto"
          onClick={run}
          disabled={loading || ws.findings.length === 0}
          title="generate pivot suggestions for the most recent findings"
        >
          {loading ? "[ generating… ]" : "[ generate ]"}
        </button>
      </div>
      {err && (
        <div className="px-3 py-1 font-mono text-[10px] text-err border-t border-err/50">
          {err}
        </div>
      )}
      {summary && (
        <pre className="px-3 py-2 font-mono text-[11px] text-fg whitespace-pre-wrap border-t border-line max-h-48 overflow-y-auto">
          {summary}
        </pre>
      )}
    </div>
  );
}
