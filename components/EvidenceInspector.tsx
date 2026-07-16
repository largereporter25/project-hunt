"use client";

/**
 * Evidence Vault Inspector.
 *
 * Right-hand drawer that opens when the analyst clicks a node or
 * edge on the correlation graph. Displays:
 *   * the raw payload, single-color monospaced
 *   * the SHA-256 provenance hash, monospaced, copyable
 *   * the RFC 3161 timestamp + source tool
 *   * data-bleed flags, in a 1px red border + monochrome text
 *
 * If no entity is selected we show the most recent evidence rows so
 * the drawer is never empty / dead-pixel during cold start.
 *
 * The JSON payload is rendered in a single color (no syntax rainbow)
 * because colored JSON tokens are a code-editor SaaS tell.
 */

import { useEffect, useState } from "react";
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
          <div key={i} className="pl-3 border-l border-line ml-1">
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
          <div key={k} className="pl-3 border-l border-line ml-1">
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
      className="group flex items-center gap-1.5 font-mono text-[11px] text-fg hover:text-accent-bright"
      onClick={() => {
        navigator.clipboard.writeText(sha).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      title="copy SHA-256 to clipboard"
    >
      <span className="break-all">{sha}</span>
      <span className="h-label text-fg-muted group-hover:text-fg-dim">
        {copied ? "[COPIED]" : "[COPY]"}
      </span>
    </button>
  );
}

function EvidenceRow({ record }: { record: EvidenceRecord }) {
  const ToolIcon = iconForTool(record.source_tool);
  const breached = record.data_bleed_flags && record.data_bleed_flags.length > 0;
  return (
    <div className="h-row p-2">
      <div className="flex items-center gap-2">
        <ToolIcon className="w-3.5 h-3.5 text-fg-dim" strokeWidth={1.5} />
        <span className="h-label">{record.source_tool}</span>
        <span className="ml-auto font-mono text-[10px] text-fg-muted">
          {fmtTs(record.created_at)}
        </span>
      </div>
      <div className="mt-1 flex items-start gap-2">
        <div className="flex-1">
          <div className="h-label">sha-256</div>
          <CopyableHash sha={record.payload_sha256} />
        </div>
      </div>
      {breached && (
        <div className="mt-2 border border-err p-1.5 font-mono text-[10px] text-fg">
          <div className="flex items-center gap-1 mb-1 text-err">
            <span>data bleed · {record.data_bleed_flags!.length} flag(s)</span>
          </div>
          {record.data_bleed_flags!.map((f, i) => (
            <div key={i} className="ml-3 text-fg-dim">
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
    <aside className="h-full w-[420px] max-w-[50vw] border-l border-line bg-bg-base flex flex-col">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-line bg-bg-panel">
        <span className="h-label">evidence vault</span>
        {hasSelection && (
          <button
            className="ml-auto h-button"
            onClick={() => ws.select(null)}
            title="close selection"
          >
            [close]
          </button>
        )}
      </header>

      {hasSelection && ws.evidence && <SelectionDetail />}

      {hasSelection && !ws.evidence && (
        <div className="flex-1 flex items-center justify-center text-fg-muted font-mono text-[11px] p-6 text-center">
          no evidence row attached to this selection.
          <br />
          the entity was likely materialized from multiple findings —
          click an edge to inspect a specific evidence record.
        </div>
      )}

      {!hasSelection && (
        <div className="flex-1 overflow-y-auto">
          <div className="px-3 py-2 border-b border-line">
            <div className="h-label">recent</div>
            <div className="text-[11px] font-mono text-fg-dim mt-0.5">
              {ws.stats.evidence_count} records in vault · click any node
              or edge on the graph to inspect its lineage.
            </div>
          </div>
          {recent.length === 0 ? (
            <div className="p-3 font-mono text-[11px] text-fg-muted">
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

  const payloadView =
    ev.raw_payload !== undefined && ev.raw_payload !== null
      ? ev.raw_payload
      : ev.raw_payload_text ?? null;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-3 py-2 border-b border-line">
        <div className="flex items-center gap-2">
          <ToolIcon className="w-4 h-4 text-fg" strokeWidth={1.5} />
          <span className="font-mono text-sm text-fg">{ev.source_tool}</span>
          <span className="ml-auto h-label">{ev.content_type ?? "raw"}</span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <KV label="created" value={fmtTs(ev.created_at)} />
          <KV
            label="rfc 3161"
            value={ev.tsa_stamped_at ? fmtTs(ev.tsa_stamped_at) : "—"}
          />
          <KV label="tsa" value={ev.tsa_authority ?? "—"} mono />
          <KV label="bytes" value={String(ev.byte_length ?? "—")} mono />
        </div>
        <div className="mt-2">
          <div className="h-label">sha-256 provenance hash</div>
          <CopyableHash sha={ev.payload_sha256} />
        </div>
      </div>

      {breached && (
        <div className="mx-3 mt-3 border border-err p-2 font-mono text-[11px] text-fg">
          <div className="flex items-center gap-1.5 mb-1 text-err">
            <span className="uppercase tracking-wider">
              data bleed · {ev.data_bleed_flags!.length} flag(s)
            </span>
          </div>
          {ev.data_bleed_flags!.map((f, i) => (
            <div key={i} className="ml-4 mt-1">
              <span className="text-err">[{f.severity.toUpperCase()}]</span>{" "}
              <span>{f.code}</span>
              <div className="text-fg-dim">{f.detail}</div>
            </div>
          ))}
        </div>
      )}

      <div className="px-3 py-2 border-b border-line">
        <div className="h-label">query</div>
        <pre className="font-mono text-[11px] text-fg whitespace-pre-wrap break-all mt-1">
          {JSON.stringify(ev.query_params, null, 2)}
        </pre>
      </div>

      <div className="px-3 py-2">
        <div className="flex items-center gap-2 mb-1">
          <div className="h-label">raw payload</div>
          <span className="ml-auto text-[10px] font-mono text-fg-muted">
            sha {shortSha(ev.payload_sha256)}
          </span>
        </div>
        <pre className="font-mono text-[10.5px] leading-snug text-fg bg-bg-base border border-line p-2 overflow-x-auto max-h-[60vh]">
          {payloadView === null ? (
            <span className="text-fg-muted">payload not fetched</span>
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
      <div className="h-label">{label}</div>
      <div
        className={`text-[11px] text-fg ${
          mono ? "font-mono break-all" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
