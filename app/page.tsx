"use client";

/**
 * Project HUNT — main workstation page.
 *
 * Layout (forensic-terminal, no SaaS):
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │  CommandBar  (target prompt + module chips + pipeline)     │
 *   ├──────────────┬─────────────────────────┬───────────────────┤
 *   │  Recent      │  FindingsTable          │  EvidenceInspector│
 *   │              │                         │                   │
 *   │              ├─────────────────────────┤                   │
 *   │              │  CorrelationGraph       │                   │
 *   │              │                         │                   │
 *   ├──────────────┴─────────────────────────┴───────────────────┤
 *   │  PivotSummary (left)           │  status line (vi-style)   │
 *   └────────────────────────────────────────────────────────────┘
 *
 * The status line at the bottom mirrors a `vi`/`htop` command line.
 * Every byte of chrome is 1px-bordered, monospaced, single-accent.
 */

import { useEffect, useMemo, useState } from "react";
import { WorkstationProvider, useWorkstation } from "../components/lib/state";
import { CommandBar } from "../components/CommandBar";
import { CorrelationGraph } from "../components/CorrelationGraph";
import { EvidenceInspector } from "../components/EvidenceInspector";
import { FindingsTable } from "../components/FindingsTable";
import { PivotSummary } from "../components/PivotSummary";
import { RecentInvestigations } from "../components/RecentInvestigations";
import { ExportButton } from "../components/ExportButton";
import { KeyboardShortcuts } from "../components/KeyboardShortcuts";
import { fmtTs, shortSha } from "../components/lib/format";

function StatusLine() {
  const ws = useWorkstation();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const epoch = useMemo(() => Math.floor(now.getTime() / 1000), [now]);
  const stage = ws.stage;
  const stageText = stage.toUpperCase();
  const stageColor =
    stage === "error"
      ? "text-err"
      : stage === "done"
        ? "text-ok"
        : "text-fg-dim";
  return (
    <footer className="flex items-center gap-3 px-3 py-1 border-t border-line bg-bg-panel font-mono text-[11px] text-fg-dim whitespace-nowrap overflow-x-auto">
      <span className="text-fg">[hunt]</span>
      <span className="text-fg-muted">·</span>
      <span>
        target=<span className="text-fg">{ws.target || "—"}</span>
      </span>
      <span className="text-fg-muted">·</span>
      <span>
        modules=<span className="text-fg">{ws.enabledModules.size}</span>/
        <span className="text-fg">{ws.modules.length || "?"}</span>
      </span>
      <span className="text-fg-muted">·</span>
      <span>
        findings=<span className="text-fg">{ws.stats.finding_count}</span>
      </span>
      <span className="text-fg-muted">·</span>
      <span>
        edges=<span className="text-fg">{ws.stats.edge_count}</span>
      </span>
      <span className="text-fg-muted">·</span>
      <span>
        vault=<span className="text-fg">{ws.stats.evidence_count}</span>
      </span>
      <span className="text-fg-muted">·</span>
      <span className={stageColor}>{stageText}</span>
      {ws.lastError && (
        <>
          <span className="text-fg-muted">·</span>
          <span className="text-err" title={ws.lastError}>
            err
          </span>
        </>
      )}
      <span className="ml-auto flex items-center gap-3">
        <span>{fmtTs(now.toISOString())}</span>
        <span className="text-fg-muted">·</span>
        <span>EPOCH {epoch}</span>
        <span className="text-fg-muted">·</span>
        <span>
          {ws.findings.length > 0
            ? `last_sha=${shortSha(ws.findings[0].lineage.payload_sha256)}`
            : "last_sha=—"}
        </span>
        <span className="text-fg-muted">·</span>
        <ExportButton />
      </span>
    </footer>
  );
}

function Workstation() {
  return (
    <div className="h-screen w-screen flex flex-col bg-bg-base text-fg">
      <CommandBar />
      <div className="flex-1 flex min-h-0">
        <RecentInvestigations />
        <div className="w-[480px] min-w-[360px] max-w-[40vw] border-r border-line flex flex-col">
          <FindingsTable />
        </div>
        <div className="flex-1 min-w-0 flex flex-col">
          <CorrelationGraph />
          <PivotSummary />
        </div>
        <EvidenceInspector />
      </div>
      <StatusLine />
      <KeyboardShortcuts />
    </div>
  );
}

export default function Page() {
  return (
    <WorkstationProvider>
      <Workstation />
    </WorkstationProvider>
  );
}
