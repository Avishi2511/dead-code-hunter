import type { Level } from "@/api/client";

/**
 * The one place the dig-site vocabulary lives, so every screen tells the same story:
 * survey the grounds, examine the remains, bury what is dead.
 */
export const VERDICTS: Record<Level, string> = {
  high: "Certified dead",
  medium: "Probably dead",
  low: "Might still twitch",
};

export const verdict = (level: string): string => VERDICTS[level as Level] ?? level;

export const NAV = {
  graveyard: { label: "The Graveyard", hint: "Your codebase at a glance" },
  remains: { label: "Remains", hint: "Everything that looks dead" },
  catacombs: { label: "The Catacombs", hint: "How modules depend on each other" },
  burial: { label: "The Burial", hint: "Review and apply the removals" },
} as const;

export const EPITAPHS = {
  noRemains: "No remains found. This codebase is annoyingly healthy.",
  noMourners: "No one came to the funeral.",
  noTies: "Cut off from everything.",
  nothingMarked: "Nothing marked for burial yet.",
  noMatches: "Nothing buried here matches those filters.",
  noSuspicious: "No suspicious modules. The catacombs are quiet.",
} as const;

/** Liveness as the graph and panels describe it. */
export function livenessLabel(liveness: string): string {
  if (liveness === "dead") return "Dead: nothing reaches it";
  if (liveness === "test_only") return "Undead: alive only in tests";
  if (liveness === "live") return "Alive";
  return "Unknown";
}
