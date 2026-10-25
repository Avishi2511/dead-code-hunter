/** Scripted "sample hunt" shown on the home page. It is illustrative data, and is labelled as such in the UI. */
export interface SampleFinding {
  type: string;
  name: string;
  level: "high" | "medium";
  confidence: number;
}

export const SAMPLE_FINDINGS: SampleFinding[] = [
  { type: "unused_dependency", name: "moment", level: "high", confidence: 99 },
  { type: "unused_function", name: "legacy_user_lookup", level: "high", confidence: 94 },
  { type: "unused_class", name: "LegacyTable", level: "high", confidence: 91 },
  { type: "unused_route", name: "GET /api/legacy/users", level: "medium", confidence: 87 },
  { type: "unused_import", name: "unused_import", level: "medium", confidence: 72 },
  { type: "unreachable_code", name: "dead_branch", level: "medium", confidence: 68 },
];

export const TICK_MS = 420;
export const CYCLE_TICKS = 32;
/** The tick at which the scan is complete; reduced-motion visitors are shown this frame. */
export const FINAL_TICK = 22;

const STAGES: [number, string][] = [
  [0, "Surveying the grounds"],
  [4, "Digging in and mapping the graves"],
  [9, "Examining the remains"],
  [14, "Checking for a pulse"],
  [19, "Writing the death certificates"],
];

export interface SampleFrame {
  stage: string;
  progress: number;
  shown: number;
  done: boolean;
}

export function frameAt(tick: number): SampleFrame {
  const t = ((tick % CYCLE_TICKS) + CYCLE_TICKS) % CYCLE_TICKS;
  const stage = [...STAGES].reverse().find(([from]) => t >= from)?.[1] ?? STAGES[0][1];
  const done = t >= FINAL_TICK - 1;
  const progress = done ? 100 : Math.min(98, Math.round((t / (FINAL_TICK - 1)) * 100));
  const shown = Math.max(0, Math.min(SAMPLE_FINDINGS.length, Math.floor((t - 13) / 1.5) + 1));
  return { stage: done ? "Hunt complete" : stage, progress, shown: t >= 13 ? shown : 0, done };
}
