import clsx from "clsx";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Action, FindingDetail } from "@/api/client";
import { useFinding, useNeighborhood } from "@/api/hooks";
import { LevelBadge, StaticCheckBadge, TypeBadge } from "@/components/Badges";
import { CodeExcerpt } from "@/components/CodeExcerpt";
import { DiffView } from "@/components/DiffView";
import { GraphCanvas } from "@/components/GraphCanvas";
import { ErrorBox } from "@/components/Shell";
import { useScanSelection, useSelection } from "@/state/selection";

export function FindingPage() {
  const { id = "", fid = "" } = useParams();
  const { data: finding, error } = useFinding(id, fid);
  if (error) return <ErrorBox message={error.message} />;
  if (!finding) return <p className="text-muted">Loading…</p>;
  return <FindingView scanId={id} finding={finding} />;
}

function FindingView({ scanId, finding }: { scanId: string; finding: FindingDetail }) {
  const evidence = finding.evidence ?? [];
  const references = finding.references ?? [];
  const suggestion = finding.suggestion;
  const supports = evidence.filter((e) => e.polarity === "supports");
  const weakens = evidence.filter((e) => e.polarity === "weakens");

  return (
    <div className="space-y-8">
      <div>
        <Link to=".." relative="path" className="text-xs text-muted hover:text-text">
          ← All findings
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="font-mono text-xl font-semibold tracking-tight">{finding.name}</h1>
          <TypeBadge type={finding.type} />
          <LevelBadge level={finding.level} confidence={finding.confidence} />
        </div>
        <p className="mt-1 font-mono text-sm text-muted">
          {finding.file}:{finding.line}
          {finding.end_line > finding.line ? `–${finding.end_line}` : ""}
        </p>
        {finding.summary && <p className="mt-2 text-sm">{finding.summary}</p>}
        {finding.type === "unused_route" && (
          <p className="mt-2 text-sm text-muted">
            External consumers (other services, clients) are not visible to static analysis.
          </p>
        )}
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Why we think this is dead</h2>
        {evidence.length === 0 ? (
          <p className="text-sm text-muted">No detailed evidence recorded.</p>
        ) : (
          <ul className="card divide-y divide-border">
            {[...supports, ...weakens].map((item, index) => (
              <li key={`${item.code}-${index}`} className="flex gap-3 px-4 py-3 text-sm">
                <span className={clsx("mt-0.5 font-mono", item.polarity === "supports" ? "text-text" : "text-accent-hover")}>
                  {item.polarity === "supports" ? "✓" : "⚠"}
                </span>
                <div>
                  <p>{item.text}</p>
                  {(item.locations ?? []).length > 0 && (
                    <p className="mt-1 font-mono text-xs text-muted">
                      {(item.locations ?? []).slice(0, 4).map((l) => `${l.file}:${l.line}`).join("  ·  ")}
                    </p>
                  )}
                </div>
                <span className="ml-auto shrink-0 text-xs text-muted">{item.polarity === "supports" ? "supports" : "weakens"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {finding.excerpt && (
        <section>
          <h2 className="mb-3 text-sm font-semibold">Code</h2>
          <CodeExcerpt excerpt={finding.excerpt} file={finding.file} />
        </section>
      )}

      <References references={references} />
      <Neighborhood scanId={scanId} finding={finding} />

      <section>
        <h2 className="mb-3 text-sm font-semibold">Suggested change</h2>
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
                <p className="label mb-1">Cascades</p>
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
        <CleanupActions scanId={scanId} finding={finding} />
      </section>
    </div>
  );
}

function References({ references }: { references: NonNullable<FindingDetail["references"]> }) {
  const incoming = references.filter((r) => r.direction === "incoming");
  const outgoing = references.filter((r) => r.direction === "outgoing");
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">References</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {[
          ["Incoming", incoming],
          ["Outgoing", outgoing],
        ].map(([title, list]) => (
          <div key={title as string} className="card p-4">
            <p className="label mb-2">{title as string}</p>
            {(list as typeof incoming).length === 0 ? (
              <p className="text-sm text-muted">{title === "Incoming" ? "No incoming references." : "None."}</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {(list as typeof incoming).map((ref, index) => (
                  <li key={`${ref.node_id}-${index}`} className="flex items-baseline gap-2">
                    <span className="shrink-0 rounded border border-border px-1 font-mono text-[10px] uppercase text-muted">
                      {ref.kind}
                    </span>
                    <span className="truncate font-mono text-xs" title={ref.node_id}>
                      {ref.node_id.split(":").slice(1).join(":") || ref.node_id}
                    </span>
                    {ref.liveness === "dead" && <span className="shrink-0 text-xs text-accent-hover">only from dead code</span>}
                    {ref.liveness === "test_only" && <span className="shrink-0 text-xs text-muted">tests only</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function Neighborhood({ scanId, finding }: { scanId: string; finding: FindingDetail }) {
  const focus = useMemo(() => finding.node_ids.slice(0, 3), [finding.node_ids]);
  const { data, error, isLoading } = useNeighborhood(scanId, focus);
  const notes = useMemo(() => {
    const incoming = (finding.references ?? []).filter((r) => r.direction === "incoming").length;
    return incoming === 0 ? Object.fromEntries(focus.map((n) => [n, "No incoming references"])) : {};
  }, [finding, focus]);

  if (focus.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">Neighborhood</h2>
      {isLoading && <p className="text-sm text-muted">Loading graph…</p>}
      {error && <p className="text-sm text-muted">The graph is not available for this finding.</p>}
      {data && <GraphCanvas graph={data} notes={notes} height={360} />}
    </section>
  );
}

function CleanupActions({ scanId, finding }: { scanId: string; finding: FindingDetail }) {
  const selection = useScanSelection(scanId);
  const [action, setAction] = useState<Action>("remove");
  const current = selection[finding.id];
  const { set } = useSelection.getState();
  const disabled = Boolean(finding.covered_by) || Boolean(finding.suggestion?.manual);

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <div className="inline-flex overflow-hidden rounded-md border border-border text-sm">
        {(["remove", "mark_alive"] as const).map((value) => (
          <button
            key={value}
            onClick={() => setAction(value)}
            className={clsx("px-3 py-1.5", action === value ? "bg-accent text-text" : "text-muted")}
          >
            {value === "remove" ? "Remove" : "Mark as alive"}
          </button>
        ))}
      </div>
      {current ? (
        <>
          <span className="text-sm text-muted">In cleanup: {current === "remove" ? "remove" : "mark as alive"}</span>
          <button className="btn" onClick={() => set(scanId, finding.id, null)}>
            Remove from cleanup
          </button>
          <button className="btn" onClick={() => set(scanId, finding.id, action)} disabled={current === action}>
            Change to {action === "remove" ? "remove" : "mark as alive"}
          </button>
        </>
      ) : (
        <button className="btn btn-primary" disabled={disabled} onClick={() => set(scanId, finding.id, action)}>
          Add to cleanup
        </button>
      )}
      <Link to="../../cleanup" relative="path" className="text-sm text-muted underline">
        Go to cleanup
      </Link>
    </div>
  );
}
