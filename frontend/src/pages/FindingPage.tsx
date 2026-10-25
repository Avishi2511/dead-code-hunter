import clsx from "clsx";
import { Check, ChevronRight, ShieldCheck, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { FindingDetail } from "@/api/client";
import { useFinding, useNeighborhood } from "@/api/hooks";
import { StaticCheckBadge } from "@/components/Badges";
import { IconTile } from "@/components/Brand";
import { CodeExcerpt } from "@/components/CodeExcerpt";
import { DiffView } from "@/components/DiffView";
import { GraphCanvas } from "@/components/GraphCanvas";
import { ErrorBox } from "@/components/Shell";
import { typeLabel } from "@/lib/format";
import { EPITAPHS, NAV, verdict } from "@/lib/lexicon";
import { useScanSelection, useSelection } from "@/state/selection";
import { useScanContext } from "./ScanLayout";

export function FindingPage() {
  const { id = "", fid = "" } = useParams();
  const { data: finding, error } = useFinding(id, fid);
  if (error) return <ErrorBox message={error.message} />;
  if (!finding) return <p className="text-muted">Loading…</p>;
  return <FindingView scanId={id} finding={finding} />;
}

type Tab = "code" | "references" | "graph";

function FindingView({ scanId, finding }: { scanId: string; finding: FindingDetail }) {
  const scan = useScanContext();
  const [tab, setTab] = useState<Tab>("code");
  const evidence = finding.evidence ?? [];
  const references = finding.references ?? [];
  const suggestion = finding.suggestion;
  const share = scan.stats.python_lines > 0 ? (finding.impact_lines / scan.stats.python_lines) * 100 : 0;
  const tabs: { key: Tab; label: string; hidden?: boolean }[] = [
    { key: "code", label: "Code", hidden: !finding.excerpt },
    { key: "references", label: `Mourners (${references.filter((r) => r.direction === "incoming").length})` },
    { key: "graph", label: "Catacombs", hidden: finding.node_ids.length === 0 },
  ];
  const visibleTabs = tabs.filter((t) => !t.hidden);
  const active = visibleTabs.some((t) => t.key === tab) ? tab : (visibleTabs[0]?.key ?? "references");

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1.5 text-xs text-muted">
        <Link to=".." relative="path" className="hover:text-text">
          {NAV.remains.label}
        </Link>
        <ChevronRight size={13} />
        <span className="truncate font-mono text-text">{finding.name}</span>
      </nav>

      <header className="flex flex-wrap items-start gap-4">
        <IconTile type={finding.type} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="label mb-1">Case file</p>
          <h1 className="break-all font-mono text-2xl font-semibold tracking-tight">{finding.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-accent/70 bg-accent-soft px-2 py-0.5 text-xs text-[#e3a0aa]">
              {finding.type === "unused_route" ? "Probably unused API" : typeLabel(finding.type)}
            </span>
            <span className="font-mono text-xs text-muted">
              {finding.file}:{finding.line}
              {finding.end_line > finding.line ? `–${finding.end_line}` : ""}
            </span>
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-3xl text-[#d98a96]">{finding.confidence}%</div>
          <div className="title text-sm italic text-muted">{verdict(finding.level)}</div>
        </div>
      </header>
      {finding.type === "unused_route" && (
        <p className="text-sm text-muted">External consumers (other services, clients) are not visible to static analysis.</p>
      )}

      <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="card p-5">
          <h2 className="title text-xl">Cause of death</h2>
          <p className="mb-3 text-xs text-muted">Why we think this is dead</p>
          {evidence.length === 0 ? (
            <p className="text-sm text-muted">{finding.summary || "No detailed evidence recorded."}</p>
          ) : (
            <>
              <EvidenceList items={evidence.filter((e) => e.polarity === "supports")} />
              {evidence.some((e) => e.polarity === "weakens") && (
                <div className="mt-5 border-t border-border pt-4">
                  <h3 className="title text-lg">Signs of life</h3>
                  <p className="mb-3 text-xs text-muted">Reasons it might not be dead after all</p>
                  <EvidenceList items={evidence.filter((e) => e.polarity === "weakens")} />
                </div>
              )}
            </>
          )}
        </div>

        <div className="card flex flex-col p-5">
          <p className="label">Estimated impact</p>
          <p className="mt-2 font-mono text-2xl">
            ~{finding.impact_lines} <span className="text-sm text-muted">lines</span>
          </p>
          <p className="mt-1 text-xs text-muted">
            <span className="font-mono">{share > 0 && share < 0.1 ? "<0.1" : share.toFixed(1)}%</span> of the codebase
          </p>
          <Actions scanId={scanId} finding={finding} />
        </div>
      </section>

      <section>
        <div className="mb-3 flex gap-1 border-b border-border">
          {visibleTabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={clsx(
                "-mb-px border-b-2 px-3.5 py-2 text-sm transition-colors",
                active === t.key ? "border-accent-hover text-text" : "border-transparent text-muted hover:text-text",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {active === "code" && finding.excerpt && <CodeExcerpt excerpt={finding.excerpt} file={finding.file} />}
        {active === "references" && <References references={references} />}
        {active === "graph" && <Neighborhood scanId={scanId} finding={finding} />}
      </section>

      <section>
        <h2 className="title mb-1 text-xl">Suggested burial</h2>
        <p className="mb-3 text-xs text-muted">The change that removes it</p>
        {suggestion ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <StaticCheckBadge value={suggestion.static_check} />
              {finding.covered_by && (
                <Link to={`../${encodeURIComponent(finding.covered_by)}`} relative="path" className="text-xs text-muted underline">
                  Covered by another finding
                </Link>
              )}
              {suggestion.manual && <span className="text-xs text-muted">Needs a manual change</span>}
            </div>
            {(suggestion.cascades ?? []).length > 0 && (
              <div className="text-sm">
                <p className="label mb-1">Buried alongside</p>
                <ul className="list-disc space-y-0.5 pl-5 text-muted">
                  {(suggestion.cascades ?? []).map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
            {(suggestion.static_notes ?? []).length > 0 && (
              <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted">
                {(suggestion.static_notes ?? []).map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
            {suggestion.diff ? <DiffView diff={suggestion.diff} /> : <p className="text-sm text-muted">No automatic change available.</p>}
          </div>
        ) : (
          <p className="text-sm text-muted">No suggestion was prepared for this finding.</p>
        )}
      </section>
    </div>
  );
}

function EvidenceList({ items }: { items: NonNullable<FindingDetail["evidence"]> }) {
  return (
    <ul className="space-y-2.5">
      {items.map((item, index) => (
        <li key={`${item.code}-${index}`} className="flex gap-2.5 text-sm">
          {item.polarity === "supports" ? (
            <Check size={16} className="mt-0.5 shrink-0 text-text" />
          ) : (
            <TriangleAlert size={16} className="mt-0.5 shrink-0 text-[#d98a96]" />
          )}
          <span className={item.polarity === "weakens" ? "text-muted" : ""}>
            {item.text}
            {(item.locations ?? []).length > 0 && (
              <span className="mt-0.5 block font-mono text-xs text-muted">
                {(item.locations ?? []).slice(0, 3).map((l) => `${l.file}:${l.line}`).join("  ·  ")}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function References({ references }: { references: NonNullable<FindingDetail["references"]> }) {
  const groups = [
    ["Mourners", references.filter((r) => r.direction === "incoming"), EPITAPHS.noMourners],
    ["Last ties", references.filter((r) => r.direction === "outgoing"), EPITAPHS.noTies],
  ] as const;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {groups.map(([title, list, empty]) => (
        <div key={title} className="card p-4">
          <p className="label mb-2">{title}</p>
          {list.length === 0 ? (
            <p className="title text-base italic text-muted">{empty}</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {list.map((ref, index) => (
                <li key={`${ref.node_id}-${index}`} className="flex items-baseline gap-2">
                  <span className="shrink-0 rounded border border-border px-1 font-mono text-[10px] uppercase text-muted">{ref.kind}</span>
                  <span className="truncate font-mono text-xs" title={ref.node_id}>
                    {ref.node_id.split(":").slice(1).join(":") || ref.node_id}
                  </span>
                  {ref.liveness === "dead" && <span className="shrink-0 text-xs text-[#d98a96]">only from dead code</span>}
                  {ref.liveness === "test_only" && <span className="shrink-0 text-xs text-muted">tests only</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function Neighborhood({ scanId, finding }: { scanId: string; finding: FindingDetail }) {
  const focus = useMemo(() => finding.node_ids.slice(0, 3), [finding.node_ids]);
  const { data, error, isLoading } = useNeighborhood(scanId, focus);
  const notes = useMemo(() => {
    const incoming = (finding.references ?? []).filter((r) => r.direction === "incoming").length;
    return incoming === 0 ? Object.fromEntries(focus.map((n) => [n, "No incoming references"])) : {};
  }, [finding, focus]);

  if (isLoading) return <p className="text-sm text-muted">Loading graph…</p>;
  if (error || !data) return <p className="text-sm text-muted">The graph is not available for this finding.</p>;
  return <GraphCanvas graph={data} notes={notes} height={380} showLegend />;
}

function Actions({ scanId, finding }: { scanId: string; finding: FindingDetail }) {
  const selection = useScanSelection(scanId);
  const current = selection[finding.id];
  const { set } = useSelection.getState();
  const blocked = Boolean(finding.covered_by) || Boolean(finding.suggestion?.manual);

  return (
    <div className="mt-auto space-y-2 pt-5">
      {current && (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <ShieldCheck size={14} />
          {current === "remove" ? "Marked for burial" : "Spared"}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          className={clsx("btn", current === "mark_alive" && "border-accent")}
          onClick={() => set(scanId, finding.id, current === "mark_alive" ? null : "mark_alive")}
        >
          Spare it
        </button>
        <button
          className="btn btn-primary"
          disabled={blocked}
          onClick={() => set(scanId, finding.id, current === "remove" ? null : "remove")}
        >
          {current === "remove" ? "Unmark" : "Bury"}
        </button>
      </div>
      <Link to="../../cleanup" relative="path" className="block text-xs text-muted underline">
        To the burial
      </Link>
    </div>
  );
}
