"use client";

/**
 * Export button. Downloads the current investigation (or, if no
 * investigation is selected, the latest 2000 findings) as a JSON
 * evidence bundle. The URL is built by `api.exportUrl`.
 *
 * Browser-only — we open a new tab and let the browser handle the
 * download. The file is timestamped so multiple exports never collide.
 */

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
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
    <div className="flex items-center gap-1.5">
      <button
        onClick={exportAll}
        disabled={disabled}
        className="hunt-button"
        title={
          disabled
            ? "Run a hunt first to populate the evidence vault."
            : "Download a JSON evidence bundle."
        }
      >
        {busy ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <Download className="w-3 h-3" />
        )}
        EXPORT
      </button>
      {err && (
        <span className="font-mono text-[10px] text-rose-400" title={err}>
          export failed
        </span>
      )}
    </div>
  );
}
