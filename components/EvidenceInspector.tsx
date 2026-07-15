"use client";

/**
 * Evidence Vault Inspector.
 *
 * Right-hand drawer that opens when the analyst clicks a node or edge
 * on the correlation graph. Displays:
 *   * the raw payload, syntax-highlighted (monospaced)
 *   * the SHA-256 provenance hash (monospaced, copyable)
 *   * the RFC 3161 timestamp + source tool
 *   * data-bleed flags, in a severe red monospaced block
 *
 * If no entity is selected we show the most recent evidence rows so
 * the drawer is never empty / dead-pixel during cold start.
 */

import { useEffect, useState } from "react";
import {
  X,
  Copy,
  Check,
  ShieldAlert,
  ShieldCheck,
  ExternalLink,
  AlertOctagon,
} from "lucide-react";
import { useWorkstation } from "./lib/state";
import { fmtTs, shortSha, iconForTool } from "./lib/format";
import { api } from "./lib/api";
import type { EvidenceRecord } from "./lib/types";

function HighlightedJSON({ value }: { value: unknown }) {
  if (value === null) return <span className="jtok-null">null</span>;
  if (typeof value === "boolean")
    return <span className="jtok-bool">{String(value)}</span>;
  if (typeof value === "number")
    return <span className="jtok-number">{String(value)}</span>;
  if (typeof value === "string")
    return <span className="jtok-string">"{value}"</span>;
  if (Array.isArray(value)) {
    return (
      <>
        {"["}
        {value.map((v, i) => (
          <div key={i} className="pl-3 border-l border-slate-800 ml-1">
            <HighlightedJSON value={v} />
            {i < value.length - 1 ? "," : ""}
          </div>
        ))}
        {"]"}
      </>
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return (
      <>
        {"{"}
        {entries.map(([k, v], i) => (
          <div key={k} className="pl-3 border-l border-slate-800 ml-1">
            <span className="jtok-key">"{k}"</span>
            {": "}
            <HighlightedJSON value={v} />
            {i < entries.length - 1 ? "," : ""}
          </div>
        ))}
        {"}"}
      </>
    );
  }
  return <span>{String(value)}</span>;
}

function CopyableHash({ sha }: { sha: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="group flex items-center gap-1.5 font-mono text-[11px] text-slate-300 hover:text-white"
      onClick={() => {
        navigator.clipboard.writeText(sha).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      title="Copy SHA-256 to clipboard"
    >
      <span className="break-all">{sha}</span>
      {copied ? (
        <Check className="w-3 h-3 text-emerald-400" />
      ) : (
        <Copy className="w-3 h-3 text-slate-600 group-hover:text-slate-400" />
      )}
    </button>
  );
}

function EvidenceRow({ record }: { record: EvidenceRecord }) {
  const ToolIcon = iconForTool(record.source_tool);
  const breached = record.data_bleed_flags && record.data_bleed_flags.length > 0;
  return (
    <div className="hunt-row p-2">
      <div className="flex items-center gap-2">
        <ToolIcon className="w-3.5 h-3.5 text-slate-400" strokeWidth={1.5} />
        <span className="hunt-label">{record.source_tool}</span>
        <span className="ml-auto font-mono text-[10px] text-slate-500">
          {fmtTs(record.created_at)}
        </span>
      </div>
      <div className="mt-1 flex items-start gap-2">
        <div className="flex-1">
          <div className="font-mono text-[10px] text-slate-500 uppercase tracking-wider">
            SHA-256
          </div>
          <CopyableHash sha={record.payload_sha256} />
        </div>
      </div>
      {breached && (
        <div className="mt-2 border border-rose-800/60 bg-rose-950/40 p-1.5 font-mono text-[10px] text-rose-300">
          <div className="flex items-center gap-1 mb-1 text-rose-200">
            <ShieldAlert className="w-3 h-3" />
            DATA BLEED · {record.data_bleed_flags!.length} flag(s)
          </div>
          {record.data_bleed_flags!.map((f, i) => (
            <div key={i} className="ml-3">
              [{f.severity.toUpperCase()}] {f.code} — {f.detail}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function EvidenceInspector() {
  const ws = useWorkstation();
  const [recent, setRecent] = useState<EvidenceRecord[]>([]);

  // Pull the most recent evidence rows for the "nothing selected" view.
  useEffect(() => {
    if (ws.selected) {
      setRecent([]);
      return;
    }
    let alive = true;
    api
      .vaultRecent(15)
      .then((r) => {
        if (alive) setRecent(r);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [ws.selected, ws.evidence]);

  const hasSelection = !!ws.selected;

  return (
    <aside className="h-full w-[420px] max-w-[50vw] border-l border-slate-800 bg-slate-950 flex flex-col">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-slate-800 bg-panel-900">
        {hasSelection ? (
          <ShieldCheck className="w-4 h-4 text-slate-400" strokeWidth={1.5} />
        ) : (
          <ShieldAlert className="w-4 h-4 text-slate-400" strokeWidth={1.5} />
        )}
        <span className="hunt-label">EVIDENCE VAULT</span>
        {hasSelection && (
          <button
            className="ml-auto text-slate-500 hover:text-slate-200"
            onClick={() => ws.select(null)}
            title="Close selection"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </header>

      {hasSelection && ws.evidence && (
        <SelectionDetail />
      )}

      {hasSelection && !ws.evidence && (
        <div className="flex-1 flex items-center justify-center text-slate-600 font-mono text-[11px] p-6 text-center">
          no evidence row attached to this selection.
          <br />
          the entity was likely materialized from multiple findings —
          click an edge to inspect a specific evidence record.
        </div>
      )}

      {!hasSelection && (
        <div className="flex-1 overflow-y-auto">
          <div className="px-3 py-2 border-b border-slate-800">
            <div className="hunt-label">RECENT</div>
            <div className="text-[11px] font-mono text-slate-500 mt-0.5">
              {ws.stats.evidence_count} records in vault · click any node or
              edge on the graph to inspect its lineage.
            </div>
          </div>
          {recent.length === 0 ? (
            <div className="p-3 font-mono text-[11px] text-slate-600">
              no evidence yet · run a hunt to populate the vault.
            </div>
          ) : (
            recent.map((r) => <EvidenceRow key={r.id} record={r} />)
          )}
        </div>
      )}
    </aside>
  );
}

function SelectionDetail() {
  const ws = useWorkstation();
  const ev = ws.evidence!;
  const ToolIcon = iconForTool(ev.source_tool);
  const breached = ev.data_bleed_flags && ev.data_bleed_flags.length > 0;

  // Build a JSON view of the payload (parsed, or text fallback).
  const payloadView =
    ev.raw_payload !== undefined && ev.raw_payload !== null
      ? ev.raw_payload
      : ev.raw_payload_text ?? null;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-3 py-2 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <ToolIcon className="w-4 h-4 text-slate-300" strokeWidth={1.5} />
          <span className="font-mono text-sm text-slate-100">
            {ev.source_tool}
          </span>
          <span className="ml-auto hunt-label">{ev.content_type ?? "raw"}</span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <KV label="CREATED" value={fmtTs(ev.created_at)} />
          <KV
            label="RFC 3161"
            value={ev.tsa_stamped_at ? fmtTs(ev.tsa_stamped_at) : "—"}
          />
          <KV label="TSA" value={ev.tsa_authority ?? "—"} mono />
          <KV label="BYTES" value={String(ev.byte_length ?? "—")} mono />
        </div>
        <div className="mt-2">
          <div className="hunt-label">SHA-256 PROVENANCE HASH</div>
          <CopyableHash sha={ev.payload_sha256} />
        </div>
      </div>

      {breached && (
        <div className="mx-3 mt-3 border border-rose-700 bg-rose-950/50 p-2 font-mono text-[11px] text-rose-200">
          <div className="flex items-center gap-1.5 mb-1">
            <AlertOctagon className="w-3.5 h-3.5" />
            <span className="uppercase tracking-wider">
              DATA BLEED · {ev.data_bleed_flags!.length} flag(s)
            </span>
          </div>
          {ev.data_bleed_flags!.map((f, i) => (
            <div key={i} className="ml-4 mt-1">
              <span className="text-rose-300">[{f.severity.toUpperCase()}]</span>{" "}
              <span className="text-rose-200">{f.code}</span>
              <div className="text-rose-400">{f.detail}</div>
            </div>
          ))}
        </div>
      )}

      <div className="px-3 py-2 border-b border-slate-800">
        <div className="hunt-label">QUERY</div>
        <pre className="font-mono text-[11px] text-slate-300 whitespace-pre-wrap break-all mt-1">
          {JSON.stringify(ev.query_params, null, 2)}
        </pre>
      </div>

      <div className="px-3 py-2">
        <div className="flex items-center gap-2 mb-1">
          <div className="hunt-label">RAW PAYLOAD</div>
          <span className="ml-auto text-[10px] font-mono text-slate-600">
            sha {shortSha(ev.payload_sha256)}
          </span>
        </div>
        <pre className="font-mono text-[10.5px] leading-snug text-slate-300 bg-slate-950 border border-slate-800 p-2 overflow-x-auto max-h-[60vh]">
          {payloadView === null ? (
            <span className="text-slate-600">payload not fetched</span>
          ) : (
            <HighlightedJSON value={payloadView} />
          )}
        </pre>
      </div>
    </div>
  );
}

function KV({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="hunt-label">{label}</div>
      <div
        className={`text-[11px] text-slate-200 ${
          mono ? "font-mono break-all" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
