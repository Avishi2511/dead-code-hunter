import clsx from "clsx";
import { useEffect, useState } from "react";
import { IconTile } from "@/components/Brand";
import { typeLabel } from "@/lib/format";
import { verdict } from "@/lib/lexicon";
import { useInView, usePrefersReducedMotion } from "@/lib/motion";
import { FINAL_TICK, SAMPLE_FINDINGS, TICK_MS, frameAt } from "@/lib/sample";

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

  return (
    <div ref={ref} className="card overflow-hidden" aria-label="Sample hunt" role="img">
      <div className="flex items-center justify-between border-b border-border bg-surface-2 px-4 py-2.5">
        <span className="font-mono text-xs">example/legacy-api</span>
        <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted">
          sample data
        </span>
      </div>

      <div className="px-4 pb-1 pt-4">
        <div className="flex items-center justify-between text-xs">
          <span className={clsx(frame.done ? "text-text" : "text-muted")}>
            {frame.stage}
            {!frame.done && <span className="animate-pulse">…</span>}
          </span>
          <span className="font-mono text-muted">{frame.progress}%</span>
        </div>
        <div className="bar-track mt-2">
          <div className="bar-fill transition-[width] duration-500 ease-out" style={{ width: `${frame.progress}%` }} />
        </div>
      </div>

      <ul className="space-y-1 px-2 py-3">
        {SAMPLE_FINDINGS.map((finding, index) => (
          <li
            key={finding.name}
            className={clsx("sample-row flex items-center gap-3 rounded-md px-2 py-1.5", index < frame.shown && "show")}
          >
            <IconTile type={finding.type} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-sm">{finding.name}</span>
              <span className="block text-[11px] text-muted">{typeLabel(finding.type)}</span>
            </span>
            <span className="text-right leading-tight">
              <span className={clsx("block font-mono text-sm", finding.level === "high" ? "text-[#d98a96]" : "text-text")}>
                {finding.confidence}%
              </span>
              <span className="text-[11px] text-muted">{verdict(finding.level)}</span>
            </span>
          </li>
        ))}
      </ul>

      <div
        className={clsx(
          "border-t border-border px-4 py-2.5 text-xs transition-opacity duration-500",
          frame.done ? "opacity-100" : "opacity-0",
        )}
      >
        <span className="font-mono">{SAMPLE_FINDINGS.length}</span> remains found ·{" "}
        <span className="text-[#d98a96]">~212 lines</span> to lay to rest
      </div>
    </div>
  );
}
