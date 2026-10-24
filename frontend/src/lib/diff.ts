import { parseDiff, type FileData } from "react-diff-view";

export function parseUnifiedDiff(text: string): FileData[] {
  if (!text.trim()) return [];
  try {
    return parseDiff(text, { nearbySequences: "zip" });
  } catch {
    return [];
  }
}

export function diffFileName(file: FileData): string {
  return file.type === "delete" ? file.oldPath : file.newPath;
}

/** Lines added and removed in one parsed file. */
export function fileStats(file: FileData): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const hunk of file.hunks) {
    for (const change of hunk.changes) {
      if (change.type === "insert") added += 1;
      else if (change.type === "delete") removed += 1;
    }
  }
  return { added, removed };
}

/** Splits a combined `git diff` into one text per file, keyed by the new path (old path for deletions). */
export function splitDiffByFile(diff: string): Record<string, string> {
  const chunks: Record<string, string> = {};
  for (const chunk of diff.split(/^(?=diff --git )/m)) {
    if (!chunk.startsWith("diff --git ")) continue;
    const header = /^diff --git a\/(.+?) b\/(.+)$/m.exec(chunk);
    if (header) chunks[header[2] === "/dev/null" ? header[1] : header[2]] = chunk;
  }
  return chunks;
}
