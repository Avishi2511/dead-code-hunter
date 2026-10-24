import ELK, { type ElkNode } from "elkjs/lib/elk-api";

// Layout runs in a web worker so large graphs never block the UI thread (script copied by scripts/copy-elk.mjs).
const elk = new ELK({ workerFactory: () => new Worker(`${import.meta.env.BASE_URL}elk-worker.min.js`) });
const LAYOUT_TIMEOUT_MS = 20_000;

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
  group?: string;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
}

export interface LayoutGroup {
  id: string;
}

export interface Placement {
  x: number;
  y: number;
  width?: number;
  height?: number;
}

const ROOT_OPTIONS = {
  "elk.algorithm": "layered",
  "elk.direction": "DOWN",
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.layered.spacing.nodeNodeBetweenLayers": "56",
  "elk.spacing.nodeNode": "28",
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
};

const GROUP_OPTIONS = {
  "elk.padding": "[top=34,left=16,bottom=16,right=16]",
};

/** Positions are relative to the parent group, which is what React Flow expects for `parentId` nodes. */
export async function layoutGraph(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  groups: LayoutGroup[] = [],
): Promise<Record<string, Placement>> {
  const toElk = (n: LayoutNode): ElkNode => ({ id: n.id, width: n.width, height: n.height });
  const children: ElkNode[] = [
    ...groups.map((g) => ({
      id: g.id,
      layoutOptions: GROUP_OPTIONS,
      children: nodes.filter((n) => n.group === g.id).map(toElk),
    })),
    ...nodes.filter((n) => !n.group).map(toElk),
  ];
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Graph layout timed out")), LAYOUT_TIMEOUT_MS),
  );
  const result = await Promise.race([
    elk.layout({
      id: "root",
      layoutOptions: ROOT_OPTIONS,
      children,
      edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
    }),
    timeout,
  ]);
  const placements: Record<string, Placement> = {};
  const visit = (node: ElkNode) => {
    for (const child of node.children ?? []) {
      placements[child.id] = { x: child.x ?? 0, y: child.y ?? 0, width: child.width, height: child.height };
      visit(child);
    }
  };
  visit(result);
  return placements;
}
