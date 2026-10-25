/** Scripted "sample hunt" shown on the home page. It is illustrative data, and is labelled as such in the UI. */
export interface SampleFinding {
  type: string;
  name: string;
  path: string;
  level: "high" | "medium" | "low";
  confidence: number;
}

export const SAMPLE_FINDINGS: SampleFinding[] = [
  { type: "unused_function", name: "send_welcome_email", path: "app/services/mailer.py", level: "high", confidence: 97 },
  { type: "unused_class", name: "LegacyCache", path: "app/core/cache.py", level: "high", confidence: 94 },
  { type: "unused_import", name: "pandas", path: "app/api/reports.py", level: "high", confidence: 99 },
  { type: "unused_route", name: "GET /v1/export", path: "app/api/routes/export.py", level: "medium", confidence: 81 },
  { type: "unused_dependency", name: "celery", path: "requirements.txt", level: "medium", confidence: 76 },
  { type: "unused_module", name: "old_helpers.py", path: "app/utils/old_helpers.py", level: "low", confidence: 62 },
];

export const TICK_MS = 420;
export const CYCLE_TICKS = 32;
/** The tick at which the scan is complete; reduced-motion visitors are shown this frame. */
export const FINAL_TICK = 22;

/** The five layers of a scan, shallowest first; the sample and the real progress screen use the same words. */
export const STAGE_NAMES = [
  "Surveying the grounds",
  "Digging in and mapping the graves",
  "Examining the remains",
  "Checking for a pulse",
  "Writing the death certificates",
];
export const STAGE_DEPTHS = ["0.0 m", "0.5 m", "2.0 m", "3.5 m", "5.0 m"];

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
