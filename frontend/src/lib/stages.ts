export interface Stage {
  key: string;
  label: string;
  /** API stage names that belong to this step. */
  apiStages: string[];
}

export const STAGES: Stage[] = [
  { key: "downloading", label: "Downloading", apiStages: ["queued", "downloading"] },
  { key: "parsing", label: "Parsing & building graph", apiStages: ["parsing"] },
  { key: "analyzing", label: "Analyzing", apiStages: ["analyzing"] },
  { key: "verifying", label: "Verifying", apiStages: ["verifying", "scoring"] },
  { key: "suggestions", label: "Preparing suggestions", apiStages: ["suggestions", "done"] },
];

export type StageState = "done" | "active" | "todo";

export function stageStates(apiStage: string, status: string): StageState[] {
  if (status === "done") return STAGES.map(() => "done");
  const current = Math.max(
    0,
    STAGES.findIndex((s) => s.apiStages.includes(apiStage)),
  );
  return STAGES.map((_, index) => (index < current ? "done" : index === current ? "active" : "todo"));
}
