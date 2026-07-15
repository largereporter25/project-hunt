"use client";

/**
 * Unified Ingestion Bar.
 *
 * The single point of entry for an analyst: a target field, a module
 * checklist, and a run button. Sits pinned at the top of the workstation
 * and shows the live pipeline status.
 *
 * Design rules:
 *   * 1px borders, slate-800, dense padding
 *   * no shadows, no glow, no rounded-2xl
 *   * monospaced input + monospaced status ticker
 *   * the module checklist is a *dense* multi-select with chips, not
 *     a checky SaaS grid
 */

import { useEffect, useRef, useState } from "react";
import {
  Crosshair,
  Loader2,
  ChevronDown,
  CheckSquare,
  Square,
  TerminalSquare,
} from "lucide-react";
import { useWorkstation } from "./lib/state";
import { detectKind, fmtTs } from "./lib/format";

const KIND_HINTS = ["domain", "ipv4", "email", "phone", "claim", "company_registration", "person", "org"] as const;

export function CommandBar() {
  const ws = useWorkstation();
  const [modulesOpen, setModulesOpen] = useState(true);
  const [localTarget, setLocalTarget] = useState(ws.target);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync external state -> local input when the page first loads.
  useEffect(() => setLocalTarget(ws.target), [ws.target]);

  // Auto-detect kind as the user types.
  useEffect(() => {
    const k = detectKind(localTarget);
    ws.setKind(k === "unknown" ? null : k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localTarget]);

  const isRunning = !["idle", "done", "error"].includes(ws.stage);
  const stageLabel = (() => {
    switch (ws.stage) {
      case "fetching_modules":
        return "LOADING MODULE CATALOGUE";
      case "dispatching_tools":
        return "FETCHING PAYLOADS";
      case "hashing_evidence":
        return "HASHING EVIDENCE";
      case "computing_graph":
        return "COMPUTING GRAPH LINKS";
      case "persisting":
        return "PERSISTING";
      case "done":
        return `DONE · ${ws.findings.length} FINDINGS · ${ws.graph.nodes.length} NODES · ${ws.graph.edges.length} EDGES`;
      case "error":
        return `ERROR · ${ws.lastError ?? "unknown"}`;
      default:
        return "READY";
    }
  })();

  return (
    <div className="border-b border-slate-800 bg-slate-950">
      {/* Row 1: target + run */}
      <div className="flex items-stretch gap-0">
        <div className="flex items-center gap-2 px-3 py-2 border-r border-slate-800 bg-panel-900 text-slate-500">
          <Crosshair className="w-4 h-4" strokeWidth={1.5} />
          <span className="hunt-label">TARGET</span>
        </div>
        <div className="flex-1 flex items-stretch">
          <input
            ref={inputRef}
            className="flex-1 bg-slate-950 border-0 px-3 py-2 text-base font-mono text-slate-100 placeholder-slate-700 focus:outline-none"
            placeholder="e.g. 8.8.8.8 / example.com / alice@example.com / TATA"
            value={localTarget}
            onChange={(e) => {
              const v = e.target.value;
              setLocalTarget(v);
              // Propagate to the workstation state — `runHunt` reads
              // ws.target, not localTarget, so without this line every
              // click of RUN HUNT (and every Enter keypress) was
              // hitting the "Target is empty" guard.
              ws.setTarget(v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isRunning) ws.runHunt();
            }}
            spellCheck={false}
            autoComplete="off"
          />
          <select
            className="bg-slate-950 border-l border-slate-800 px-2 text-xs font-mono text-slate-400 focus:outline-none"
            value={ws.kind ?? ""}
            onChange={(e) => ws.setKind(e.target.value || null)}
            title="Force a target kind"
          >
            <option value="">AUTO</option>
            {KIND_HINTS.map((k) => (
              <option key={k} value={k}>
                {k.toUpperCase()}
              </option>
            ))}
          </select>
          <button
            onClick={() => ws.runHunt()}
            disabled={isRunning || !localTarget.trim()}
            className="hunt-button-primary border-l border-slate-800 px-4"
          >
            {isRunning ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                EXECUTING
              </>
            ) : (
              <>
                <Crosshair className="w-3.5 h-3.5" />
                RUN HUNT
              </>
            )}
          </button>
        </div>
        <div
          className={`hidden md:flex items-center gap-2 px-3 py-2 border-l border-slate-800 font-mono text-[11px] whitespace-nowrap ${
            ws.stage === "error"
              ? "text-rose-400"
              : ws.stage === "done"
                ? "text-emerald-400"
                : "text-slate-400"
          }`}
        >
          {isRunning && <Loader2 className="w-3 h-3 animate-spin" />}
          <span>{stageLabel}</span>
        </div>
      </div>

      {/* Row 2: module checklist (collapsible) */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-t border-slate-800 bg-panel-900">
        <button
          className="flex items-center gap-1 text-[10px] uppercase tracking-[0.18em] text-slate-400 hover:text-slate-200"
          onClick={() => setModulesOpen((v) => !v)}
        >
          <ChevronDown
            className={`w-3 h-3 transition-transform ${modulesOpen ? "rotate-0" : "-rotate-90"}`}
          />
          MODULES · {ws.enabledModules.size}/{ws.modules.length || "?"}
        </button>
        <span className="text-slate-700">|</span>
        <button
          className="hunt-chip"
          onClick={() => ws.setAllModules(true)}
          title="Enable all modules"
        >
          ALL
        </button>
        <button
          className="hunt-chip"
          onClick={() => ws.setAllModules(false)}
          title="Disable all modules"
        >
          NONE
        </button>
        {ws.moduleLoadError && (
          <>
            <span className="text-slate-700">|</span>
            <span
              className="hunt-label text-rose-400"
              title={ws.moduleLoadError}
            >
              {ws.modulesFromFallback
                ? "MODULES FALLBACK"
                : "MODULES LOAD FAILED"}
            </span>
            <button
              className="hunt-chip hunt-chip-warn"
              onClick={() => ws.retryLoadModules()}
              title={ws.moduleLoadError}
            >
              RETRY
            </button>
          </>
        )}
        <span className="text-slate-700">|</span>
        <div className="flex-1 overflow-x-auto whitespace-nowrap">
          {ws.modules.map((m) => {
            const on = ws.enabledModules.has(m.name);
            return (
              <button
                key={m.name}
                onClick={() => ws.toggleModule(m.name)}
                className={`hunt-chip mr-1 ${on ? "hunt-chip-active" : ""}`}
                title={`accepts: ${m.accepts.join(", ")}\nemits: ${m.emits.join(", ")}`}
              >
                {on ? (
                  <CheckSquare className="w-3 h-3" />
                ) : (
                  <Square className="w-3 h-3" />
                )}
                {m.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Row 3: pipeline ticker (only shown if active or done-with-detail) */}
      {(isRunning || ws.stage === "done" || ws.stage === "error") && (
        <div className="flex items-center gap-2 px-3 py-1 border-t border-slate-800 bg-slate-950 font-mono text-[10px] text-slate-500 overflow-x-auto">
          <TerminalSquare className="w-3 h-3 text-slate-600 shrink-0" />
          {ws.stageLog.slice(-6).map((s, i) => (
            <span key={i} className="whitespace-nowrap">
              <span className="text-slate-600">
                [{fmtTs(new Date(s.at).toISOString())}]
              </span>{" "}
              <span
                className={
                  s.stage === "error"
                    ? "text-rose-400"
                    : s.stage === "done"
                      ? "text-emerald-400"
                      : "text-slate-300"
                }
              >
                {s.stage.toUpperCase()}
              </span>{" "}
              {s.detail && <span className="text-slate-500">{s.detail}</span>}
              {i < ws.stageLog.slice(-6).length - 1 && (
                <span className="text-slate-700"> · </span>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Row 4: per-module error strip, if any */}
      {Object.keys(ws.moduleErrors).length > 0 && (
        <div className="flex flex-wrap items-center gap-1 px-3 py-1 border-t border-slate-800 bg-rose-950/30 font-mono text-[10px]">
          <span className="hunt-label text-rose-400">MODULE ERRORS</span>
          {Object.entries(ws.moduleErrors).map(([k, v]) => (
            <span key={k} className="hunt-chip hunt-chip-warn">
              {k}: {v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
