import { describe, expect, it } from "vitest";
import { stageStates } from "./stages";

describe("stageStates", () => {
  it("marks earlier steps done and the current one active", () => {
    expect(stageStates("analyzing", "running")).toEqual(["done", "done", "active", "todo", "todo"]);
  });
  it("treats scoring as part of verifying and finished scans as all done", () => {
    expect(stageStates("scoring", "running")[3]).toBe("active");
    expect(stageStates("done", "done").every((s) => s === "done")).toBe(true);
  });
  it("starts at the first step for unknown stages", () => {
    expect(stageStates("queued", "running")[0]).toBe("active");
  });
});
