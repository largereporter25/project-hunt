"use client";

/**
 * Export button. Downloads the current investigation (or, if no
 * investigation is selected, the latest 2000 findings) as a JSON
 * evidence bundle. The URL is built by `api.exportUrl`.
 *
 * No icon, no glow. Just a bracketed [export] keybind.
 */

import { useState } from "react";
import { api } from "./lib/api";
import { useWorkstation } from "./lib/state";

export function ExportButton() {
  const ws = useWorkstation();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function exportAll() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(api.exportUrl(), { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `hunt-bundle-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || ws.stats.evidence_count === 0;

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={exportAll}
        disabled={disabled}
        className="h-button"
        title={
          disabled
            ? "run a hunt first to populate the evidence vault."
            : "download a JSON evidence bundle."
        }
      >
        {busy ? "[ exporting… ]" : "[ export ]"}
      </button>
      {err && (
        <span className="font-mono text-[10px] text-err" title={err}>
          export failed
        </span>
      )}
    </div>
  );
}
