"use client";

/**
 * Unified Ingestion Bar.
 *
 * The single point of entry for an analyst:
 *   * a target field prefixed with a fixed ``hunt>`` prompt
 *   * a module checklist rendered as bracketed keybinds
 *   * an [ EXEC ] button that fires a hunt
 *   * a one-line pipeline ticker with a blinking caret
 *
 * No lucide icons, no rounded chips, no SaaS gradient buttons.
 * Every interaction is text + keybind. Press ``?`` for the help
 * overlay.
 */

import { useEffect, useRef, useState } from "react";
import { useWorkstation } from "./lib/state";
import { detectKind, fmtTs } from "./lib/format";

const KIND_HINTS = [
  "domain",
  "ipv4",
  "email",
  "phone",
  "claim",
  "company_registration",
  "person",
  "org",
] as const;

export function CommandBar() {
  const ws = useWorkstation();
  const [modulesOpen, setModulesOpen] = useState(true);
  const [localTarget, setLocalTarget] = useState(ws.target);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setLocalTarget(ws.target), [ws.target]);

  useEffect(() => {
    const k = detectKind(localTarget);
    ws.setKind(k === "unknown" ? null : k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localTarget]);

  const isRunning = !["idle", "done", "error"].includes(ws.stage);
  const stageLabel = (() => {
    switch (ws.stage) {
      case "fetching_modules":
        return "loading module catalogue";
      case "dispatching_tools":
        return "fetching payloads";
      case "hashing_evidence":
        return "hashing evidence";
      case "computing_graph":
        return "computing graph links";
      case "persisting":
        return "persisting";
      case "done":
        return `done · ${ws.findings.length} findings · ${ws.graph.nodes.length} nodes · ${ws.graph.edges.length} edges`;
      case "error":
        return `error · ${ws.lastError ?? "unknown"}`;
      default:
        return "ready";
    }
  })();

  return (
    <div className="border-b border-line bg-bg-base">
      {/* Row 1: target prompt + execute button + status line. */}
      <div className="flex items-stretch gap-0">
        <div className="flex items-center gap-2 px-3 py-2 border-r border-line bg-bg-panel text-fg-dim">
          <span className="h-label">hunt&nbsp;&gt;</span>
        </div>
        <div className="flex-1 flex items-stretch">
          <input
            ref={inputRef}
            className="flex-1 bg-bg-base border-0 px-3 py-2 text-base font-mono text-fg placeholder-fg-muted focus:outline-none"
            placeholder="e.g. 8.8.8.8 / example.com / alice@example.com"
            value={localTarget}
            onChange={(e) => {
              const v = e.target.value;
              setLocalTarget(v);
              ws.setTarget(v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isRunning) ws.runHunt();
            }}
            spellCheck={false}
            autoComplete="off"
          />
          <select
            className="bg-bg-base border-l border-line px-2 text-xs font-mono text-fg-dim focus:outline-none"
            value={ws.kind ?? ""}
            onChange={(e) => ws.setKind(e.target.value || null)}
            title="force a target kind"
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
            className="h-button-primary border-l border-line px-4"
          >
            {isRunning ? "[ executing… ]" : "[ exec ]"}
          </button>
        </div>
        <div
          className={`hidden md:flex items-center gap-2 px-3 py-2 border-l border-line font-mono text-[11px] whitespace-nowrap ${
            ws.stage === "error"
              ? "text-err"
              : ws.stage === "done"
                ? "text-ok"
                : "text-fg-dim"
          }`}
        >
          <span>
            {isRunning ? <span className="hunt-blink">▶</span> : "·"}{" "}
            {stageLabel}
          </span>
        </div>
      </div>

      {/* Row 2: module checklist (collapsible) */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-t border-line bg-bg-panel">
        <button
          className="flex items-center gap-1 text-[10px] uppercase tracking-[0.18em] text-fg-dim hover:text-fg"
          onClick={() => setModulesOpen((v) => !v)}
        >
          <span>{modulesOpen ? "▾" : "▸"}</span>
          modules · {ws.enabledModules.size}/
          {ws.modules.length || "?"}
        </button>
        <span className="text-fg-muted">│</span>
        <button
          className="h-chip"
          onClick={() => ws.setAllModules(true)}
          title="enable all modules ([a])"
        >
          [a] all
        </button>
        <button
          className="h-chip"
          onClick={() => ws.setAllModules(false)}
          title="disable all modules ([n])"
        >
          [n] none
        </button>
        {ws.moduleLoadError && (
          <>
            <span className="text-fg-muted">│</span>
            <span
              className="h-label text-err"
              title={ws.moduleLoadError}
            >
              {ws.modulesFromFallback ? "modules: static" : "modules: load failed"}
            </span>
            <button
              className="h-chip h-chip-warn"
              onClick={() => ws.retryLoadModules()}
              title={ws.moduleLoadError}
            >
              [r] retry
            </button>
          </>
        )}
        <span className="text-fg-muted">│</span>
        <div className="flex-1 overflow-x-auto whitespace-nowrap">
          {ws.modules.map((m) => {
            const on = ws.enabledModules.has(m.name);
            return (
              <button
                key={m.name}
                onClick={() => ws.toggleModule(m.name)}
                className={`h-chip mr-1 ${on ? "h-chip-on" : ""}`}
                title={`accepts: ${m.accepts.join(", ")}\nemits: ${m.emits.join(", ")}`}
              >
                {on ? "[x]" : "[ ]"} {m.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Row 3: pipeline ticker (only when active or just done). */}
      {(isRunning || ws.stage === "done" || ws.stage === "error") && (
        <div className="flex items-center gap-2 px-3 py-1 border-t border-line bg-bg-base font-mono text-[10px] text-fg-dim overflow-x-auto">
          <span className="text-fg-muted shrink-0">ticker:</span>
          {ws.stageLog.slice(-6).map((s, i, arr) => (
            <span key={i} className="whitespace-nowrap">
              <span className="text-fg-muted">
                [{fmtTs(new Date(s.at).toISOString())}]
              </span>{" "}
              <span
                className={
                  s.stage === "error"
                    ? "text-err"
                    : s.stage === "done"
                      ? "text-ok"
                      : "text-fg"
                }
              >
                {s.stage.toUpperCase()}
              </span>{" "}
              {s.detail && <span className="text-fg-dim">{s.detail}</span>}
              {i < arr.length - 1 && <span className="text-fg-muted"> · </span>}
            </span>
          ))}
          <span className="hunt-blink">_</span>
        </div>
      )}

      {/* Row 4: per-module error strip, if any. */}
      {Object.keys(ws.moduleErrors).length > 0 && (
        <div className="flex flex-wrap items-center gap-1 px-3 py-1 border-t border-line bg-bg-base font-mono text-[10px]">
          <span className="h-label text-err">module errors</span>
          {Object.entries(ws.moduleErrors).map(([k, v]) => (
            <span key={k} className="h-chip h-chip-warn">
              {k}: {v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
