import { Link, useParams } from "react-router-dom";
import { useFindings } from "@/api/hooks";
import { LevelBadge, TypeBadge } from "@/components/Badges";
import { pluralize, typeLabel } from "@/lib/format";
import { useScanContext } from "./ScanLayout";

const GRAVEYARD_SIZE = 8;

export function Dashboard() {
  const { id = "" } = useParams();
  const scan = useScanContext();
  const { data: high } = useFindings(id, { level: "high" });
  const stats = scan.stats;
  const byType = Object.entries(stats.findings_by_type ?? {}).sort((a, b) => b[1] - a[1]);
  const total = byType.reduce((sum, [, n]) => sum + n, 0);
  const graveyard = (high?.items ?? []).filter((f) => !f.covered_by).slice(0, GRAVEYARD_SIZE);

  return (
    <div className="space-y-8">
      <section className="grid gap-3 sm:grid-cols-3">
        <Tile label="Python files" value={stats.python_files.toLocaleString()} />
        <Tile label="Findings" value={total.toLocaleString()} />
        <Tile label="Potential cleanup" value={`~${stats.potential_cleanup_lines.toLocaleString()} lines`} accent />
      </section>

      {scan.warnings.length > 0 && (
        <section className="card border-accent/50 p-4">
          <p className="label mb-2">Notes about this scan</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            {scan.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold">By type</h2>
        {byType.length === 0 ? (
          <p className="text-sm text-muted">No dead code found. Either this project is tidy, or nothing here was reachable to judge.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {byType.map(([type, count]) => (
              <Link
                key={type}
                to={`findings?type=${type}`}
                className="card flex items-center justify-between px-4 py-2.5 text-sm transition-colors hover:border-accent"
              >
                <span>{typeLabel(type)}</span>
                <span className="font-mono text-muted">{count}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">The Graveyard</h2>
          <Link to="findings?level=high" className="text-xs text-muted hover:text-text">
            All high-confidence findings →
          </Link>
        </div>
        {graveyard.length === 0 ? (
          <p className="text-sm text-muted">Nothing buried with high confidence.</p>
        ) : (
          <ul className="card divide-y divide-border">
            {graveyard.map((finding) => (
              <li key={finding.id}>
                <Link to={`findings/${encodeURIComponent(finding.id)}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                  <LevelBadge level={finding.level} confidence={finding.confidence} />
                  <TypeBadge type={finding.type} />
                  <span className="truncate font-mono text-sm">{finding.name}</span>
                  <span className="ml-auto hidden truncate font-mono text-xs text-muted sm:block">
                    {finding.file}:{finding.line}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {high && high.total > GRAVEYARD_SIZE && (
          <p className="mt-2 text-xs text-muted">{pluralize(high.total - GRAVEYARD_SIZE, "more finding")} at high confidence.</p>
        )}
      </section>
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`card p-4 ${accent ? "border-accent" : ""}`}>
      <div className="label">{label}</div>
      <div className="mt-1.5 font-mono text-2xl">{value}</div>
    </div>
  );
}
