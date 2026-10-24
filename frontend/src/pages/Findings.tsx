import clsx from "clsx";
import { useMemo } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useFindings } from "@/api/hooks";
import { LevelBadge, TypeBadge } from "@/components/Badges";
import { PageTitle } from "@/components/Shell";
import { TYPE_LABELS, pluralize } from "@/lib/format";
import { useScanSelection, useSelection } from "@/state/selection";

const PARAMS = ["type", "level", "q", "path"] as const;

export function Findings() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const filters = Object.fromEntries(PARAMS.map((key) => [key, search.get(key) ?? ""]));
  const { data, isLoading, error } = useFindings(id, filters);
  const selection = useScanSelection(id);
  const { set, setMany, clear } = useSelection.getState();

  const setFilter = (key: (typeof PARAMS)[number], value: string) => {
    const next = new URLSearchParams(search);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearch(next, { replace: true });
  };

  const items = data?.items ?? [];
  const selectable = useMemo(() => items.filter((f) => !f.covered_by && !f.manual), [items]);
  const highIds = useMemo(() => selectable.filter((f) => f.level === "high").map((f) => f.id), [selectable]);
  const selectedCount = Object.keys(selection).length;

  return (
    <>
      <PageTitle title="Findings">
        <div className="flex items-center gap-2">
          <button className="btn" onClick={() => setMany(id, highIds, "remove")} disabled={highIds.length === 0}>
            Select all High ({highIds.length})
          </button>
          {selectedCount > 0 && (
            <button className="btn" onClick={() => clear(id)}>
              Clear
            </button>
          )}
          <button className="btn btn-primary" disabled={selectedCount === 0} onClick={() => navigate("../cleanup")}>
            Prepare cleanup{selectedCount ? ` (${selectedCount})` : ""}
          </button>
        </div>
      </PageTitle>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        <select className="input" value={filters.type} onChange={(e) => setFilter("type", e.target.value)} aria-label="Type">
          <option value="">All types</option>
          {Object.entries(TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select className="input" value={filters.level} onChange={(e) => setFilter("level", e.target.value)} aria-label="Confidence">
          <option value="">Any confidence</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <input className="input font-mono" placeholder="Path prefix" value={filters.path} onChange={(e) => setFilter("path", e.target.value)} />
        <input className="input" placeholder="Search name or file" value={filters.q} onChange={(e) => setFilter("q", e.target.value)} />
      </div>

      {error && <p className="text-sm">{error.message}</p>}
      {isLoading && <p className="text-sm text-muted">Loading…</p>}
      {data && (
        <>
          <p className="mb-2 text-xs text-muted">{pluralize(data.total, "finding")}</p>
          {items.length === 0 ? (
            <p className="text-sm text-muted">Nothing matches these filters.</p>
          ) : (
            <ul className="card divide-y divide-border">
              {items.map((finding) => {
                const disabled = Boolean(finding.covered_by) || finding.manual;
                return (
                  <li key={finding.id} className={clsx("flex items-center gap-3 px-4 py-2.5", disabled && "opacity-60")}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[#7a1e2c]"
                      aria-label={`Select ${finding.name}`}
                      disabled={disabled}
                      checked={finding.id in selection}
                      onChange={(e) => set(id, finding.id, e.target.checked ? "remove" : null)}
                    />
                    <LevelBadge level={finding.level} confidence={finding.confidence} />
                    <TypeBadge type={finding.type} />
                    <Link to={encodeURIComponent(finding.id)} className="min-w-0 flex-1 truncate font-mono text-sm hover:underline">
                      {finding.name}
                    </Link>
                    {finding.covered_by && <span className="text-xs text-muted">covered by another finding</span>}
                    {finding.manual && <span className="text-xs text-muted">manual</span>}
                    <span className="hidden max-w-[40%] truncate font-mono text-xs text-muted md:block">
                      {finding.file}:{finding.line}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </>
  );
}
