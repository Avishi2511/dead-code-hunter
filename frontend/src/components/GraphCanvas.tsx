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
import { kindIcon } from "@/lib/icons";
import { layoutGraph, type LayoutNode, type Placement } from "@/lib/layout";

export interface SymbolRow {
  id: string;
  name: string;
  liveness: string;
}

interface DchData extends Record<string, unknown> {
  label: string;
  title: string;
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

const NODE_HEIGHT = 48;
const SYMBOL_ROW = 22;
const EDGE_IDLE = "#4a4244";
const EDGE_ACTIVE = "#a8a09c";
const EDGE_DEAD = "#b84a5b";

const isDead = (liveness: string) => liveness === "dead";

function DchNodeView({ data }: NodeProps<DchNode>) {
  const dead = isDead(data.liveness);
  const Icon = kindIcon(data.kind);
  return (
    <div
      className={clsx(
        "flex h-full w-full flex-col justify-center border px-3 text-[14px] transition-opacity",
        // Living modules are plain slabs; dead and suspicious ones are tombstones.
        dead || data.selected ? "rounded-b-md rounded-t-[26px]" : "rounded-md",
        data.selected
          ? "border-accent-hover bg-accent text-text"
          : dead
            ? "border-accent-hover/80 bg-accent-soft text-text shadow-[0_0_14px_rgba(122,30,44,0.35)]"
            : "border-[#3b3435] bg-[#161314] text-[#c9c0bb]",
        data.liveness === "test_only" && !data.selected && "border-dashed",
        data.dimmed && "opacity-25",
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-1 !w-1 !min-w-0 !border-0 !bg-transparent" />
      <div className="flex items-center gap-2">
        <span
          className={clsx(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
            data.selected ? "bg-black/25" : dead ? "bg-accent/70" : "bg-[#241f20]",
          )}
        >
          <Icon size={15} strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1 truncate font-mono" title={data.title}>
          {data.label}
        </span>
        {data.hidden > 0 && <span className="shrink-0 text-[10px] opacity-70">+{data.hidden}</span>}
      </div>
      {data.note && <div className="mt-0.5 pl-9 text-[11px] italic text-[#e3a0aa]">{data.note}</div>}
      {data.symbols?.map((s) => (
        <div key={s.id} className="flex items-center gap-1.5 pl-9 font-mono text-[12px]" style={{ height: SYMBOL_ROW }}>
          <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", isDead(s.liveness) ? "bg-accent-hover" : "bg-muted")} />
          <span className={clsx("truncate", isDead(s.liveness) ? "text-text" : "opacity-80")}>{s.name}</span>
        </div>
      ))}
      <Handle type="source" position={Position.Right} className="!h-1 !w-1 !min-w-0 !border-0 !bg-transparent" />
    </div>
  );
}

function GroupNodeView({ data }: NodeProps<GroupNode>) {
  return (
    <div className="h-full w-full rounded-xl border border-dashed border-[#2f292a]" style={{ background: "rgba(20, 18, 19, 0.45)" }}>
      <div className="px-3 py-1.5 font-mono text-[12px] uppercase tracking-[0.15em] text-muted">{data.label}</div>
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
  showLegend?: boolean;
  /** Draw relationship names on every edge instead of only on the highlighted ones. */
  labelAllEdges?: boolean;
}

function labelOf(node: GraphView["nodes"][number]): string {
  if (node.kind !== "module") return node.name;
  const parts = (node.file ?? node.name).split("/");
  const base = parts[parts.length - 1];
  return base.startsWith("__") && parts.length > 1 ? `${parts[parts.length - 2]}/${base}` : base;
}

function widthOf(label: string): number {
  return Math.min(300, Math.max(150, label.length * 8.6 + 72));
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
  showLegend = true,
  labelAllEdges = false,
}: GraphCanvasProps) {
  const [positions, setPositions] = useState<Record<string, Placement> | null>(null);
  const [failed, setFailed] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);

  const sized = useMemo(
    () =>
      graph.nodes.map((node) => {
        const label = labelOf(node);
        const rows = symbols[node.id]?.length ?? 0;
        const layoutNode: LayoutNode = {
          id: node.id,
          width: widthOf(label),
          height: NODE_HEIGHT + rows * SYMBOL_ROW + (notes[node.id] ? 14 : 0),
          group: groupOf?.(node.id) ?? undefined,
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
  const active = hovered ?? selectedId ?? null;
  const deadIds = useMemo(() => new Set(graph.nodes.filter((n) => isDead(n.liveness)).map((n) => n.id)), [graph.nodes]);

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
      zIndex: -1,
    }));
    const nodes: DchNode[] = sized.map(({ node, label, layoutNode }) => ({
      id: node.id,
      type: "dch",
      position: positions[node.id] ?? { x: 0, y: 0 },
      parentId: layoutNode.group ? `group:${layoutNode.group}` : undefined,
      style: { width: layoutNode.width, height: layoutNode.height },
      data: {
        label,
        title: node.file ?? node.name,
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
        const lit = active !== null && (e.src === active || e.dst === active);
        const toDead = deadIds.has(e.dst) || deadIds.has(e.src);
        const color = lit ? (toDead ? EDGE_DEAD : EDGE_ACTIVE) : toDead ? "#6b3a44" : EDGE_IDLE;
        const count = typeof e.attrs?.count === "number" && e.attrs.count > 1 ? ` ×${e.attrs.count}` : "";
        return {
          id: `e${index}`,
          source: e.src,
          target: e.dst,
          label: lit || labelAllEdges ? `${e.kind.replace(/_/g, " ")}${count}` : undefined,
          markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color },
          style: {
            stroke: color,
            strokeWidth: lit ? 1.8 : 1.1,
            opacity: active === null || lit ? 1 : 0.35,
          },
          labelStyle: { fill: "#c9c0bb", fontSize: 12 },
          labelBgStyle: { fill: "#0b0a0a" },
          zIndex: lit ? 10 : 0,
        };
      });
  }, [graph, active, deadIds, labelAllEdges]);

  return (
    <div className="card relative overflow-hidden" style={{ height }}>
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
          fitViewOptions={{ padding: 0.12, maxZoom: 1.1 }}
          minZoom={0.1}
          nodesConnectable={false}
          nodesDraggable={false}
          colorMode="dark"
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, node) => node.type === "dch" && onSelect?.(node.id)}
          onNodeMouseEnter={(_, node) => node.type === "dch" && setHovered(node.id)}
          onNodeMouseLeave={() => setHovered(null)}
        >
          <Background color="#231f20" gap={28} />
          <Controls showInteractive={false} />
        </ReactFlow>
      )}
      {showLegend && positions !== null && (
        <div className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-4 rounded-md border border-border bg-bg/85 px-3 py-1.5 text-[11px] text-muted">
          <Legend className="rounded-sm border-[#3b3435] bg-[#161314]" label="Alive" />
          <Legend className="rounded-t-full border-accent-hover bg-accent-soft" label="Dead or suspicious" />
          <Legend className="border-accent-hover bg-accent" label="Selected" />
        </div>
      )}
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={clsx("h-3 w-2.5 border", className)} />
      {label}
    </span>
  );
}
