import { useQueries } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type GraphView } from "@/api/client";
import { useFindings, useModuleGraph } from "@/api/hooks";
import { IconTile } from "@/components/Brand";
import { GraphCanvas, type SymbolRow } from "@/components/GraphCanvas";
import { ErrorBox } from "@/components/Shell";
import { TYPE_LABELS, typeLabel } from "@/lib/format";
import { kindIcon } from "@/lib/icons";

const packageOf = (file: string | null | undefined): string | null =>
  file && file.includes("/") ? file.split("/")[0] : null;

/** Module-level graphs get unreadable past a few dozen nodes; start focused on the interesting part. */
const AUTO_FOCUS_ABOVE = 40;
const CORE_EDGES = new Set(["imports", "includes_router", "mounts", "inherits"]);

type Focus = "all" | "suspicious";

export function GraphPage() {
  const { id = "" } = useParams();
  const { data: full, error, isLoading } = useModuleGraph(id);
  const { data: findings } = useFindings(id);
  const [focusMode, setFocusMode] = useState<Focus | null>(null);
  const [allRelations, setAllRelations] = useState(false);
  const [typeFilter, setTypeFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const fileOf = useMemo(() => new Map((full?.nodes ?? []).map((n) => [n.id, n.file ?? null])), [full]);

  const mode: Focus = focusMode ?? ((full?.nodes.length ?? 0) > AUTO_FOCUS_ABOVE ? "suspicious" : "all");

  const graph = useMemo<GraphView | undefined>(() => {
    if (!full) return undefined;
    // Almost every module imports its package `__init__`; those edges bury the real structure.
    const isPackageHub = (nodeId: string) => (fileOf.get(nodeId) ?? "").endsWith("/__init__.py");
    const edges = full.edges.filter(
      (e) => allRelations || (CORE_EDGES.has(e.kind) && !(e.kind === "imports" && isPackageHub(e.dst))),
    );
    if (mode === "all") return { ...full, edges };
    const suspicious = new Set(full.nodes.filter((n) => n.liveness === "dead" || Number(n.attrs?.finding_count) > 0).map((n) => n.id));
    const keep = new Set(suspicious);
    for (const e of edges) {
      if (suspicious.has(e.src)) keep.add(e.dst);
      if (suspicious.has(e.dst)) keep.add(e.src);
    }
    return {
      ...full,
      nodes: full.nodes.filter((n) => keep.has(n.id)),
      edges: edges.filter((e) => keep.has(e.src) && keep.has(e.dst)),
    };
  }, [full, mode, allRelations, fileOf]);
  const groupOf = useCallback((nodeId: string) => packageOf(fileOf.get(nodeId)), [fileOf]);

  const expansions = useQueries({
    queries: expanded.map((moduleId) => ({
      queryKey: ["neighborhood", id, [moduleId], 1],
      queryFn: () => api.neighborhood(id, [moduleId], 1),
    })),
  });
  const expansionKey = expansions.map((q) => q.data?.nodes.length ?? 0).join(",");
  const symbols = useMemo(() => {
    const rows: Record<string, SymbolRow[]> = {};
    expanded.forEach((moduleId, index) => {
      const data = expansions[index]?.data;
      const file = fileOf.get(moduleId);
      if (!data) return;
      rows[moduleId] = data.nodes
        .filter((n) => n.kind !== "module" && n.file === file)
        .map((n) => ({ id: n.id, name: n.name, liveness: n.liveness }));
    });
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, expansionKey, fileOf]);

  const dimmed = useMemo(() => {
    if (!typeFilter || !graph || !findings) return undefined;
    const files = new Set(findings.items.filter((f) => f.type === typeFilter).map((f) => f.file));
    return new Set(graph.nodes.filter((n) => !n.file || !files.has(n.file)).map((n) => n.id));
  }, [typeFilter, graph, findings]);

  const selectedNode = full?.nodes.find((n) => n.id === selected);
  const selectedFindings = (findings?.items ?? []).filter((f) => selectedNode && f.file === selectedNode.file);
  const related = useMemo(() => {
    if (!full || !selected) return [];
    const byId = new Map(full.nodes.map((n) => [n.id, n]));
    const ids = new Set<string>();
    for (const e of full.edges) {
      if (e.src === selected) ids.add(e.dst);
      if (e.dst === selected) ids.add(e.src);
    }
    return [...ids].map((i) => byId.get(i)).filter((n): n is NonNullable<typeof n> => Boolean(n));
  }, [full, selected]);

  const toggleExpanded = (moduleId: string) =>
    setExpanded((current) => (current.includes(moduleId) ? current.filter((m) => m !== moduleId) : [...current, moduleId]));

  if (error) return <ErrorBox message={error.message} />;
  if (isLoading || !graph || !full) return <p className="text-muted">Loading graph…</p>;

  const hiddenCount = full.nodes.length - graph.nodes.length;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Code Graph</h1>
          <p className="mt-1 text-sm text-muted">
            How your modules depend on each other. Burgundy modules are unreachable or have findings.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select className="input !w-auto" value={mode} onChange={(e) => setFocusMode(e.target.value as Focus)} aria-label="Focus">
            <option value="all">Focus: All modules</option>
            <option value="suspicious">Focus: Suspicious &amp; neighbors</option>
          </select>
          <select className="input !w-auto" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Highlight finding type">
            <option value="">Highlight: any finding</option>
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <label className="flex cursor-pointer items-center gap-2 text-muted">
            <input type="checkbox" className="accent-[#7a1e2c]" checked={allRelations} onChange={(e) => setAllRelations(e.target.checked)} />
            All relationships
          </label>
        </div>
      </div>

      {graph.nodes.length === 0 ? (
        <p className="card px-5 py-8 text-center text-sm text-muted">
          {mode === "suspicious" ? "No suspicious modules. Switch focus to see everything." : "No modules to draw."}
        </p>
      ) : (
        <div className={selectedNode ? "grid gap-4 lg:grid-cols-[1fr_300px]" : ""}>
          <div>
            <GraphCanvas
              graph={graph}
              selectedId={selected}
              onSelect={setSelected}
              groupOf={groupOf}
              symbols={symbols}
              dimmed={dimmed}
              height="calc(100vh - 300px)"
            />
            <p className="mt-2 text-xs text-muted">
              Click a module for its findings. Hover to light up its connections. Dashed borders mean tests only.
              {hiddenCount > 0 && (
                <>
                  {" "}
                  {hiddenCount} healthy modules hidden.{" "}
                  <button className="underline" onClick={() => setFocusMode("all")}>
                    Show all
                  </button>
                </>
              )}
            </p>
          </div>
          {selectedNode && (
          <aside className="card self-start p-4">
            {(
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <IconTile icon={kindIcon(selectedNode.kind)} muted={selectedNode.liveness !== "dead"} />
                  <div className="min-w-0">
                    <p className="break-all font-mono text-sm">{selectedNode.file}</p>
                    <p className="mt-1 text-xs text-muted">
                      {selectedNode.liveness === "dead" ? "Unreachable module" : `Liveness: ${selectedNode.liveness.replace("_", " ")}`}
                    </p>
                  </div>
                </div>
                <button className="btn w-full" onClick={() => toggleExpanded(selectedNode.id)}>
                  {expanded.includes(selectedNode.id) ? "Collapse symbols" : "Expand symbols"}
                </button>
                <div>
                  <p className="label mb-1.5">Findings in this file</p>
                  {selectedFindings.length === 0 ? (
                    <p className="text-sm text-muted">None.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {selectedFindings.map((f) => (
                        <li key={f.id}>
                          <Link
                            to={`../findings/${encodeURIComponent(f.id)}`}
                            relative="path"
                            className="flex items-center gap-2 text-sm hover:underline"
                          >
                            <IconTile type={f.type} size="sm" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-mono text-xs">{f.name}</span>
                              <span className="block text-[11px] text-muted">{typeLabel(f.type)}</span>
                            </span>
                            <span className="font-mono text-xs text-[#d98a96]">{f.confidence}%</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {related.length > 0 && (
                  <div>
                    <p className="label mb-1.5">Related modules ({related.length})</p>
                    <ul className="max-h-40 space-y-1 overflow-y-auto">
                      {related.map((n) => (
                        <li key={n.id}>
                          <button className="w-full truncate text-left font-mono text-xs text-muted hover:text-text" onClick={() => setSelected(n.id)}>
                            {n.file}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </aside>
          )}
        </div>
      )}
    </>
  );
}
