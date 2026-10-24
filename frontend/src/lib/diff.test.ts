import { describe, expect, it } from "vitest";
import { fileStats, parseUnifiedDiff, splitDiffByFile } from "./diff";

const DIFF = `diff --git a/a.py b/a.py
--- a/a.py
+++ b/a.py
@@ -1,3 +1,2 @@
 keep
-gone
 tail
diff --git a/b.py b/b.py
deleted file mode 100644
--- a/b.py
+++ /dev/null
@@ -1,2 +0,0 @@
-x
-y
`;

describe("diff helpers", () => {
  it("splits a combined diff per file", () => {
    expect(Object.keys(splitDiffByFile(DIFF))).toEqual(["a.py", "b.py"]);
    expect(splitDiffByFile(DIFF)["a.py"]).not.toContain("b.py");
  });

  it("counts removed lines per file", () => {
    const [a, b] = parseUnifiedDiff(DIFF);
    expect(fileStats(a)).toEqual({ added: 0, removed: 1 });
    expect(fileStats(b)).toEqual({ added: 0, removed: 2 });
  });
});
