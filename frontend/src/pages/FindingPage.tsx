import clsx from "clsx";
import { ChevronLeft, Shovel } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { FindingDetail } from "@/api/client";
import { useFinding, useNeighborhood } from "@/api/hooks";
import { StaticCheckBadge } from "@/components/Badges";
import { IconTile } from "@/components/Brand";
import { CodeExcerpt } from "@/components/CodeExcerpt";
import { DiffView } from "@/components/DiffView";
import { GraphCanvas } from "@/components/GraphCanvas";
import { Container, ErrorBox } from "@/components/Shell";
import { typeLabel } from "@/lib/format";
import { EPITAPHS, verdict } from "@/lib/lexicon";
import { useScanSelection, useSelection } from "@/state/selection";
import { useScanContext } from "./ScanLayout";

export function FindingPage() {
  const { id = "", fid = "" } = useParams();
  const { data: finding, error } = useFinding(id, fid);
  if (error)
    return (
      <Container className="pt-8">
        <ErrorBox message={error.message} />
      </Container>
    );
  if (!finding)
    return (
      <Container className="pt-8">
        <p className="text-muted">Loading…</p>
      </Container>
    );
  return <FindingView scanId={id} finding={finding} />;
}

type Tab = "code" | "references" | "graph";
type Evidence = NonNullable<FindingDetail["evidence"]>;

