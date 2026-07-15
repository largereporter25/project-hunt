/**
 * Loading screen for the Next.js app router. Renders while the
 * workstation page chunk is being fetched.
 *
 * The animation is intentionally subtle: a single 1px line that
 * "writes" across the bottom of the header, no spinning logos.
 */

import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <div className="h-screen w-screen bg-slate-950 text-slate-300 font-mono antialiased flex items-center justify-center">
      <div className="text-center max-w-md px-6">
        <div className="hunt-label mb-3">PROJECT HUNT · BOOT</div>
        <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          loading workstation…
        </div>
        <div className="mt-6 h-px bg-gradient-to-r from-transparent via-indigo-500/60 to-transparent animate-pulse" />
        <div className="mt-6 text-[10px] text-slate-600">
          cryptographic provenance · cross-source correlation · chain of custody
        </div>
      </div>
    </div>
  );
}
