import "@xyflow/react/dist/style.css";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import type { GraphView } from "@/api/client";
import { layoutGraph, type LayoutNode, type Placement } from "@/lib/layout";

export interface SymbolRow {
  id: string;
  name: string;
  liveness: string;
}

interface DchData extends Record<string, unknown> {
  label: string;
  kind: string;
  liveness: string;
  selected: boolean;
  dimmed: boolean;
  hidden: number;
  note?: string;
  symbols?: SymbolRow[];
}

type DchNode = Node<DchData, "dch">;
type GroupNode = Node<{ label: string }, "group">;

const NODE_HEIGHT = 44;
const SYMBOL_ROW = 18;

const EDGE_STYLE: Record<string, { width: number; dash?: string; label?: boolean }> = {
  imports: { width: 1.5 },
  inherits: { width: 1.5 },
  calls: { width: 1 },
  references: { width: 1, dash: "2 3" },
  contains: { width: 1, dash: "1 4" },
  includes_router: { width: 1.5, label: true },
  mounts: { width: 1.5, label: true },
  handles: { width: 1.5, label: true },
  registers_route: { width: 1, label: true },
  depends_on: { width: 1, dash: "5 3", label: true },
};

const isDead = (liveness: string) => liveness === "dead";

function DchNodeView({ data }: NodeProps<DchNode>) {
  const dead = isDead(data.liveness);
  return (
    <div
      className={clsx(
        "rounded-md border px-3 py-2 text-xs",
        data.selected
          ? "border-accent bg-accent text-text"
          : dead
            ? "border-accent bg-accent-soft text-text"
            : "border-border bg-surface-2 text-muted",
        data.liveness === "test_only" && !data.selected && "border-dashed",
        data.dimmed && "opacity-30",
      )}
      style={{ width: "100%", height: "100%" }}
    >
      <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !border-0 !bg-muted" />
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide opacity-70">{data.kind}</span>
        <span className="truncate font-mono" title={data.label}>
          {data.label}
        </span>
        {data.hidden > 0 && <span className="ml-auto shrink-0 text-[10px] opacity-80">+{data.hidden} more</span>}
      </div>
      {data.note && <div className="mt-0.5 text-[10px] italic opacity-80">{data.note}</div>}
      {data.symbols?.map((s) => (
        <div key={s.id} className="flex items-center gap-1.5 font-mono text-[11px]" style={{ height: SYMBOL_ROW }}>
          <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", isDead(s.liveness) ? "bg-accent-hover" : "bg-muted")} />
          <span className={clsx("truncate", isDead(s.liveness) && "text-text")}>{s.name}</span>
        </div>
      ))}
      <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !border-0 !bg-muted" />
    </div>
  );
}

function GroupNodeView({ data }: NodeProps<GroupNode>) {
  return (
    <div
      className="h-full w-full rounded-lg border border-dashed border-border"
      style={{ background: "rgba(20, 18, 19, 0.55)" }}
    >
      <div className="px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-muted">{data.label}</div>
    </div>
  );
}

const nodeTypes = { dch: DchNodeView, group: GroupNodeView };

// Stable defaults: fresh `{}` props would re-run the layout effect on every render.
const NO_NOTES: Record<string, string> = {};
const NO_SYMBOLS: Record<string, SymbolRow[]> = {};

export interface GraphCanvasProps {
  graph: GraphView;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Package name per node id; nodes with the same value are drawn inside one group. */
  groupOf?: (nodeId: string) => string | null;
  notes?: Record<string, string>;
  symbols?: Record<string, SymbolRow[]>;
  dimmed?: Set<string>;
  height?: number | string;
}

function labelOf(node: GraphView["nodes"][number]): string {
  if (node.kind === "module") return node.file ?? node.name;
  return node.name;
}

function widthOf(label: string): number {
  return Math.min(300, Math.max(150, label.length * 7 + 70));
}

