import clsx from "clsx";
import { Search } from "lucide-react";
import { useMemo } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { FindingSummary } from "@/api/client";
import { useFindings } from "@/api/hooks";
import { IconTile } from "@/components/Brand";
import { TYPE_LABELS, typeLabel } from "@/lib/format";
import { useScanSelection, useSelection } from "@/state/selection";

const GROUPS: { key: string; label: string; types: string[] | null }[] = [
  { key: "all", label: "All", types: null },
  {
    key: "unused",
    label: "Unused",
    types: ["unused_function", "unused_class", "unused_method", "unused_variable", "unused_import", "unused_module"],
  },
  { key: "unreachable", label: "Unreachable", types: ["unreachable_code"] },
  { key: "dependencies", label: "Dependencies", types: ["unused_dependency"] },
  { key: "apis", label: "APIs", types: ["unused_route"] },
];

type SortKey = "confidence" | "file" | "type" | "impact";
const SORTERS: Record<SortKey, (a: FindingSummary, b: FindingSummary) => number> = {
  confidence: (a, b) => b.confidence - a.confidence || a.file.localeCompare(b.file) || a.line - b.line,
  file: (a, b) => a.file.localeCompare(b.file) || a.line - b.line,
  type: (a, b) => a.type.localeCompare(b.type) || b.confidence - a.confidence,
  impact: (a, b) => b.impact_lines - a.impact_lines,
};

export function Findings() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const group = search.get("group") ?? "all";
  const type = search.get("type") ?? "";
  const level = search.get("level") ?? "";
  const q = search.get("q") ?? "";
  const sort = (search.get("sort") as SortKey) || "confidence";

  const { data, isLoading, error } = useFindings(id);
  const selection = useScanSelection(id);
  const { set, setMany, clear } = useSelection.getState();

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(search);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearch(next, { replace: true });
  };

  const all = data?.items ?? [];
  const counts = useMemo(
    () => Object.fromEntries(GROUPS.map((g) => [g.key, all.filter((f) => !g.types || g.types.includes(f.type)).length])),
    [all],
  );
  const groupTypes = GROUPS.find((g) => g.key === group)?.types ?? null;
  const needle = q.toLowerCase();
  const items = useMemo(
    () =>
      all
        .filter(
          (f) =>
            (!groupTypes || groupTypes.includes(f.type)) &&
            (!type || f.type === type) &&
            (!level || f.level === level) &&
            (!needle || f.name.toLowerCase().includes(needle) || f.file.toLowerCase().includes(needle)),
        )
        .sort(SORTERS[sort]),
    [all, groupTypes, type, level, needle, sort],
  );
  const selectable = useMemo(() => items.filter((f) => !f.covered_by && !f.manual), [items]);
  const allChecked = selectable.length > 0 && selectable.every((f) => f.id in selection);
  const selectedCount = Object.keys(selection).length;
  const highIds = selectable.filter((f) => f.level === "high").map((f) => f.id);

  return (
    <div className={selectedCount > 0 ? "pb-20" : ""}>
      <div className="mb-1 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Findings</h1>
          <p className="mt-1 text-sm text-muted">{counts.all ?? 0} total findings</p>
        </div>
        <button className="btn" onClick={() => setMany(id, highIds, "remove")} disabled={highIds.length === 0}>
          Select all High ({highIds.length})
        </button>
      </div>

      <div className="mb-4 mt-4 flex flex-wrap gap-2">
        {GROUPS.map((g) => (
          <button
            key={g.key}
            onClick={() => setParam("group", g.key === "all" ? "" : g.key)}
            className={clsx(
              "rounded-full border px-3.5 py-1.5 text-sm transition-colors",
              group === g.key ? "border-accent bg-accent text-text" : "border-border text-muted hover:text-text",
            )}
          >
            {g.label} <span className="font-mono text-xs opacity-80">({counts[g.key] ?? 0})</span>
          </button>
        ))}
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input !pl-9" placeholder="Search findings…" value={q} onChange={(e) => setParam("q", e.target.value)} />
        </div>
        <select className="input !w-auto" value={type} onChange={(e) => setParam("type", e.target.value)} aria-label="Type">
          <option value="">Any type</option>
          {Object.entries(TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select className="input !w-auto" value={level} onChange={(e) => setParam("level", e.target.value)} aria-label="Confidence">
          <option value="">Any confidence</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select className="input !w-auto" value={sort} onChange={(e) => setParam("sort", e.target.value)} aria-label="Sort">
          <option value="confidence">Sort: Confidence</option>
          <option value="file">Sort: File</option>
          <option value="type">Sort: Type</option>
          <option value="impact">Sort: Impact</option>
        </select>
      </div>

      {error && <p className="text-sm">{error.message}</p>}
      {isLoading && <p className="text-sm text-muted">Loading…</p>}
      {data &&
        (items.length === 0 ? (
          <p className="card px-5 py-8 text-center text-sm text-muted">Nothing buried here matches these filters.</p>
        ) : (
          <div className="card overflow-hidden">
            <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-border px-4 py-2.5 text-xs text-muted md:grid-cols-[auto_1.6fr_1fr_1.6fr_auto]">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[#7a1e2c]"
                aria-label="Select all shown"
                checked={allChecked}
                onChange={(e) =>
                  e.target.checked ? setMany(id, selectable.map((f) => f.id), "remove") : selectable.forEach((f) => set(id, f.id, null))
                }
              />
              <span>Name</span>
              <span className="hidden md:block">Type</span>
              <span className="hidden md:block">File</span>
              <span className="text-right">Confidence</span>
            </div>
            <ul className="divide-y divide-border">
              {items.map((f) => {
                const disabled = Boolean(f.covered_by) || f.manual;
                return (
                  <li
                    key={f.id}
                    className={clsx(
                      "grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2 md:grid-cols-[auto_1.6fr_1fr_1.6fr_auto]",
                      f.id in selection && "bg-accent-soft/40",
                      disabled && "opacity-60",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[#7a1e2c]"
                      aria-label={`Select ${f.name}`}
                      disabled={disabled}
                      checked={f.id in selection}
                      onChange={(e) => set(id, f.id, e.target.checked ? "remove" : null)}
                    />
                    <Link to={encodeURIComponent(f.id)} className="flex min-w-0 items-center gap-3">
                      <IconTile type={f.type} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-sm hover:underline">{f.name}</span>
                        {(f.covered_by || f.manual) && (
                          <span className="block text-xs text-muted">{f.covered_by ? "covered by another finding" : "manual change"}</span>
                        )}
                      </span>
                    </Link>
                    <span className="hidden text-sm text-muted md:block">{typeLabel(f.type)}</span>
                    <span className="hidden truncate font-mono text-xs text-muted md:block">
                      {f.file}:{f.line}
                    </span>
                    <span
                      className={clsx(
                        "w-12 text-right font-mono text-sm",
                        f.level === "high" ? "text-[#d98a96]" : f.level === "medium" ? "text-text" : "text-muted",
                      )}
                      title={`${f.level} confidence`}
                    >
                      {f.confidence}%
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

      {selectedCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface/95 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-3">
            <span className="text-sm">
              <span className="font-mono">{selectedCount}</span> findings selected
            </span>
            <div className="flex gap-2">
              <button className="btn" onClick={() => clear(id)}>
                Clear
              </button>
              <button className="btn btn-primary" onClick={() => navigate("../cleanup")}>
                Generate Cleanup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
