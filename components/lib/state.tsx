"use client";

/**
 * Workstation state. One React context provides:
 *   * the live list of findings + the live graph snapshot
 *   * the user's most recent target + which modules are checked
 *   * a sliding drawer selection (the entity/edge currently in focus)
 *   * pipeline status ("fetching payloads", "hashing evidence", ...)
 *
 * The whole UI is a single tree under WorkstationProvider, so children
 * can subscribe to the bits they care about without prop-drilling.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "./api";
import type {
  EvidenceRecord,
  Finding,
  GraphEdge,
  GraphNode,
  GraphSnapshot,
  ModuleInfo,
  Stats,
} from "./types";

export type PipelineStage =
  | "idle"
  | "fetching_modules"
  | "dispatching_tools"
  | "hashing_evidence"
  | "computing_graph"
  | "persisting"
  | "done"
  | "error";

export interface WorkstationState {
  // inputs
  target: string;
  kind: string | null;
  enabledModules: Set<string>;

  // live data
  modules: ModuleInfo[];
  findings: Finding[];
  graph: GraphSnapshot;
  stats: Stats;
  selected: { kind: "node" | "edge"; id: string } | null;
  evidence: EvidenceRecord | null;

  // pipeline status
  stage: PipelineStage;
  stageLog: { stage: PipelineStage; at: number; detail?: string }[];
  modulesRun: string[];
  moduleErrors: Record<string, string>;
  lastError: string | null;

  // module catalogue load status — tracked separately from lastError so
  // a stale 500 from the modules fetch never taints the run pipeline.
  moduleLoadError: string | null;
  modulesFromFallback: boolean;

  // mutators
  setTarget: (t: string) => void;
  setKind: (k: string | null) => void;
  toggleModule: (name: string) => void;
  setAllModules: (on: boolean) => void;
  select: (sel: { kind: "node" | "edge"; id: string } | null) => void;
  setEvidence: (ev: EvidenceRecord | null) => void;
  runHunt: () => Promise<void>;
  refreshGraph: () => Promise<void>;
  refreshStats: () => Promise<void>;
  retryLoadModules: () => Promise<void>;
}

const Ctx = createContext<WorkstationState | null>(null);

const INITIAL_GRAPH: GraphSnapshot = { nodes: [], edges: [] };
const INITIAL_STATS: Stats = { evidence_count: 0, finding_count: 0, edge_count: 0 };

// Hard-coded fallback catalogue. If the live /api/v1/modules call
// fails twice, the dashboard installs this so the user can still type a
// target and click RUN HUNT. The list mirrors api/core/hunt/main.py
// `_TOOL_CLASSES` exactly (22 entries, 1:1).
const FALLBACK_CATALOGUE: ModuleInfo[] = [
  { name: "shodan",         accepts: ["domain", "ipv4", "ipv6"], emits: ["asn", "ipv4", "org", "url"] },
  { name: "whois",          accepts: ["domain", "email", "ipv4", "ipv6"], emits: ["asn", "domain", "email", "org", "person"] },
  { name: "dns",            accepts: ["domain"], emits: ["ipv4", "ipv6", "subdomain"] },
  { name: "hibp",           accepts: ["email"], emits: ["breach", "email"] },
  { name: "crt_sh",         accepts: ["domain"], emits: ["cert", "org", "subdomain"] },
  { name: "wayback_cdx",    accepts: ["domain", "url"], emits: ["url"] },
  { name: "virustotal",     accepts: ["domain", "hash", "ipv4", "url"], emits: ["domain", "hash", "url"] },
  { name: "greynoise",      accepts: ["ipv4"], emits: ["ipv4"] },
  { name: "ipinfo",         accepts: ["ipv4", "ipv6"], emits: ["asn", "ipv4", "org"] },
  { name: "spiderfoot",     accepts: ["domain", "email", "ipv4", "phone", "username"], emits: ["domain", "email", "ipv4", "person"] },
  { name: "theharvester",   accepts: ["domain"], emits: ["email", "ipv4", "person", "subdomain"] },
  { name: "securitytrails", accepts: ["domain"], emits: ["domain", "ipv4"] },
  { name: "maltego",        accepts: ["domain", "email", "ipv4", "person"], emits: ["domain", "email", "org", "person"] },
  { name: "factcheck",      accepts: ["claim", "domain"], emits: ["claim", "url"] },
  { name: "mca21",          accepts: ["company_registration"], emits: ["company_registration", "org", "person"] },
  { name: "nse_bse",        accepts: ["company_registration", "org"], emits: ["company_registration", "org"] },
  { name: "myneta_adr",     accepts: ["org", "person"], emits: ["org", "person"] },
  { name: "indian_kanoon",  accepts: ["court_case", "org", "person"], emits: ["court_case", "person"] },
  { name: "ecourts",        accepts: ["court_case", "person"], emits: ["court_case"] },
  { name: "tafcop",         accepts: ["phone"], emits: ["person", "phone"] },
  { name: "truecaller",     accepts: ["phone"], emits: ["person", "phone"] },
  { name: "rti_online",     accepts: ["org", "person"], emits: ["org", "person"] },
];

function _defaultEnabledFor(catalogue: ModuleInfo[]): Set<string> {
  const common = new Set<string>([
    "domain",
    "ipv4",
    "email",
    "phone",
    "claim",
    "company_registration",
  ]);
  const initial = new Set<string>();
  catalogue.forEach((mod) => {
    if (mod.accepts.some((k) => common.has(k))) initial.add(mod.name);
  });
  // Always include DNS / WHOIS / crt.sh / Wayback — the analysts'
  // most-used default modules regardless of target.
  ["dns", "whois", "crt_sh", "wayback_cdx"].forEach((n) => initial.add(n));
  return initial;
}

export function WorkstationProvider({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState("");
  const [kind, setKind] = useState<string | null>(null);
  const [enabledModules, setEnabled] = useState<Set<string>>(new Set());
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [modulesFromFallback, setModulesFromFallback] = useState(false);
  const [moduleLoadError, setModuleLoadError] = useState<string | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [graph, setGraph] = useState<GraphSnapshot>(INITIAL_GRAPH);
  const [stats, setStats] = useState<Stats>(INITIAL_STATS);
  const [selected, setSelected] = useState<{
    kind: "node" | "edge";
    id: string;
  } | null>(null);
  const [evidence, setEvidenceState] = useState<EvidenceRecord | null>(null);
  const [stage, setStage] = useState<PipelineStage>("idle");
  const [stageLog, setStageLog] = useState<
    { stage: PipelineStage; at: number; detail?: string }[]
  >([{ stage: "idle", at: Date.now() }]);
  const [modulesRun, setModulesRun] = useState<string[]>([]);
  const [moduleErrors, setModuleErrors] = useState<Record<string, string>>({});
  const [lastError, setLastError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const logStage = useCallback(
    (s: PipelineStage, detail?: string) => {
      setStage(s);
      setStageLog((prev) =>
        [...prev, { stage: s, at: Date.now(), detail }].slice(-20)
      );
    },
    []
  );

  // --- module catalogue --------------------------------------------------

  const loadModules = useCallback(async () => {
    logStage("fetching_modules");
    setModuleLoadError(null);

    const tryOnce = async () => {
      const m = await api.modules();
      setModules(m);
      setModulesFromFallback(false);
      setEnabled(_defaultEnabledFor(m));
    };

    try {
      await tryOnce();
    } catch (_firstErr) {
      // Retry once with a short delay — the dev server can take a beat
      // to warm up on the first cold start.
      await new Promise((r) => setTimeout(r, 600));
      try {
        await tryOnce();
      } catch (secondErr) {
        // Both attempts failed. Install the static fallback catalogue
        // so the user can still type a target and run a hunt. Track
        // the error in moduleLoadError (not lastError) so the run
        // pipeline's status ticker is not poisoned by a stale 500.
        const detail = String(
          (secondErr as Error)?.message ?? secondErr ?? "unknown"
        );
        setModules(FALLBACK_CATALOGUE);
        setModulesFromFallback(true);
        setEnabled(_defaultEnabledFor(FALLBACK_CATALOGUE));
        setModuleLoadError(detail);
      }
    } finally {
      // Functional setState — avoids the stale-closure read of `stage`
      // that the previous version had.
      setStage((s) => (s === "fetching_modules" ? "idle" : s));
    }
  }, [logStage]);

  useEffect(() => {
    loadModules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- graph / stats refresh -------------------------------------------

  const refreshGraph = useCallback(async () => {
    try {
      const g = await api.graph();
      setGraph(g);
    } catch (e) {
      // Don't blow up the page if the graph is temporarily empty.
      console.warn("graph refresh failed", e);
    }
  }, []);

  const refreshStats = useCallback(async () => {
    try {
      const s = await api.stats();
      setStats(s);
    } catch (e) {
      console.warn("stats refresh failed", e);
    }
  }, []);

  useEffect(() => {
    refreshGraph();
    refreshStats();
  }, [refreshGraph, refreshStats]);

  // --- selection --------------------------------------------------------

  const select = useCallback(
    (sel: { kind: "node" | "edge"; id: string } | null) => {
      setSelected(sel);
      if (!sel) {
        setEvidence(null);
        return;
      }
      // Pull the most relevant evidence row for the selection.
      if (sel.kind === "node") {
        const node = graph.nodes.find((n) => n.id === sel.id);
        const evidenceId = (node?.attributes as { evidence_id?: string } | undefined)
          ?.evidence_id;
        if (evidenceId) {
          api
            .vault(evidenceId, true)
            .then(setEvidence)
            .catch(() => setEvidence(null));
        } else {
          setEvidence(null);
        }
      } else {
        const edge = graph.edges.find((e) => e.id === sel.id);
        const evidenceIds = edge?.evidence_ids || [];
        if (evidenceIds.length > 0) {
          api
            .vault(evidenceIds[0], true)
            .then(setEvidence)
            .catch(() => setEvidence(null));
        } else {
          setEvidence(null);
        }
      }
    },
    [graph]
  );

  // --- mutators ---------------------------------------------------------

  const toggleModule = useCallback((name: string) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const setAllModules = useCallback(
    (on: boolean) => {
      setEnabled(on ? new Set(modules.map((m) => m.name)) : new Set());
    },
    [modules]
  );

  const setEvidence = useCallback((ev: EvidenceRecord | null) => {
    setSelected((prev) => (ev ? (prev ?? { kind: "node" as const, id: "" }) : prev));
    setEvidenceState(ev);
  }, []);

  // --- runHunt ----------------------------------------------------------

  const runHunt = useCallback(async () => {
    if (!target.trim()) {
      setLastError("Target is empty");
      logStage("error", "Target is empty");
      return;
    }
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLastError(null);
    setModuleErrors({});

    const moduleList = Array.from(enabledModules);
    const started = Date.now();

    logStage("dispatching_tools", `target=${target}`);
    try {
      const t0 = Date.now();
      const resp = await api.hunt({
        target,
        kind,
        modules: moduleList,
      });
      logStage("hashing_evidence", `+${Date.now() - t0}ms`);
      logStage("computing_graph");
      setFindings(resp.findings);
      setModulesRun(resp.modules_run);
      setModuleErrors(resp.module_errors);
      logStage("persisting");
      await refreshGraph();
      await refreshStats();
      logStage("done", `+${Date.now() - started}ms`);
    } catch (e) {
      logStage("error", String(e));
      setLastError(String(e));
    }
  }, [target, kind, enabledModules, logStage, refreshGraph, refreshStats]);

  const value: WorkstationState = useMemo(
    () => ({
      target,
      kind,
      enabledModules,
      modules,
      findings,
      graph,
      stats,
      selected,
      evidence,
      stage,
      stageLog,
      modulesRun,
      moduleErrors,
      lastError,
      moduleLoadError,
      modulesFromFallback,
      setTarget,
      setKind,
      toggleModule,
      setAllModules,
      select,
      setEvidence,
      runHunt,
      refreshGraph,
      refreshStats,
      retryLoadModules: loadModules,
    }),
    [
      target,
      kind,
      enabledModules,
      modules,
      findings,
      graph,
      stats,
      selected,
      evidence,
      stage,
      stageLog,
      modulesRun,
      moduleErrors,
      lastError,
      moduleLoadError,
      modulesFromFallback,
      toggleModule,
      setAllModules,
      select,
      setEvidence,
      runHunt,
      refreshGraph,
      refreshStats,
      loadModules,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkstation(): WorkstationState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWorkstation must be used inside WorkstationProvider");
  return v;
}
