/**
 * Global error boundary for the Next.js app router. Renders a
 * forensic-terminal-style error card instead of the default React
 * spinner. The user can copy the error message to clipboard and
 * `reset` to retry rendering the page.
 */

"use client";

import { useEffect } from "react";
import { AlertOctagon, RefreshCcw, Copy } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Send to console for dev. In production this would go to a
    // real telemetry endpoint; for now we just leave a breadcrumb.
    console.error("[HUNT] fatal error", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-300 font-mono antialiased min-h-screen flex items-center justify-center p-6">
        <div className="hunt-panel max-w-[560px] w-full p-5">
          <div className="flex items-center gap-2 border-b border-slate-800 pb-2 mb-3">
            <AlertOctagon
              className="w-4 h-4 text-rose-400"
              strokeWidth={1.5}
            />
            <span className="hunt-label text-rose-300">
              FATAL · WORKSTATION OFFLINE
            </span>
          </div>
          <div className="text-[12px] text-slate-200 leading-relaxed">
            Project HUNT caught an unhandled error and could not render
            the page.
          </div>
          <pre className="mt-3 px-2 py-2 bg-slate-950 border border-slate-800 text-[11px] text-slate-300 whitespace-pre-wrap break-words max-h-48 overflow-auto">
            {error.message || String(error)}
            {error.digest ? `\n\ndigest: ${error.digest}` : ""}
          </pre>
          <div className="mt-4 flex items-center gap-2">
            <button className="hunt-button-primary" onClick={reset}>
              <RefreshCcw className="w-3 h-3" />
              RETRY
            </button>
            <button
              className="hunt-button"
              onClick={() => {
                if (typeof navigator !== "undefined") {
                  navigator.clipboard
                    .writeText(
                      `${error.message}\n${error.stack ?? ""}\ndigest: ${
                        error.digest ?? "n/a"
                      }`
                    )
                    .catch(() => {});
                }
              }}
            >
              <Copy className="w-3 h-3" />
              COPY
            </button>
            <span className="ml-auto text-[10px] text-slate-600">
              the dashboard auto-reloads after a successful retry.
            </span>
          </div>
        </div>
      </body>
    </html>
  );
}
