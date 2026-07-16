/**
 * Boot screen — while the workstation page chunk is being fetched.
 *
 * Pure ASCII. No spinner, no gradient bar, no logo. A blinking
 * caret is the only motion.
 */
export default function Loading() {
  return (
    <div className="h-screen w-screen bg-bg-base text-fg font-mono flex items-center justify-center">
      <div className="max-w-md w-full px-6">
        <div className="h-label mb-3">project hunt // boot</div>
        <div className="text-xs text-fg-dim">
          loading workstation
          <span className="hunt-blink">_</span>
        </div>
        <div className="mt-6 h-px bg-line hunt-step" />
        <div className="mt-6 text-[10px] text-fg-muted uppercase tracking-widest">
          sha-256 · rfc3161 · chain of custody
        </div>
      </div>
    </div>
  );
}
