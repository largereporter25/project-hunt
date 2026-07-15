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
 * The handler is registered on `window` and unmounted on close so
 * multiple workstations never stack listeners.
 */

import { useEffect, useState } from "react";
import { Keyboard, X } from "lucide-react";
import { useWorkstation } from "./lib/state";

interface Shortcut {
  keys: string;
  description: string;
}

const SHORTCUTS: Shortcut[] = [
  { keys: "Enter", description: "Run a hunt" },
  { keys: "Ctrl/Cmd + K", description: "Focus the target input" },
  { keys: "/", description: "Focus the target input" },
  { keys: "Esc", description: "Clear selection / close this modal" },
  { keys: "?", description: "Toggle this help" },
];

export function KeyboardShortcuts() {
  const ws = useWorkstation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // ignore when typing in an input/textarea (except for ? and Esc)
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
        (e.key === "/" || ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey))) &&
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="hunt-panel min-w-[360px] max-w-[440px] p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
          <Keyboard className="w-4 h-4 text-slate-400" strokeWidth={1.5} />
          <span className="hunt-label">KEYBOARD SHORTCUTS</span>
          <button
            onClick={() => setOpen(false)}
            className="ml-auto text-slate-500 hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <table className="w-full mt-3 text-[12px] font-mono">
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.keys} className="border-b border-slate-800/60">
                <td className="py-1.5 pr-3 text-slate-200 whitespace-nowrap">
                  <kbd className="px-1.5 py-0.5 border border-slate-700 bg-slate-900 text-[10px] tracking-wider">
                    {s.keys}
                  </kbd>
                </td>
                <td className="py-1.5 text-slate-400">{s.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 pt-2 border-t border-slate-800 font-mono text-[10px] text-slate-600">
          press <span className="text-slate-400">?</span> any time to toggle this.
        </div>
      </div>
    </div>
  );
}
