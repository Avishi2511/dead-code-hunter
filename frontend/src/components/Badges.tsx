import clsx from "clsx";
import type { Level } from "@/api/client";
import { typeLabel } from "@/lib/format";
import { verdict } from "@/lib/lexicon";

export function LevelBadge({ level, confidence }: { level: Level; confidence?: number }) {
  return (
    <span className={clsx("chip", `chip-${level}`)}>
      {confidence !== undefined && <span>{confidence}%</span>}
      <span>{verdict(level)}</span>
    </span>
  );
}

export function TypeBadge({ type }: { type: string }) {
  return <span className="chip chip-plain">{typeLabel(type)}</span>;
}

/** The confidence as a thin bar plus the number, the way the findings ledger shows it. */
export function ConfidenceBar({ level, value }: { level: Level; value: number }) {
  const color = { high: "#d98a96", medium: "#a8626d", low: "#7d6a6c" }[level];
  return (
    <span className="flex items-center gap-2.5">
      <span className="h-1 flex-1 overflow-hidden rounded bg-border">
        <span className="block h-full" style={{ width: `${value}%`, background: color }} />
      </span>
      <span className="w-9 text-right font-mono text-[13px]">{value}%</span>
    </span>
  );
}

const CHECK_LABELS: Record<string, string> = {
  pass: "Static check passed",
  fail: "Static check found problems",
  skipped: "Static check skipped",
};

export function StaticCheckBadge({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  return (
    <span className={clsx("chip", value === "fail" ? "chip-high" : "chip-plain")}>{CHECK_LABELS[value] ?? value}</span>
  );
}
