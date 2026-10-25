import { ArrowRight, TriangleAlert } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { useFindings } from "@/api/hooks";
import { IconTile } from "@/components/Brand";
import { typeLabel } from "@/lib/format";
import { TILE_LABELS } from "@/lib/icons";
import { EPITAPHS, NAV } from "@/lib/lexicon";
import { PageTitle } from "@/components/Shell";
import { useScanContext } from "./ScanLayout";

const GRAVEYARD_SIZE = 6;

export function Dashboard() {
  const { id = "" } = useParams();
  const scan = useScanContext();
  const { data: high } = useFindings(id, { level: "high" });
  const stats = scan.stats;
  const byType = Object.entries(stats.findings_by_type ?? {}).sort((a, b) => b[1] - a[1]);
  const lines = stats.potential_cleanup_lines;
  const share = stats.python_lines > 0 ? (lines / stats.python_lines) * 100 : 0;
  const graveyard = (high?.items ?? []).filter((f) => !f.covered_by).slice(0, GRAVEYARD_SIZE);

  return (
    <div className="space-y-6">
      <PageTitle title={NAV.graveyard.label} subtitle={NAV.graveyard.hint} />
      {scan.warnings.length > 0 && (
        <section className="card flex gap-3 border-accent/50 p-4">
          <TriangleAlert size={18} className="mt-0.5 shrink-0 text-[#d98a96]" />
          <ul className="space-y-1 text-sm text-muted">
            {scan.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="card p-5">
          <p className="label">The grounds</p>
          <p className="mt-2 font-mono text-3xl">
            {stats.python_files.toLocaleString()} <span className="text-base text-muted">files surveyed</span>
          </p>
          {byType.length === 0 ? (
            <p className="title mt-5 text-lg italic text-muted">{EPITAPHS.noRemains}</p>
          ) : (
            <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3">
              {byType.map(([type, count]) => (
                <Link
                  key={type}
                  to={`findings?type=${type}`}
                  className="group flex items-center gap-3 rounded-lg p-1.5 transition-colors hover:bg-surface-2"
                >
                  <IconTile type={type} />
                  <span>
                    <span className="block font-mono text-xl leading-none">{count}</span>
                    <span className="mt-1 block text-xs text-muted">{TILE_LABELS[type] ?? typeLabel(type)}</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="card flex flex-col p-5">
          <p className="label">To lay to rest</p>
          <p className="mt-2 font-mono text-3xl">
            ~{lines.toLocaleString()} <span className="text-base text-muted">lines</span>
          </p>
          <div className="bar-track mt-4">
            <div className="bar-fill" style={{ width: `${Math.min(Math.max(share, lines > 0 ? 2 : 0), 100)}%` }} />
          </div>
          <p className="mt-3 text-xs text-muted">
            Estimated impact{" "}
            <span className="font-mono text-[#d98a96]">~{share < 1 && share > 0 ? share.toFixed(1) : Math.round(share)}%</span>{" "}
            of the codebase
          </p>
          <p className="mt-auto pt-4 text-xs text-muted">High and medium confidence findings only.</p>
        </div>
      </section>

      <section className="card">
        <div className="flex items-baseline justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="label">Certified dead</h2>
            <p className="mt-1 text-xs text-muted">The remains we are most sure about</p>
          </div>
          <Link to="findings?level=high" className="flex items-center gap-1 text-xs text-muted hover:text-text">
            Examine all remains {high ? `(${high.total})` : ""} <ArrowRight size={13} />
          </Link>
        </div>
        {graveyard.length === 0 ? (
          <p className="title px-5 py-6 text-lg italic text-muted">Nobody is certifiably dead. Check the rest of the remains.</p>
        ) : (
          <ul className="divide-y divide-border">
            {graveyard.map((finding) => (
              <li key={finding.id}>
                <Link
                  to={`findings/${encodeURIComponent(finding.id)}`}
                  className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2"
                >
                  <IconTile type={finding.type} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-sm">{finding.name}</span>
                    <span className="block truncate font-mono text-xs text-muted">
                      {finding.file}:{finding.line}
                    </span>
                  </span>
                  <span className="hidden text-xs text-muted sm:block">{typeLabel(finding.type)}</span>
                  <span className="w-12 text-right font-mono text-sm text-[#d98a96]">{finding.confidence}%</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
