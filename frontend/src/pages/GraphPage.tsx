import { useQueries } from "@tanstack/react-query";
import clsx from "clsx";
import { X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type GraphView } from "@/api/client";
import { useFindings, useModuleGraph } from "@/api/hooks";
import { GraphCanvas, type SymbolRow } from "@/components/GraphCanvas";
import { EmptyState, IconTile } from "@/components/Brand";
import { Container, ErrorBox, SectionHead } from "@/components/Shell";
import { TYPE_LABELS, typeLabel } from "@/lib/format";
import { EPITAPHS, livenessLabel } from "@/lib/lexicon";

const packageOf = (file: string | null | undefined): string | null =>
  file && file.includes("/") ? file.split("/")[0] : null;

/** Module-level graphs get unreadable past a few dozen nodes; start focused on the interesting part. */
const AUTO_FOCUS_ABOVE = 40;
const CORE_EDGES = new Set(["imports", "includes_router", "mounts", "inherits"]);

type Focus = "all" | "suspicious";
type FocusChoice = Focus | "auto";

const FOCUS_CHOICES: { key: FocusChoice; label: string }[] = [
  { key: "all", label: "All" },
  { key: "suspicious", label: "Suspicious" },
  { key: "auto", label: "Auto" },
];

const NOTES = {
  dead: "Nothing in the project refers to what this module holds.",
  suspicious: "Reached by other modules, but parts of it have no referrers.",
  alive: "In use. Included so the dead modules have somewhere to hang.",
} as const;

