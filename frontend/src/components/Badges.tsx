import clsx from "clsx";
import type { Level } from "@/api/client";
import { LEVEL_LABELS, typeLabel } from "@/lib/format";

export function LevelBadge({ level, confidence }: { level: Level; confidence?: number }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-xs",
        level === "high" && "border-accent bg-accent-soft text-text",
        level === "medium" && "border-accent/60 text-text",
        level === "low" && "border-border text-muted",
      )}
    >
      {confidence !== undefined && <span>{confidence}%</span>}
      <span className="uppercase tracking-wide">{LEVEL_LABELS[level]}</span>
    </span>
  );
}

export function TypeBadge({ type }: { type: string }) {
  return (
    <span className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-xs text-muted">
      {typeLabel(type)}
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
    <span
      className={clsx(
        "rounded border px-1.5 py-0.5 text-xs",
        value === "pass" && "border-border text-muted",
        value === "fail" && "border-accent text-text",
        value === "skipped" && "border-border text-muted",
      )}
    >
      {CHECK_LABELS[value] ?? value}
    </span>
  );
}
