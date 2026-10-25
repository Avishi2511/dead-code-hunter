import clsx from "clsx";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { ConfidenceBar, LevelBadge } from "@/components/Badges";
import { IconTile } from "@/components/Brand";
import { typeLabel } from "@/lib/format";
import { useInView, usePrefersReducedMotion } from "@/lib/motion";
import { FINAL_TICK, SAMPLE_FINDINGS, STAGE_DEPTHS, STAGE_NAMES, TICK_MS, frameAt } from "@/lib/sample";

/** A looping, scripted hunt. It plays only while on screen and is clearly labelled as sample data. */
export function SampleScan() {
  const reduced = usePrefersReducedMotion();
  const [ref, inView] = useInView<HTMLDivElement>(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (reduced || !inView) return;
    const timer = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(timer);
  }, [reduced, inView]);

  const frame = frameAt(reduced ? FINAL_TICK : tick);
  const active = frame.done ? STAGE_NAMES.length : STAGE_NAMES.indexOf(frame.stage);

  return (
    <div ref={ref} className="flex flex-wrap items-stretch gap-6" role="img" aria-label="Sample hunt on a made-up repository">
      <div className="flex max-w-[400px] flex-[1_1_300px] flex-col rounded-[20px] border border-border bg-[#100d0e] px-7 pb-7 pt-[30px]">
        <div className="label !tracking-[0.2em]">Depth gauge</div>
        <ol className="relative mt-[26px] flex flex-col gap-[26px]">
          <span aria-hidden="true" className="absolute bottom-3 left-2.5 top-3 w-px bg-[#2f292a]" />
          {STAGE_NAMES.map((name, index) => {
            const done = index < active;
            const current = index === active;
            return (
              <li key={name} className="relative flex items-start gap-4">
                <span
                  className={clsx(
                    "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors duration-500",
                    done && "border-accent-hover bg-accent",
                    current && "ring-pulse border-rose bg-bg",
                    !done && !current && "border-strong bg-bg",
                  )}
                >
                  {done && <Check size={12} strokeWidth={3} />}
                </span>
                <div className="min-w-0">
                  <div
                    className={clsx(
                      "title text-xl leading-tight transition-colors duration-500",
                      done ? "text-soft" : current ? "text-text" : "text-muted",
                    )}
                  >
                    {name}
                  </div>
                  <div className="mt-[3px] font-mono text-[11px] tracking-[0.1em] text-muted">
                    {STAGE_DEPTHS[index]} · {done ? "done" : current ? "digging" : "waiting"}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="mt-auto pt-[34px]">
          <div className="h-1 overflow-hidden rounded bg-[#231e1f]">
            <div className="h-full bg-rose transition-[width] duration-700 ease-out" style={{ width: `${frame.progress}%` }} />
          </div>
          <div className="mt-2.5 font-mono text-[11px] tracking-[0.14em] text-muted">{frame.progress}% EXCAVATED</div>
        </div>
      </div>

      <div className="flex min-w-0 flex-[2_1_560px] flex-col overflow-hidden rounded-[20px] border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 bg-surface-2 px-6 py-5">
          <span className="font-mono text-sm">example/legacy-api</span>
          <span className="chip chip-low">Sample data</span>
        </div>
        <div className="flex flex-1 flex-col">
          {SAMPLE_FINDINGS.map((finding, index) => (
            <div
              key={finding.name}
              className={clsx(
                "sample-row flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-[#231e1f] px-6 py-4",
                index < frame.shown && "show",
              )}
            >
              <IconTile type={finding.type} size="md" />
              <div className="min-w-0 flex-[1_1_200px]">
                <div className="font-mono text-[15px] font-medium [overflow-wrap:anywhere]">{finding.name}</div>
                <div className="mt-[3px] font-mono text-xs text-muted [overflow-wrap:anywhere]">
                  {typeLabel(finding.type).replace(/^Unused /, "").toLowerCase()} · {finding.path}
                </div>
              </div>
              <div className="w-[150px] shrink-0">
                <ConfidenceBar level={finding.level} value={finding.confidence} />
              </div>
              <div className="w-[150px] shrink-0 text-center">
                <LevelBadge level={finding.level} />
              </div>
            </div>
          ))}
        </div>
        <div
          className={clsx(
            "flex flex-wrap items-baseline gap-x-9 gap-y-1.5 border-t border-border bg-[#100d0e] px-6 py-[22px] transition-opacity duration-700",
            frame.done ? "opacity-100" : "opacity-0",
          )}
        >
          <div className="flex items-baseline gap-3">
            <span className="title text-[52px] leading-none text-rose">{SAMPLE_FINDINGS.length}</span>
            <span className="text-[15px] text-soft">remains found</span>
          </div>
          <div className="flex items-baseline gap-3">
            <span className="title text-[52px] leading-none text-rose">~212</span>
            <span className="text-[15px] text-soft">lines to lay to rest</span>
          </div>
        </div>
      </div>
    </div>
  );
}
