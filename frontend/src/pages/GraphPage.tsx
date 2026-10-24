import { useQueries } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "@/api/client";
import { useFindings, useModuleGraph } from "@/api/hooks";
import { LevelBadge } from "@/components/Badges";
import { GraphCanvas, type SymbolRow } from "@/components/GraphCanvas";
import { ErrorBox, PageTitle } from "@/components/Shell";
import { TYPE_LABELS } from "@/lib/format";

const packageOf = (file: string | null | undefined): string | null => {
  if (!file || !file.includes("/")) return null;
  return file.split("/")[0];
};

export function GraphPage() {
  const { id = "" } = useParams();
  const { data: graph, error, isLoading } = useModuleGraph(id);
  const { data: findings } = useFindings(id);
  const [typeFilter, setTypeFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);

  const fileOf = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.id, n.file ?? null])), [graph]);
  const groupOf = useCallback((nodeId: string) => packageOf(fileOf.get(nodeId)), [fileOf]);

  const expansions = useQueries({
    queries: expanded.map((moduleId) => ({
      queryKey: ["neighborhood", id, [moduleId], 1],
      queryFn: () => api.neighborhood(id, [moduleId], 1),
    })),
  });
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
  }, [expanded, expansions.map((q) => q.data).join("|"), fileOf]);

  const dimmed = useMemo(() => {
    if (!typeFilter || !graph || !findings) return undefined;
    const files = new Set(findings.items.filter((f) => f.type === typeFilter).map((f) => f.file));
    return new Set(graph.nodes.filter((n) => !n.file || !files.has(n.file)).map((n) => n.id));
  }, [typeFilter, graph, findings]);

  const selectedNode = graph?.nodes.find((n) => n.id === selected);
  const selectedFindings = (findings?.items ?? []).filter((f) => selectedNode && f.file === selectedNode.file);

  const toggleExpanded = (moduleId: string) =>
    setExpanded((current) => (current.includes(moduleId) ? current.filter((m) => m !== moduleId) : [...current, moduleId]));

  if (error) return <ErrorBox message={error.message} />;
  if (isLoading || !graph) return <p className="text-muted">Loading graph…</p>;

  return (
    <>
      <PageTitle title="Module graph">
        <select className="input !w-auto" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Highlight finding type">
          <option value="">Highlight: all</option>
          {Object.entries(TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </PageTitle>
      {graph.nodes.length === 0 ? (
        <p className="text-sm text-muted">No modules to draw.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
          <GraphCanvas
            graph={graph}
            selectedId={selected}
            onSelect={setSelected}
            groupOf={groupOf}
            symbols={symbols}
            dimmed={dimmed}
            height="calc(100vh - 260px)"
          />
          <aside className="card self-start p-4">
            {selectedNode ? (
              <div className="space-y-3">
                <p className="break-all font-mono text-sm">{selectedNode.file}</p>
                <p className="text-xs text-muted">
                  {selectedNode.liveness === "dead" ? "Unreachable module" : `Liveness: ${selectedNode.liveness}`}
                </p>
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
                          <Link to={`../findings/${encodeURIComponent(f.id)}`} relative="path" className="flex items-center gap-2 text-sm hover:underline">
                            <LevelBadge level={f.level} />
                            <span className="truncate font-mono text-xs">{f.name}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted">
                Select a module to see its findings. Burgundy modules are unreachable; dashed borders mean tests only.
              </p>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