function FindingView({ scanId, finding }: { scanId: string; finding: FindingDetail }) {
  const scan = useScanContext();
  const [tab, setTab] = useState<Tab>("code");
  const evidence = finding.evidence ?? [];
  const supports = evidence.filter((e) => e.polarity === "supports");
  const weakens = evidence.filter((e) => e.polarity === "weakens");
  const references = finding.references ?? [];
  const suggestion = finding.suggestion;
  const share = scan.stats.python_lines > 0 ? (finding.impact_lines / scan.stats.python_lines) * 100 : 0;
  const tabs: { key: Tab; label: string; hidden?: boolean }[] = [
    { key: "code", label: "Code", hidden: !finding.excerpt },
    { key: "references", label: `Mourners ${references.filter((r) => r.direction === "incoming").length}` },
    { key: "graph", label: "Catacombs", hidden: finding.node_ids.length === 0 },
  ];
  const visibleTabs = tabs.filter((t) => !t.hidden);
  const active = visibleTabs.some((t) => t.key === tab) ? tab : (visibleTabs[0]?.key ?? "references");
  const range = `${finding.file}${finding.end_line > finding.line ? ` · lines ${finding.line}–${finding.end_line}` : ` · line ${finding.line}`}`;

  return (
    <>
      <section className="relative mt-6 overflow-hidden border-y border-[#1f1a1b]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-20 -left-[8%] h-[170px] w-[60%] rounded-full bg-[rgba(150,60,72,0.15)] blur-[52px]"
        />
        <Container className="relative pb-[52px] pt-9">
          <Link
            to=".."
            relative="path"
            className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.16em] text-[#b3a9a5] transition-colors hover:text-text"
          >
            <ChevronLeft size={15} /> Back to the remains
          </Link>

          <div className="mt-10 flex flex-wrap items-end justify-between gap-x-10 gap-y-7">
            <div className="flex min-w-0 flex-[1_1_560px] flex-wrap items-end gap-x-7 gap-y-6">
              <IconTile type={finding.type} size="lg" />
              <div className="min-w-0">
                <div className="flex flex-wrap gap-2.5">
                  <span className="chip chip-plain">{finding.type === "unused_route" ? "Probably unused API" : typeLabel(finding.type)}</span>
                  <span className={clsx("chip", `chip-${finding.level}`)}>
                    {verdict(finding.level)} · {finding.confidence}%
                  </span>
                </div>
                <h1 className="mt-3.5 font-mono text-[clamp(28px,3.6vw,50px)] font-medium leading-[1.1] tracking-[-0.02em] [overflow-wrap:anywhere]">
                  {finding.name}
                </h1>
                <div className="mt-2.5 font-mono text-[13.5px] text-muted">{range}</div>
              </div>
            </div>
            <Actions scanId={scanId} finding={finding} />
          </div>
          {finding.type === "unused_route" && (
            <p className="mt-6 text-sm text-muted">External consumers (other services, clients) are not visible to static analysis.</p>
          )}
        </Container>
      </section>

      <Container className="flex flex-wrap pt-14">
        <Inscription title="Cause of death" className="flex-[1_1_360px] border-r border-[#231e1f] pb-6 pr-10">
          {supports.length > 0 ? (
            <EvidenceList items={supports} />
          ) : (
            <p className="title text-[26px] leading-[1.3]">{finding.summary || "No detailed evidence recorded."}</p>
          )}
        </Inscription>
        <Inscription title="Signs of life" className="flex-[1_1_360px] border-r border-[#231e1f] px-10 pb-6">
          {weakens.length > 0 ? <EvidenceList items={weakens} /> : <p className="title text-[26px] leading-[1.3]">None found.</p>}
        </Inscription>
        <Inscription title="Estimated impact" className="flex-[1_1_300px] pb-6 pl-10">
          <div className="flex items-baseline gap-3">
            <span className="title text-[64px] leading-none text-rose">{finding.impact_lines}</span>
            <span className="text-[15px] text-soft">lines</span>
          </div>
          <p className="mt-2 text-sm text-muted">
            <span className="font-mono">{share > 0 && share < 0.1 ? "<0.1" : share.toFixed(1)}%</span> of the codebase
          </p>
        </Inscription>
      </Container>

      <Container className="pt-10">
        <div role="tablist" aria-label="Evidence" className="flex flex-wrap gap-2.5">
          {visibleTabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active === t.key}
              onClick={() => setTab(t.key)}
              className={clsx("pill", active === t.key && "pill-on")}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="mt-[18px]">
          {active === "code" && finding.excerpt && <CodeExcerpt excerpt={finding.excerpt} file={finding.file} />}
          {active === "references" && <References references={references} />}
          {active === "graph" && <Neighborhood scanId={scanId} finding={finding} />}
        </div>
      </Container>

      <Container className="pt-16">
        <p className="eyebrow">Suggested burial</p>
        <h2 className="display mt-3 text-[clamp(32px,3.6vw,48px)] leading-[1.05]">
          Lay it to rest <em>with this diff</em>
        </h2>
        {suggestion ? (
          <div className="mt-6 space-y-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <StaticCheckBadge value={suggestion.static_check} />
              {finding.covered_by && (
                <Link to={`../${encodeURIComponent(finding.covered_by)}`} relative="path" className="text-xs text-soft underline">
                  Covered by another finding
                </Link>
              )}
              {suggestion.manual && <span className="text-xs text-muted">Needs a manual change</span>}
            </div>
            {(suggestion.cascades ?? []).length > 0 && (
              <div className="text-sm">
                <p className="label mb-1.5">Buried alongside</p>
                <ul className="list-disc space-y-0.5 pl-5 text-soft">
                  {(suggestion.cascades ?? []).map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
            {(suggestion.static_notes ?? []).length > 0 && (
              <ul className="list-disc space-y-0.5 pl-5 text-sm text-soft">
                {(suggestion.static_notes ?? []).map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
            {suggestion.diff ? <DiffView diff={suggestion.diff} /> : <p className="text-sm text-muted">No automatic change available.</p>}
          </div>
        ) : (
          <p className="mt-6 text-sm text-muted">No suggestion was prepared for this finding.</p>
        )}
      </Container>
    </>
  );
}

function Inscription({ title, className, children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <p className="eyebrow">{title}</p>
      <div className="mt-3.5">{children}</div>
    </div>
  );
}

function EvidenceList({ items }: { items: Evidence }) {
  return (
    <ul className="space-y-4">
      {items.map((item, index) => (
        <li key={`${item.code}-${index}`}>
          <p className="title text-[22px] leading-[1.3] [text-wrap:pretty]">{item.text}</p>
          {(item.locations ?? []).length > 0 && (
            <p className="mt-1.5 font-mono text-xs text-muted">
              {(item.locations ?? []).slice(0, 3).map((l) => `${l.file}:${l.line}`).join("  ·  ")}
            </p>
          )}
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
    <div className="grid overflow-hidden rounded-[20px] border border-border bg-[#100d0e] md:grid-cols-2">
      {groups.map(([title, list, empty], index) => (
        <div key={title} className={clsx("p-7", index > 0 && "border-t border-border md:border-l md:border-t-0")}>
          <p className="label">{title}</p>
          {list.length === 0 ? (
            <p className="title mt-3 text-[28px] leading-tight">{empty}</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {list.map((ref, i) => (
                <li key={`${ref.node_id}-${i}`} className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
                  <span className="font-mono text-[13.5px] [overflow-wrap:anywhere]" title={ref.node_id}>
                    {ref.node_id.split(":").slice(1).join(":") || ref.node_id}
                  </span>
                  <span className="font-mono text-xs text-muted">{ref.kind}</span>
                  {ref.liveness === "dead" && <span className="chip chip-high !px-2 !py-0.5">only from dead code</span>}
                  {ref.liveness === "test_only" && <span className="chip chip-low !px-2 !py-0.5">tests only</span>}
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
    <div className="flex flex-col items-start gap-3 sm:items-end">
      <div className="flex flex-wrap gap-3">
        <button
          className={clsx("btn btn-lg", current === "mark_alive" && "!border-rose !bg-accent-soft")}
          onClick={() => set(scanId, finding.id, current === "mark_alive" ? null : "mark_alive")}
        >
          {current === "mark_alive" ? "Spared" : "Spare it"}
        </button>
        <button
          className="btn btn-primary btn-lg"
          disabled={blocked}
          onClick={() => set(scanId, finding.id, current === "remove" ? null : "remove")}
        >
          <Shovel size={19} /> {current === "remove" ? "Unmark" : "Bury"}
        </button>
      </div>
      {current && (
        <Link to="../../cleanup" relative="path" className="font-mono text-xs uppercase tracking-[0.14em] text-soft hover:text-text">
          {current === "remove" ? "Marked for burial" : "Spared"} · to the burial →
        </Link>
      )}
    </div>
  );
}
