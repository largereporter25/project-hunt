"use client";

/**
 * Global error boundary — no SaaS "oops" card with a colored icon.
 * Just a 1px-bordered panel with the error text and a [RETRY] keybind.
 */

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[HUNT] fatal error", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-bg-base text-fg font-mono antialiased min-h-screen flex items-center justify-center p-6">
        <div className="h-panel max-w-[560px] w-full p-4">
          <div className="flex items-center gap-2 border-b border-line pb-2 mb-3">
            <span className="h-label text-err">FATAL · WORKSTATION OFFLINE</span>
          </div>
          <div className="text-[12px] text-fg leading-relaxed">
            Project HUNT caught an unhandled error and could not render the page.
          </div>
          <pre className="mt-3 px-2 py-2 bg-bg-base border border-line text-[11px] text-fg whitespace-pre-wrap break-words max-h-48 overflow-auto">
            {error.message || String(error)}
            {error.digest ? `\n\ndigest: ${error.digest}` : ""}
          </pre>
          <div className="mt-4 flex items-center gap-2">
            <button className="h-button-primary" onClick={reset}>
              [RETRY]
            </button>
            <button
              className="h-button"
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
              [COPY]
            </button>
            <span className="ml-auto text-[10px] text-fg-muted">
              dashboard auto-reloads after retry.
            </span>
          </div>
        </div>
      </body>
    </html>
  );
}
