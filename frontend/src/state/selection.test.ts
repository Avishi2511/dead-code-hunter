import { beforeEach, describe, expect, it } from "vitest";
import { useSelection } from "./selection";

describe("selection store", () => {
  beforeEach(() => useSelection.setState({ byScan: {} }));

  it("keeps selections per scan and supports removal", () => {
    const { set, setMany, clear } = useSelection.getState();
    set("a", "f1", "remove");
    setMany("a", ["f2", "f3"], "mark_alive");
    set("b", "f1", "remove");
    expect(useSelection.getState().byScan.a).toEqual({ f1: "remove", f2: "mark_alive", f3: "mark_alive" });
    set("a", "f1", null);
    expect(Object.keys(useSelection.getState().byScan.a)).toEqual(["f2", "f3"]);
    clear("a");
    expect(useSelection.getState().byScan).toEqual({ b: { f1: "remove" } });
  });
});
