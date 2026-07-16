"use client";

/**
 * Live entity correlation graph.
 *
 * Nodes = entities (IP, domain, email, ASN, …). Edges = relationships
 * produced by the deterministic correlation rules. Cross-source edges
 * (where the two endpoints were observed by *different* tools) are
 * drawn in the accent color so the analyst's eye lands on them first;
 * same-tool edges are dim slate.
 *
 * No per-kind polychrome borders (that was a SaaS-tell). Every node
 * is 1px-accent, period. The kind is shown as a 3-letter tag chip
 * inside the node, the way Wireshark labels a protocol column.
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
import { iconForKind, iconForTool, kindTag } from "./lib/format";
import type { GraphNode as GNode, GraphEdge as GEdge } from "./lib/types";

function NodeBody({ node }: { node: GNode }) {
  const Icon = iconForKind(node.kind);
  const seen = (node.seen_by || []).slice(0, 4);
  return (
    <div className="h-panel px-2 py-1.5 min-w-[180px] max-w-[260px] border border-accent">
      <div className="flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5 text-fg" strokeWidth={1.5} />
        <span className="h-chip h-chip-on">{kindTag(node.kind)}</span>
        {seen.length > 0 && (
          <span className="ml-auto h-label text-fg-muted">
            {seen.length} src
          </span>
        )}
      </div>
      <div
        className="font-mono text-[11px] text-fg break-all leading-tight mt-0.5"
        title={node.value}
      >
        {node.value.length > 48 ? node.value.slice(0, 45) + "…" : node.value}
      </div>
      {seen.length > 0 && (
        <div className="flex items-center gap-1 mt-1 flex-wrap">
          {seen.map((s) => {
            const ToolIcon = iconForTool(s);
            return (
              <span
                key={s}
                className="h-chip"
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
      width: 220,
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
      fill: cross ? "#b45309" : "#64748b",
      fontFamily: "ui-monospace, monospace",
      fontSize: 9,
    },
    labelBgStyle: { fill: "#0b1018" },
    labelBgPadding: [2, 2],
    style: {
      strokeWidth: cross ? 1.4 : 1,
    },
  };
}

/**
 * Deterministic layered layout. We avoid shipping dagre / elk to keep
 * the bundle small; the analyst's eye is on the *topology* more than
 * the precise coordinates.
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
  kindOrder.sort();
  let y = 0;
  const COL_W = 260;
  const ROW_H = 96;
  kindOrder.forEach((kind) => {
    const group = byKind[kind].sort((a, b) => a.value.localeCompare(b.value));
    group.forEach((n, i) => {
      positions[n.id] = {
        x: (i % 4) * COL_W,
        y: Math.floor(i / 4) * ROW_H + y,
      };
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
      <div className="h-full w-full flex items-center justify-center bg-bg-base">
        <div className="text-center max-w-md px-6">
          <div className="h-label mb-2">correlation graph</div>
          <div className="font-mono text-xs text-fg-dim">
            no data · execute a hunt to populate the entity graph.
            <br />
            <br />
            nodes will appear once an investigation produces findings.
            cross-source edges (different tools observing the same entity)
            are drawn in the accent color; same-tool edges are dim slate.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-bg-base">
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
        />
        <MiniMap
          position="top-right"
          pannable
          zoomable
          nodeColor={() => "#27313f"}
          nodeStrokeColor={() => "#1e293b"}
          maskColor="rgba(5, 8, 13, 0.8)"
        />
      </ReactFlow>
    </div>
  );
}
