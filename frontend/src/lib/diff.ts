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
