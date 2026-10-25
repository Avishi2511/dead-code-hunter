import clsx from "clsx";
import { ArrowRight, ChevronRight, Search } from "lucide-react";
import { useMemo } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { FindingSummary, Level } from "@/api/client";
import { useFindings } from "@/api/hooks";
import { ConfidenceBar, LevelBadge } from "@/components/Badges";
import { EmptyState, IconTile } from "@/components/Brand";
import { Container, SectionHead } from "@/components/Shell";
import { TYPE_LABELS, typeLabel } from "@/lib/format";
import { EPITAPHS, VERDICTS } from "@/lib/lexicon";
import { useScanSelection, useSelection } from "@/state/selection";

type SortKey = "confidence" | "file" | "type" | "impact";
const SORTERS: Record<SortKey, (a: FindingSummary, b: FindingSummary) => number> = {
  confidence: (a, b) => b.confidence - a.confidence || a.file.localeCompare(b.file) || a.line - b.line,
  file: (a, b) => a.file.localeCompare(b.file) || a.line - b.line,
  type: (a, b) => a.type.localeCompare(b.type) || b.confidence - a.confidence,
  impact: (a, b) => b.impact_lines - a.impact_lines,
};

const LEVELS: Level[] = ["high", "medium", "low"];

export function Findings() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
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

  const all = useMemo(() => data?.items ?? [], [data]);
  const needle = q.toLowerCase();
  // Counts on the verdict pills follow the other filters, so they always add up to what the list can show.
  const scoped = useMemo(
    () =>
      all.filter(
        (f) =>
          (!type || f.type === type) &&
          (!needle || f.name.toLowerCase().includes(needle) || f.file.toLowerCase().includes(needle)),
      ),
    [all, type, needle],
  );
  const counts = useMemo(
    () => Object.fromEntries(LEVELS.map((l) => [l, scoped.filter((f) => f.level === l).length])) as Record<Level, number>,
    [scoped],
  );
  const items = useMemo(() => scoped.filter((f) => !level || f.level === level).sort(SORTERS[sort]), [scoped, level, sort]);

  const byId = useMemo(() => new Map(all.map((f) => [f.id, f])), [all]);
  const selectedCount = Object.keys(selection).length;
  const selectedLines = Object.keys(selection).reduce((sum, key) => sum + (byId.get(key)?.impact_lines ?? 0), 0);
  const highIds = useMemo(() => all.filter((f) => f.level === "high" && !f.covered_by && !f.manual).map((f) => f.id), [all]);

  const pills: { key: string; label: string; count: number }[] = [
    { key: "", label: "All", count: scoped.length },
    ...LEVELS.map((l) => ({ key: l, label: VERDICTS[l], count: counts[l] })),
  ];

  return (
    <>
      <Container className="pt-14">
        <SectionHead eyebrow="The remains">
          Decide who rests, <em>and who is spared.</em>
        </SectionHead>

        <div className="mt-9 flex flex-wrap items-center justify-between gap-x-6 gap-y-3.5">
          <div role="group" aria-label="Filter by verdict" className="flex flex-wrap gap-2">
            {pills.map((p) => (
              <button
                key={p.key}
                type="button"
                aria-pressed={level === p.key}
                onClick={() => setParam("level", p.key)}
                className={clsx("pill !px-4 !py-2 !text-[13px]", level === p.key && "pill-on")}
              >
                {p.label} <span className="font-mono text-[11.5px]">{p.count}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-[1_1_320px] flex-wrap justify-end gap-3">
            <div className="relative max-w-[340px] flex-[1_1_220px]">
              <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
              <input
                className="input !py-2.5 !pl-10 font-mono"
                placeholder="Search symbols or paths"
                aria-label="Search remains"
                value={q}
                onChange={(e) => setParam("q", e.target.value)}
              />
            </div>
            <select className="btn !appearance-none !bg-bg" value={type} onChange={(e) => setParam("type", e.target.value)} aria-label="Type">
              <option value="">Any kind</option>
              {Object.entries(TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select className="btn !appearance-none !bg-bg" value={sort} onChange={(e) => setParam("sort", e.target.value)} aria-label="Sort">
              <option value="confidence">Sort: confidence</option>
              <option value="file">Sort: file</option>
              <option value="type">Sort: kind</option>
              <option value="impact">Sort: impact</option>
            </select>
            <button className="btn" onClick={() => setMany(id, highIds, "remove")} disabled={highIds.length === 0}>
              Mark all certified dead ({highIds.length})
            </button>
          </div>
        </div>

        {error && <p className="mt-6 text-sm">{error.message}</p>}
        {isLoading && <p className="mt-6 text-sm text-muted">Loading…</p>}
        {data &&
          (items.length === 0 ? (
            <div className="mt-5">
              <EmptyState epitaph={all.length === 0 ? EPITAPHS.noRemains : EPITAPHS.noMatches} />
            </div>
          ) : (
            <div className="mt-5 overflow-hidden rounded-[20px] border border-border bg-surface">
              {items.map((f) => {
                const disabled = Boolean(f.covered_by) || f.manual;
                const marked = f.id in selection;
                return (
                  <div
                    key={f.id}
                    className={clsx(
                      "flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-[#231e1f] px-6 py-4 transition-colors first:border-t-0 hover:bg-[#181415]",
                      marked && "bg-accent/10",
                      disabled && "opacity-60",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="h-5 w-5 cursor-pointer accent-rose disabled:cursor-not-allowed"
                      aria-label={`Bury ${f.name}`}
                      disabled={disabled}
                      checked={marked}
                      onChange={(e) => set(id, f.id, e.target.checked ? "remove" : null)}
                    />
                    <IconTile type={f.type} size="md" />
                    <Link to={encodeURIComponent(f.id)} className="min-w-0 flex-[1_1_240px]">
                      <div className="break-words font-mono text-[15px] font-medium [overflow-wrap:anywhere]">{f.name}</div>
                      <div className="mt-0.5 font-mono text-xs text-muted [overflow-wrap:anywhere]">
                        {typeLabel(f.type)} · {f.file}:{f.line}
                        {f.covered_by && " · covered by another finding"}
                        {f.manual && " · manual change"}
                      </div>
                    </Link>
                    <div className="w-[150px] shrink-0">
                      <ConfidenceBar level={f.level} value={f.confidence} />
                    </div>
                    <div className="w-[150px] shrink-0 text-center">
                      <LevelBadge level={f.level} />
                    </div>
                    <span className="w-[70px] shrink-0 text-right font-mono text-[12.5px] text-muted">{f.impact_lines} ln</span>
                    <Link to={encodeURIComponent(f.id)} aria-label={`Open ${f.name}`} className="flex text-muted hover:text-text">
                      <ChevronRight size={18} />
                    </Link>
                  </div>
                );
              })}
            </div>
          ))}
      </Container>

      {selectedCount > 0 && (
        <div className="sticky bottom-5 z-10 mt-7">
          <Container>
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-[18px] border border-accent-hover bg-[#1b1112] py-3.5 pl-[26px] pr-4 shadow-[0_20px_60px_rgba(0,0,0,0.6)]">
              <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1.5">
                <span className="title text-[34px] leading-none text-rose">{selectedCount}</span>
                <span className="text-[15px]">marked for burial</span>
                <span className="font-mono text-[12.5px] text-soft">~{selectedLines.toLocaleString()} lines</span>
              </div>
              <div className="flex gap-2.5">
                <button className="btn" onClick={() => clear(id)}>
                  Clear
                </button>
                <button className="btn btn-primary btn-lg" onClick={() => navigate("../cleanup")}>
                  Continue to Burial <ArrowRight size={18} />
                </button>
              </div>
            </div>
          </Container>
        </div>
      )}
    </>
  );
}
