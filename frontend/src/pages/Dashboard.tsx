import { ArrowRight, TriangleAlert } from "lucide-react";
import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import type { Level } from "@/api/client";
import { useFindings } from "@/api/hooks";
import { IconTile } from "@/components/Brand";
import { Container } from "@/components/Shell";
import { kindLabel, typeLabel } from "@/lib/format";
import { typeIcon } from "@/lib/icons";
import { EPITAPHS, VERDICTS } from "@/lib/lexicon";
import { useScanContext } from "./ScanLayout";

/** One stone per finding up to here; past it the field would stop being readable. */
const MAX_STONES = 90;

const STONE: Record<Level, string> = {
  high: "border-accent-hover bg-accent/40 text-[#f3c4cc]",
  medium: "border-[#a8626d] bg-surface text-rose",
  low: "border-dashed border-[#7d6a6c] bg-transparent text-soft",
};

const TIERS: { level: Level; blurb: string; card: string; number: string }[] = [
  { level: "high", blurb: "Safe to bury with the usual review.", card: "border-accent-hover bg-accent/20", number: "text-rose" },
  { level: "medium", blurb: "Worth a second look at the signs of life.", card: "border-[#5a2630] bg-surface", number: "text-rose" },
  { level: "low", blurb: "Spare these unless you can prove otherwise.", card: "border-dashed border-[#5a4f50]", number: "text-soft" },
];

