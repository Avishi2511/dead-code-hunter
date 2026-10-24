import { Skull } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import clsx from "clsx";
import { typeIcon } from "@/lib/icons";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-2.5", className)}>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-accent bg-accent-soft text-[#d98a96]">
        <Skull size={18} strokeWidth={1.75} />
      </span>
      <span className="font-mono text-[11px] font-medium leading-[1.15] tracking-[0.22em]">
        DEAD CODE
        <br />
        HUNTER
      </span>
    </span>
  );
}

export function GithubMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2.15c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.35.96.1-.74.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.62 1.59.23 2.76.11 3.05.74.81 1.18 1.83 1.18 3.09 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

/** Rounded burgundy tile holding a finding-type (or any) icon, as in the findings table and the Graveyard. */
export function IconTile({
  type,
  icon,
  size = "md",
  muted = false,
}: {
  type?: string;
  icon?: LucideIcon;
  size?: "sm" | "md" | "lg";
  muted?: boolean;
}) {
  const Icon = icon ?? typeIcon(type ?? "");
  const box = { sm: "h-7 w-7", md: "h-9 w-9", lg: "h-12 w-12" }[size];
  const glyph = { sm: 14, md: 17, lg: 24 }[size];
  return (
    <span
      className={clsx(
        "flex shrink-0 items-center justify-center rounded-lg border",
        box,
        muted ? "border-border bg-surface-2 text-muted" : "border-accent/70 bg-accent-soft text-[#d98a96]",
      )}
    >
      <Icon size={glyph} strokeWidth={1.75} />
    </span>
  );
}

/** Faint ruined-skyline silhouette used at the bottom of hero banners. */
export function Ruins({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 800 120" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <path
        fill="currentColor"
        d="M0 120V92l18-4 6-14 10 2 4-20 12 4 8-26 8 26 10-6v18l14 4 6 -8 10 12 12-2 4-30 10-10 6 10v34l18-6 8-18 10 4 4 24 16-2 6-30 14-34 6 4 4 24 14 6 8-12 12 6 6 22 20-4 10-16 12 2 6 20 22 4 4-18 12-8 8 14 6 20 14-2 10-24 8-50 6 18 6-16 8 40 12 4 6-14 14 6 6 28 18-2 8 -16 14 4 8 14 16 4 4-24 10-6 8 18 14-4 8-22 12 4 6 20 20 2 4-12 14 2 6 16 18 0 6-22 10-8 12 12 6 22 16 0 4-14 14-4 8 20 14 2 6-16 14 0V120Z"
      />
    </svg>
  );
}
