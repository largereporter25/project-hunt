"use client";

/**
 * Keyboard shortcuts modal. Press `?` to open it.
 *
 * The active shortcuts:
 *   Enter    — run a hunt
 *   ⌘K / /  — focus the target input
 *   Esc      — clear selection
 *   ?        — toggle this modal
 *
 * No backdrop-blur, no colored icon — solid 1px border on a flat
 * dark backdrop, in keeping with the rest of the forensic-terminal
 * look.
 */

import { useEffect, useState } from "react";
import { useWorkstation } from "./lib/state";

interface Shortcut {
  keys: string;
  description: string;
}

const SHORTCUTS: Shortcut[] = [
  { keys: "Enter", description: "run a hunt" },
  { keys: "Ctrl/Cmd + K", description: "focus the target input" },
  { keys: "/", description: "focus the target input" },
  { keys: "Esc", description: "clear selection / close this modal" },
  { keys: "?", description: "toggle this help" },
  { keys: "a", description: "enable all modules" },
  { keys: "n", description: "disable all modules" },
  { keys: "r", description: "retry loading the module catalogue" },
];

export function KeyboardShortcuts() {
  const ws = useWorkstation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tgt = e.target as HTMLElement | null;
      const isTextField =
        !!tgt &&
        (tgt.tagName === "INPUT" ||
          tgt.tagName === "TEXTAREA" ||
          tgt.isContentEditable);

      if (e.key === "?" && !isTextField) {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        setOpen(false);
        if (ws.selected) ws.select(null);
        return;
      }
      if (e.key === "Escape" && ws.selected) {
        e.preventDefault();
        ws.select(null);
        return;
      }
      if (
        (e.key === "/" ||
          ((e.key === "k" || e.key === "K") &&
            (e.metaKey || e.ctrlKey))) &&
        !isTextField
      ) {
        e.preventDefault();
        const el = document.querySelector<HTMLInputElement>(
          "input[placeholder^='e.g.']"
        );
        if (el) el.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ws, open]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg-base/80"
      onClick={() => setOpen(false)}
    >
      <div
        className="h-panel min-w-[360px] max-w-[440px] p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 pb-2 border-b border-line">
          <span className="h-label">[?]</span>
          <span className="h-label">keyboard shortcuts</span>
          <button
            onClick={() => setOpen(false)}
            className="ml-auto h-button"
          >
            [close]
          </button>
        </div>
        <table className="w-full mt-3 text-[12px] font-mono">
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.keys} className="border-b border-line/60">
                <td className="py-1.5 pr-3 text-fg whitespace-nowrap">
                  <kbd className="h-key">{s.keys}</kbd>
                </td>
                <td className="py-1.5 text-fg-dim">{s.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 pt-2 border-t border-line font-mono text-[10px] text-fg-muted">
          press <span className="text-fg-dim">?</span> any time to toggle this.
        </div>
      </div>
    </div>
  );
}