export function GraphPage() {
  const { id = "" } = useParams();
  const { data: full, error, isLoading } = useModuleGraph(id);
  const { data: findings } = useFindings(id);
  const [focusChoice, setFocusChoice] = useState<FocusChoice>("auto");
  const [allRelations, setAllRelations] = useState(false);
  const [typeFilter, setTypeFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const fileOf = useMemo(() => new Map((full?.nodes ?? []).map((n) => [n.id, n.file ?? null])), [full]);

  const mode: Focus = focusChoice === "auto" ? ((full?.nodes.length ?? 0) > AUTO_FOCUS_ABOVE ? "suspicious" : "all") : focusChoice;

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
  const { imports, importedBy } = useMemo(() => {
    if (!full || !selected) return { imports: [], importedBy: [] };
    const byId = new Map(full.nodes.map((n) => [n.id, n]));
    const label = (nodeId: string) => byId.get(nodeId)?.file ?? byId.get(nodeId)?.name ?? nodeId;
    const unique = (list: string[]) => [...new Set(list)];
    return {
      imports: unique(full.edges.filter((e) => e.src === selected).map((e) => label(e.dst))),
      importedBy: unique(full.edges.filter((e) => e.dst === selected).map((e) => label(e.src))),
    };
  }, [full, selected]);

  const toggleExpanded = (moduleId: string) =>
    setExpanded((current) => (current.includes(moduleId) ? current.filter((m) => m !== moduleId) : [...current, moduleId]));

  if (error)
    return (
      <Container className="pt-10">
        <ErrorBox message={error.message} />
      </Container>
    );
  if (isLoading || !graph || !full)
    return (
      <Container className="pt-10">
        <p className="text-muted">Loading graph…</p>
      </Container>
    );

  const hiddenCount = full.nodes.length - graph.nodes.length;
  const status = !selectedNode
    ? "alive"
    : selectedNode.liveness === "dead"
      ? "dead"
      : Number(selectedNode.attrs?.finding_count) > 0
        ? "suspicious"
        : "alive";

  return (
    <>
      <Container className="pb-7 pt-12">
        <SectionHead
          eyebrow="The Catacombs"
          aside={
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3.5">
              <div role="group" aria-label="Focus" className="flex overflow-hidden rounded-full border border-border">
                {FOCUS_CHOICES.map((choice) => (
                  <button
                    key={choice.key}
                    type="button"
                    aria-pressed={focusChoice === choice.key}
                    onClick={() => setFocusChoice(choice.key)}
                    className={clsx(
                      "px-4 py-2 text-[13px] font-medium transition-colors",
                      focusChoice === choice.key ? "bg-accent/[0.32] text-text" : "text-[#b3a9a5] hover:text-text",
                    )}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
              <select
                className="btn !appearance-none !bg-bg !py-2 !text-[13px]"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                aria-label="Highlight finding type"
              >
                <option value="">Highlight: any finding</option>
                {Object.entries(TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <label className="flex cursor-pointer items-center gap-2.5 text-[13.5px] text-soft">
                <input type="checkbox" className="h-[18px] w-[18px] accent-rose" checked={allRelations} onChange={(e) => setAllRelations(e.target.checked)} />
                All relationships
              </label>
            </div>
          }
        >
          Follow the <em>passages.</em>
        </SectionHead>
      </Container>

      <section
        className="relative overflow-hidden border-y border-[#1f1a1b] bg-[#0d0a0b]"
        style={{ minHeight: 560 }}
      >
        {graph.nodes.length === 0 ? (
          <Container className="py-16">
            <EmptyState epitaph={mode === "suspicious" ? EPITAPHS.noSuspicious : "No modules to draw."} />
          </Container>
        ) : (
          <>
            <GraphCanvas
              bare
              showLegend={false}
              graph={graph}
              selectedId={selected}
              onSelect={setSelected}
              groupOf={groupOf}
              symbols={symbols}
              dimmed={dimmed}
              height="max(560px, calc(100vh - 340px))"
            />
            {selectedNode && (
              <aside
                aria-label="Selected module"
                className="absolute right-5 top-5 z-10 max-h-[calc(100%-40px)] w-[min(320px,calc(100%-40px))] overflow-y-auto rounded-[18px] border border-[#3a2f30] bg-surface p-[22px] shadow-[0_24px_60px_rgba(0,0,0,0.6)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-[15px] font-medium [overflow-wrap:anywhere]">{selectedNode.file ?? selectedNode.name}</div>
                    <span
                      className={clsx(
                        "chip mt-2.5",
                        status === "dead" ? "chip-high" : status === "suspicious" ? "!border-dashed border-rose text-rose" : "chip-plain",
                      )}
                    >
                      {status}
                    </span>
                  </div>
                  <button
                    type="button"
                    aria-label="Close panel"
                    onClick={() => setSelected(null)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-strong text-[#b3a9a5] hover:text-text"
                  >
                    <X size={14} />
                  </button>
                </div>
                <p className="mt-3.5 text-[13.5px] leading-relaxed text-soft">
                  {NOTES[status]} <span className="text-muted">{livenessLabel(selectedNode.liveness)}.</span>
                </p>

                <PathList title="Imports" items={imports} />
                <PathList title="Imported by" items={importedBy} />

                <div className="label mt-[18px]">Remains in this file</div>
                {selectedFindings.length === 0 ? (
                  <p className="mt-1.5 font-mono text-[12.5px] text-muted">None.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {selectedFindings.map((f) => (
                      <li key={f.id}>
                        <Link
                          to={`../findings/${encodeURIComponent(f.id)}`}
                          relative="path"
                          className="flex items-center gap-2.5 hover:underline"
                        >
                          <IconTile type={f.type} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-mono text-xs">{f.name}</span>
                            <span className="block text-[11px] text-muted">{typeLabel(f.type)}</span>
                          </span>
                          <span className="font-mono text-xs text-rose">{f.confidence}%</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-5 flex flex-col gap-2.5">
                  <button className="btn" onClick={() => toggleExpanded(selectedNode.id)}>
                    {expanded.includes(selectedNode.id) ? "Collapse symbols" : "Expand symbols"}
                  </button>
                  {selectedFindings.length > 0 && (
                    <Link
                      to={`../findings?q=${encodeURIComponent(selectedNode.file ?? "")}`}
                      relative="path"
                      className="btn btn-primary"
                    >
                      Open in Remains
                    </Link>
                  )}
                </div>
              </aside>
            )}
          </>
        )}
      </section>

      <Container className="pt-[22px]">
        <ul aria-label="Legend" className="flex flex-wrap gap-x-7 gap-y-3 font-mono text-[11.5px] uppercase tracking-[0.1em] text-soft">
          <li className="flex items-center gap-[9px]">
            <span className="h-4 w-7 rounded-lg border border-[#4a4041] bg-surface" />
            Alive
          </li>
          <li className="flex items-center gap-[9px]">
            <span className="h-4 w-7 rounded-lg border border-dashed border-rose bg-surface" />
            Suspicious
          </li>
          <li className="flex items-center gap-[9px]">
            <span className="h-5 w-[22px] rounded-b-[3px] rounded-t-[11px] border border-accent-hover bg-accent/40" />
            Dead or selected
          </li>
        </ul>
        <p className="mt-3 text-xs text-muted">
          Click a module to examine it. Hover to light up its connections.
          {hiddenCount > 0 && (
            <>
              {" "}
              {hiddenCount} living modules hidden.{" "}
              <button className="underline" onClick={() => setFocusChoice("all")}>
                Show all
              </button>
            </>
          )}
        </p>
      </Container>
    </>
  );
}

function PathList({ title, items }: { title: string; items: string[] }) {
  return (
    <>
      <div className="label mt-[18px]">{title}</div>
      <div className="mt-1.5 max-h-28 overflow-y-auto font-mono text-[12.5px] leading-[1.7]">
        {items.length === 0 ? <span className="text-muted">Nothing</span> : items.map((item) => <div key={item} className="[overflow-wrap:anywhere]">{item}</div>)}
      </div>
    </>
  );
}
