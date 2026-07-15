"use client";

/**
 * Project HUNT — main workstation page.
 *
 * Layout (anti-SaaS, anti-vibecode):
 *
 *   ┌───────────────────────────────────────────────────────────┐
 *   │  TopBar · status (vault, findings, edges, build)          │
 *   ├───────────────────────────────────────────────────────────┤
 *   │  CommandBar · target / modules / pipeline ticker          │
 *   ├───────────────────────────────────────────────────────────┤
 *   │  AiPivot    (Gemini-backed pivot suggestion)              │
 *   ├──────────────────────┬────────────────────────────────────┤
 *   │  FindingsTable       │   CorrelationGraph (React Flow)    │
 *   │  ─────────────       │   ─────────────────────────────    │
 *   │                      │                                    │
 *   │                      │                                    │
 *   ├──────────────────────┴────────────────────────────────────┤
 *   │  EvidenceInspector (drawer, right side of viewport)      │
 *   └───────────────────────────────────────────────────────────┘
 *
 *   On wider screens the inspector docks to the right; on smaller
 *   screens it slides in as an overlay (still a drawer, never a
 *   modal that would hide the graph).
 */

import { useEffect, useState } from "react";
import { WorkstationProvider } from "../components/lib/state";
import { CommandBar } from "../components/CommandBar";
import { CorrelationGraph } from "../components/CorrelationGraph";
import { EvidenceInspector } from "../components/EvidenceInspector";
import { FindingsTable } from "../components/FindingsTable";
import { AiPivot } from "../components/AiPivot";
import { useWorkstation } from "../components/lib/state";
import { api } from "../components/lib/api";
import { fmtTs, shortSha } from "../components/lib/format";
import { ShieldCheck, Hash, Network, Database, Activity } from "lucide-react";
import { useMemo } from "react";
import { RecentInvestigations } from "../components/RecentInvestigations";
import { ExportButton } from "../components/ExportButton";
import { KeyboardShortcuts } from "../components/KeyboardShortcuts";

function TopBar() {
  const ws = useWorkstation();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const epoch = useMemo(() => Math.floor(now.getTime() / 1000), [now]);
  return (
    <div className="flex items-center gap-3 px-3 py-1 border-b border-slate-800 bg-slate-950 text-[11px] font-mono text-slate-500">
      <span className="flex items-center gap-1.5">
        <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
        <span className="font-semibold tracking-wider text-slate-200">
          PROJECT&nbsp;HUNT
        </span>
        <span className="text-slate-600">·</span>
        <span>v0.1.0</span>
      </span>
      <span className="text-slate-700">|</span>
      <span className="flex items-center gap-1">
        <Database className="w-3 h-3" />
        <span className="hunt-label mr-1">VAULT</span>
        <span className="text-slate-300">{ws.stats.evidence_count}</span>
      </span>
      <span className="flex items-center gap-1">
        <Hash className="w-3 h-3" />
        <span className="hunt-label mr-1">FINDINGS</span>
        <span className="text-slate-300">{ws.stats.finding_count}</span>
      </span>
      <span className="flex items-center gap-1">
        <Network className="w-3 h-3" />
        <span className="hunt-label mr-1">EDGES</span>
        <span className="text-slate-300">{ws.stats.edge_count}</span>
      </span>
      <span className="ml-auto flex items-center gap-1.5">
        <Activity
          className={`w-3 h-3 ${
            ws.stage === "error"
              ? "text-rose-400"
              : ws.stage === "done"
                ? "text-emerald-400"
                : "text-slate-500"
          }`}
        />
        <span className="text-slate-300">
          {fmtTs(now.toISOString())}
        </span>
        <span className="text-slate-600">·</span>
        <span className="text-slate-500">EPOCH {epoch}</span>
        <span className="text-slate-700">|</span>
        <ExportButton />
      </span>
    </div>
  );
}

function Workstation() {
  return (
    <div className="h-screen w-screen flex flex-col bg-slate-950 text-slate-300">
      <TopBar />
      <CommandBar />
      <AiPivot />
      <div className="flex-1 flex min-h-0">
        <RecentInvestigations />
        {/* Left column: findings table */}
        <div className="w-[480px] min-w-[360px] max-w-[40vw] border-r border-slate-800">
          <FindingsTable />
        </div>
        {/* Centre: correlation graph */}
        <div className="flex-1 min-w-0">
          <CorrelationGraph />
        </div>
        {/* Right: evidence vault inspector */}
        <EvidenceInspector />
      </div>
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