export function Dashboard() {
  const { id = "" } = useParams();
  const scan = useScanContext();
  const { data } = useFindings(id);
  const items = useMemo(() => data?.items ?? [], [data]);
  const stats = scan.stats;

  const counts = useMemo(() => {
    const byLevel: Record<Level, number> = { high: 0, medium: 0, low: 0 };
    for (const f of items) byLevel[f.level] += 1;
    return byLevel;
  }, [items]);
  const files = useMemo(() => new Set(items.map((f) => f.file)).size, [items]);
  const byType = Object.entries(stats.findings_by_type ?? {}).sort((a, b) => b[1] - a[1]);
  const maxCount = Math.max(1, ...byType.map(([, count]) => count));
  const total = data?.total ?? byType.reduce((sum, [, count]) => sum + count, 0);
  const lines = stats.potential_cleanup_lines;
  const stones = items.slice(0, MAX_STONES);

  const tombstones = [
    { value: counts.high.toLocaleString(), label: "certified dead", pad: "pt-12", min: "min-h-[210px]" },
    { value: lines.toLocaleString(), label: "lines to remove", pad: "pt-14", min: "min-h-[250px]" },
    { value: files.toLocaleString(), label: "files affected", pad: "pt-[42px]", min: "min-h-[190px]" },
  ];

  return (
    <>
      {scan.warnings.length > 0 && (
        <Container className="pt-8">
          <section className="card flex gap-3 border-accent-hover/50 p-4">
            <TriangleAlert size={18} className="mt-0.5 shrink-0 text-rose" />
            <ul className="space-y-1 text-sm text-soft">
              {scan.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </section>
        </Container>
      )}

      <Container className="flex flex-wrap items-end justify-between gap-x-14 gap-y-10 pt-[72px]">
        <div className="min-w-0 flex-1 basis-[520px]">
          <p className="eyebrow">Findings</p>
          <div className="display mt-7 text-[clamp(120px,17vw,240px)] font-light leading-[0.82] tracking-[-0.05em] text-rose">
            {total}
          </div>
          {total === 0 ? (
            <h2 className="display mt-[18px] max-w-[620px] text-[clamp(30px,3.4vw,48px)] leading-[1.08]">{EPITAPHS.noRemains}</h2>
          ) : (
            <h2 className="display mt-[18px] max-w-[620px] text-[clamp(30px,3.4vw,48px)] leading-[1.08]">
              {total === 1 ? "remain" : "remains"}, about {lines.toLocaleString()} lines <em>waiting to be laid to rest.</em>
            </h2>
          )}
        </div>
        <div className="flex max-w-[560px] flex-[1_1_440px] flex-wrap items-end gap-4">
          {tombstones.map((t) => (
            <div
              key={t.label}
              className={`flex-[1_1_150px] rounded-b-[10px] rounded-t-[75px] border border-border bg-surface px-3.5 pb-[18px] text-center ${t.pad} ${t.min}`}
            >
              <div className="title text-[46px] leading-none">{t.value}</div>
              <div className="mt-2 text-[13px] leading-snug text-muted">{t.label}</div>
            </div>
          ))}
        </div>
      </Container>

      {stones.length > 0 && (
        <section className="mt-20 border-t border-[#1f1a1b] bg-[#0e0b0c] pt-[72px]">
          <Container>
            <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
              <div className="flex-[1_1_380px]">
                <p className="eyebrow">The grounds</p>
                <h2 className="display mt-3 text-[clamp(34px,4vw,56px)]">
                  Every grave, <em>one stone each</em>
                </h2>
              </div>
              <ul aria-label="Legend" className="flex flex-wrap gap-x-[22px] gap-y-2.5 font-mono text-[11.5px] uppercase tracking-[0.1em] text-soft">
                {TIERS.map(({ level }) => (
                  <li key={level} className="flex items-center gap-2">
                    <span className={`h-[18px] w-3.5 rounded-b-sm rounded-t-[7px] border ${STONE[level]}`} />
                    {VERDICTS[level]} · {counts[level]}
                  </li>
                ))}
              </ul>
            </div>

            <ul aria-label={`All ${total} findings`} className="mt-14 flex flex-wrap items-end justify-center gap-x-3.5 gap-y-[18px]">
              {stones.map((f, i) => (
                <li key={f.id}>
                  <Link
                    to={`findings/${encodeURIComponent(f.id)}`}
                    title={`${f.name}, ${VERDICTS[f.level].toLowerCase()}`}
                    aria-label={`${f.name}, ${typeLabel(f.type)}, ${VERDICTS[f.level].toLowerCase()}`}
                    className={`flex w-[62px] items-start justify-center rounded-b-[7px] rounded-t-[31px] border pt-5 transition-transform duration-200 hover:-translate-y-1.5 motion-reduce:transition-none ${STONE[f.level]}`}
                    style={{ height: 84 + ((i * 13) % 5) * 9 }}
                  >
                    <IconGlyph type={f.type} />
                  </Link>
                </li>
              ))}
            </ul>
            {total > stones.length && (
              <p className="mt-6 text-center font-mono text-xs tracking-[0.1em] text-muted">
                + {total - stones.length} more in the remains
              </p>
            )}
          </Container>
          <div
            aria-hidden="true"
            className="h-[90px] border-t border-[#33292b]"
            style={{
              background:
                "radial-gradient(rgba(237,230,225,.06) 1px,transparent 1.6px) 0 0/22px 22px,linear-gradient(#150f10,#0b0a0a)",
            }}
          />
        </section>
      )}

      <Container className="flex flex-wrap gap-x-16 gap-y-12 pt-20">
        <div className="min-w-0 flex-[1_1_520px]">
          <p className="eyebrow">By kind</p>
          <h2 className="title mt-3 text-[34px] leading-[1.1]">What is buried</h2>
          {byType.length === 0 ? (
            <p className="title mt-7 text-lg italic text-muted">{EPITAPHS.noRemains}</p>
          ) : (
            <div className="mt-7 flex flex-col">
              {byType.map(([type, count]) => (
                <Link
                  key={type}
                  to={`findings?type=${type}`}
                  className="group flex items-center gap-4 border-t border-[#231e1f] py-3.5 transition-colors hover:bg-surface/60"
                >
                  <IconTile type={type} size="sm" />
                  <span className="title w-[130px] shrink-0 text-xl">{kindLabel(type)}</span>
                  <span className="h-[5px] flex-1 overflow-hidden rounded bg-[#231e1f]">
                    <span className="block h-full bg-rose" style={{ width: `${Math.round((count / maxCount) * 100)}%` }} />
                  </span>
                  <span className="w-[30px] text-right font-mono text-[15px]">{count}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-[1_1_420px]">
          <p className="eyebrow">By confidence</p>
          <h2 className="title mt-3 text-[34px] leading-[1.1]">How sure we are</h2>
          <div className="mt-7 flex flex-col gap-4">
            {TIERS.map(({ level, blurb, card, number }) => (
              <Link
                key={level}
                to={`findings?level=${level}`}
                className={`flex items-baseline justify-between gap-4 rounded-2xl border px-6 py-[22px] transition-colors hover:border-rose ${card}`}
              >
                <div>
                  <div className="title text-2xl">{VERDICTS[level]}</div>
                  <div className="mt-1 text-[13.5px] text-muted">{blurb}</div>
                </div>
                <div className={`title text-5xl leading-none ${number}`}>{counts[level]}</div>
              </Link>
            ))}
          </div>
          <Link to="findings" className="btn btn-primary btn-lg mt-7">
            Review the remains <ArrowRight size={18} />
          </Link>
        </div>
      </Container>
    </>
  );
}

function IconGlyph({ type }: { type: string }) {
  const Icon = typeIcon(type);
  return <Icon size={22} strokeWidth={1.7} aria-hidden="true" />;
}
