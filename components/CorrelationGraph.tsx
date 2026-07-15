"use client";

/**
 * Live entity correlation graph.
 *
 * Nodes = entities (IP, domain, email, ASN, ...). Edges = relationships
 * produced by the deterministic correlation rules in
 * ``hunt/graph/rules.py``. Cross-source edges (where the two endpoints
 * were observed by *different* tools) are drawn solid white so the
 * analyst's eye lands on them first; same-tool edges are dotted slate.
 *
 * React Flow is the renderer. We override the default theme in
 * globals.css to match the forensic-terminal look.
 */

import { useCallback, useMemo } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type EdgeMouseHandler,
} from "reactflow";
import "reactflow/dist/style.css";
import { useWorkstation } from "./lib/state";
import { iconForKind, iconForTool } from "./lib/format";
import type { GraphNode as GNode, GraphEdge as GEdge } from "./lib/types";

// Pre-build a Lucide icon -> React component map for node renderers.
import * as Lucide from "lucide-react";

function NodeBody({ node }: { node: GNode }) {
  const Icon = iconForKind(node.kind);
  const seen = (node.seen_by || []).slice(0, 4);
  return (
    <div
      className="hunt-panel px-2 py-1.5 min-w-[160px] max-w-[260px]"
      style={{ borderColor: "#1e293b" }}
    >
      <div className="flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5 text-slate-400" strokeWidth={1.5} />
        <span className="hunt-label">{node.kind}</span>
        {seen.length > 0 && (
          <span className="ml-auto hunt-label text-slate-600">
            {seen.length} src
          </span>
        )}
      </div>
      <div
        className="font-mono text-[11px] text-slate-200 break-all leading-tight mt-0.5"
        title={node.value}
      >
        {node.value.length > 48 ? node.value.slice(0, 45) + "…" : node.value}
      </div>
      {seen.length > 0 && (
        <div className="flex items-center gap-1 mt-1">
          {seen.map((s) => {
            const ToolIcon = iconForTool(s);
            return (
              <span
                key={s}
                className="hunt-chip"
                style={{ padding: "0 3px", fontSize: "9px" }}
                title={`observed by ${s}`}
              >
                <ToolIcon className="w-2.5 h-2.5" />
                {s}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function nodeToRf(n: GNode): Node {
  return {
    id: n.id,
    position: { x: 0, y: 0 }, // layered layout below
    data: { label: <NodeBody node={n} /> },
    type: "default",
    style: {
      background: "transparent",
      border: "none",
      padding: 0,
      width: 200,
    },
  };
}

function edgeToRf(e: GEdge, idx: number): Edge {
  const cross = !!e.cross_source;
  return {
    id: e.id ?? `e-${idx}`,
    source: e.src,
    target: e.dst,
    type: "default",
    animated: false,
    className: cross ? "cross-source" : "",
    label: e.rule,
    labelStyle: {
      fill: cross ? "#e2e8f0" : "#64748b",
      fontFamily: "JetBrains Mono, monospace",
      fontSize: 9,
    },
    labelBgStyle: { fill: "#0b1018" },
    labelBgPadding: [2, 2],
    style: {
      strokeWidth: cross ? 1.5 : 1.1,
    },
  };
}

/**
 * Cheap deterministic layered layout. We do not want to ship dagre or
 * elk to keep the bundle small; the analyst's eye is on the *topology*
 * more than the precise coordinates. Nodes are arranged in a grid
 * keyed on (kind, then value hash).
 */
function layoutNodes(nodes: GNode[]): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  const kindOrder: string[] = [];
  const byKind: Record<string, GNode[]> = {};
  nodes.forEach((n) => {
    if (!byKind[n.kind]) {
      byKind[n.kind] = [];
      kindOrder.push(n.kind);
    }
    byKind[n.kind].push(n);
  });
  // Sort kinds so the most-connected ones float left.
  kindOrder.sort();
  let y = 0;
  const COL_W = 240;
  const ROW_H = 92;
  kindOrder.forEach((kind) => {
    const group = byKind[kind].sort((a, b) => a.value.localeCompare(b.value));
    group.forEach((n, i) => {
      positions[n.id] = { x: (i % 4) * COL_W, y: Math.floor(i / 4) * ROW_H + y };
    });
    y += Math.ceil(group.length / 4) * ROW_H + 24;
  });
  return positions;
}

export function CorrelationGraph() {
  const ws = useWorkstation();

  const positions = useMemo(
    () => layoutNodes(ws.graph.nodes),
    [ws.graph.nodes]
  );

  const nodes: Node[] = useMemo(
    () =>
      ws.graph.nodes.map((n) => ({
        ...nodeToRf(n),
        position: positions[n.id] ?? { x: 0, y: 0 },
      })),
    [ws.graph.nodes, positions]
  );

  const edges: Edge[] = useMemo(
    () => ws.graph.edges.map((e, i) => edgeToRf(e, i)),
    [ws.graph.edges]
  );

  const onNodeClick: NodeMouseHandler = useCallback(
    (_e, n) => ws.select({ kind: "node", id: n.id }),
    [ws]
  );
  const onEdgeClick: EdgeMouseHandler = useCallback(
    (_e, e) => ws.select({ kind: "edge", id: e.id }),
    [ws]
  );
  const onPaneClick = useCallback(() => ws.select(null), [ws]);

  if (ws.graph.nodes.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-slate-950">
        <div className="text-center max-w-md px-6">
          <div className="hunt-label mb-2">CORRELATION GRAPH</div>
          <div className="font-mono text-xs text-slate-500">
            NO DATA · execute a hunt to populate the entity graph.
            <br />
            <br />
            nodes will appear once an investigation produces findings.
            cross-source edges (different tools observing the same
            entity) are drawn solid white; same-tool edges are dotted
            slate.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-slate-950">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.1}
        maxZoom={2}
      >
        <Background color="#1e293b" gap={20} size={1} />
        <Controls
          showInteractive={false}
          position="bottom-right"
          style={{ background: "#0b1018", border: "1px solid #1e293b" }}
        />
        <MiniMap
          position="top-right"
          pannable
          zoomable
          nodeColor={() => "#475569"}
          nodeStrokeColor={() => "#1e293b"}
          maskColor="rgba(2, 6, 23, 0.7)"
        />
      </ReactFlow>
    </div>
  );
}