export function GraphCanvas({
  graph,
  selectedId,
  onSelect,
  groupOf,
  notes = NO_NOTES,
  symbols = NO_SYMBOLS,
  dimmed,
  height = 480,
}: GraphCanvasProps) {
  const [positions, setPositions] = useState<Record<string, Placement> | null>(null);
  const [failed, setFailed] = useState(false);

  const sized = useMemo(
    () =>
      graph.nodes.map((node) => {
        const label = labelOf(node);
        const rows = symbols[node.id]?.length ?? 0;
        const note = notes[node.id] ? 14 : 0;
        const group = groupOf?.(node.id) ?? undefined;
        const layoutNode: LayoutNode = {
          id: node.id,
          width: widthOf(label),
          height: NODE_HEIGHT + rows * SYMBOL_ROW + note,
          group,
        };
        return { node, label, layoutNode };
      }),
    [graph, groupOf, notes, symbols],
  );

  const groupIds = useMemo(
    () => [...new Set(sized.map((s) => s.layoutNode.group).filter((g): g is string => Boolean(g)))],
    [sized],
  );

  useEffect(() => {
    let cancelled = false;
    setPositions(null);
    setFailed(false);
    const nodeIds = new Set(graph.nodes.map((n) => n.id));
    layoutGraph(
      sized.map((s) => s.layoutNode),
      graph.edges
        .filter((e) => nodeIds.has(e.src) && nodeIds.has(e.dst))
        .map((e, index) => ({ id: `e${index}`, source: e.src, target: e.dst })),
      groupIds.map((id) => ({ id })),
    )
      .then((result) => !cancelled && setPositions(result))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [graph, sized, groupIds]);

  const focus = useMemo(() => new Set(graph.focus ?? []), [graph.focus]);

  const flowNodes = useMemo<(DchNode | GroupNode)[]>(() => {
    if (!positions) return [];
    const groups: GroupNode[] = groupIds.map((id) => ({
      id: `group:${id}`,
      type: "group",
      position: positions[id] ?? { x: 0, y: 0 },
      data: { label: id },
      style: { width: positions[id]?.width, height: positions[id]?.height },
      selectable: false,
      draggable: false,
    }));
    const nodes: DchNode[] = sized.map(({ node, label, layoutNode }) => ({
      id: node.id,
      type: "dch",
      position: positions[node.id] ?? { x: 0, y: 0 },
      parentId: layoutNode.group ? `group:${layoutNode.group}` : undefined,
      style: { width: layoutNode.width, height: layoutNode.height },
      data: {
        label,
        kind: node.kind,
        liveness: node.liveness,
        selected: node.id === selectedId || (selectedId == null && focus.has(node.id)),
        dimmed: dimmed ? dimmed.has(node.id) : false,
        hidden: graph.hidden?.[node.id] ?? 0,
        note: notes[node.id],
        symbols: symbols[node.id],
      },
    }));
    return [...groups, ...nodes];
  }, [positions, sized, groupIds, selectedId, focus, dimmed, graph.hidden, notes, symbols]);

  const flowEdges = useMemo<Edge[]>(() => {
    const nodeIds = new Set(graph.nodes.map((n) => n.id));
    return graph.edges
      .filter((e) => nodeIds.has(e.src) && nodeIds.has(e.dst))
      .map((e, index) => {
        const style = EDGE_STYLE[e.kind] ?? { width: 1 };
        const count = typeof e.attrs?.count === "number" && e.attrs.count > 1 ? ` ×${e.attrs.count}` : "";
        return {
          id: `e${index}`,
          source: e.src,
          target: e.dst,
          label: style.label ? `${e.kind}${count}` : undefined,
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "#5a5253" },
          style: { stroke: "#5a5253", strokeWidth: style.width, strokeDasharray: style.dash },
          labelStyle: { fill: "#8e8582", fontSize: 10 },
          labelBgStyle: { fill: "#0b0a0a" },
        };
      });
  }, [graph]);

  return (
    <div className="card overflow-hidden" style={{ height }}>
      {failed ? (
        <div className="flex h-full items-center justify-center text-sm text-muted">The graph could not be laid out.</div>
      ) : positions === null ? (
        <div className="flex h-full items-center justify-center text-sm text-muted">Laying out the graph…</div>
      ) : (
        <ReactFlow
          key={flowNodes.length + ":" + flowEdges.length}
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.1}
          nodesConnectable={false}
          nodesDraggable={false}
          colorMode="dark"
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, node) => node.type === "dch" && onSelect?.(node.id)}
        >
          <Background color="#2a2526" gap={24} />
          <Controls showInteractive={false} />
        </ReactFlow>
      )}
    </div>
  );
}
