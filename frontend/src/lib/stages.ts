export interface Stage {
  key: string;
  label: string;
  /** API stage names that belong to this step. */
  apiStages: string[];
}

export const STAGES: Stage[] = [
  { key: "downloading", label: "Surveying the grounds", apiStages: ["queued", "downloading"] },
  { key: "parsing", label: "Digging in and mapping the graves", apiStages: ["parsing"] },
  { key: "analyzing", label: "Examining the remains", apiStages: ["analyzing"] },
  { key: "verifying", label: "Checking for a pulse", apiStages: ["verifying", "scoring"] },
  { key: "suggestions", label: "Writing the death certificates", apiStages: ["suggestions", "done"] },
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
