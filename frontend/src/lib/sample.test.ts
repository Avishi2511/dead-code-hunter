import { describe, expect, it } from "vitest";
import { CYCLE_TICKS, FINAL_TICK, SAMPLE_FINDINGS, frameAt } from "./sample";

describe("frameAt", () => {
  it("starts empty and surveying", () => {
    expect(frameAt(0)).toEqual({ stage: "Surveying the grounds", progress: 0, shown: 0, done: false });
  });

  it("never moves progress or revealed findings backwards within a cycle", () => {
    let progress = 0;
    let shown = 0;
    for (let t = 0; t < CYCLE_TICKS; t++) {
      const frame = frameAt(t);
      expect(frame.progress).toBeGreaterThanOrEqual(progress);
      expect(frame.shown).toBeGreaterThanOrEqual(shown);
      progress = frame.progress;
      shown = frame.shown;
    }
  });

  it("finishes with every finding shown, then loops", () => {
    const final = frameAt(FINAL_TICK);
    expect(final).toMatchObject({ done: true, progress: 100, shown: SAMPLE_FINDINGS.length });
    expect(frameAt(CYCLE_TICKS)).toEqual(frameAt(0));
  });
});
