"use client";

/**
 * AI Pivot panel. Calls ``/api/v1/summarize`` against the most recent
 * findings and renders the response as a tight, evidence-cited bullet
 * list. The panel is intentionally compact — it sits below the
 * CommandBar and never blocks the graph.
 *
 * The model field is rendered in monospaced text so the analyst can
 * tell at a glance whether they're looking at a real Gemini response
 * or the deterministic fallback (no API key).
 */

import { useState } from "react";
import { Sparkles, RefreshCw, Loader2 } from "lucide-react";
import { useWorkstation } from "./lib/state";
import { api } from "./lib/api";

export function AiPivot() {
  const ws = useWorkstation();
  const [summary, setSummary] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (!ws.target.trim() || ws.findings.length === 0) {
      setErr("Run a hunt first.");
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
      setModel(r.model);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border-b border-slate-800 bg-panel-900">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <Sparkles className="w-3.5 h-3.5 text-slate-400" strokeWidth={1.5} />
        <span className="hunt-label">AI PIVOT</span>
        {model && (
          <span className="font-mono text-[10px] text-slate-500">
            · {model}
          </span>
        )}
        <button
          className="hunt-button ml-auto"
          onClick={run}
          disabled={loading || ws.findings.length === 0}
        >
          {loading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
          {loading ? "SUMMARIZING" : "SUMMARIZE"}
        </button>
      </div>
      {err && (
        <div className="px-3 py-1 font-mono text-[10px] text-rose-400 border-t border-rose-900/50 bg-rose-950/30">
          {err}
        </div>
      )}
      {summary && (
        <pre className="px-3 py-2 font-mono text-[11px] text-slate-300 whitespace-pre-wrap border-t border-slate-800 max-h-48 overflow-y-auto">
          {summary}
        </pre>
      )}
    </div>
  );
}
