import type { FindingType, Level } from "@/api/client";

export const TYPE_LABELS: Record<FindingType, string> = {
  unused_function: "Unused function",
  unused_class: "Unused class",
  unused_method: "Unused method",
  unused_variable: "Unused variable",
  unused_import: "Unused import",
  unused_module: "Unused module",
  unused_dependency: "Unused dependency",
  unused_route: "Unused route",
  unreachable_code: "Unreachable code",
};

export const LEVEL_LABELS: Record<Level, string> = { high: "High", medium: "Medium", low: "Low" };

export const typeLabel = (type: string): string => TYPE_LABELS[type as FindingType] ?? type;

/** The short name of a kind ("Function", "Dependency"), for headings where "Unused" is already implied. */
export const kindLabel = (type: string): string => {
  const label = typeLabel(type).replace(/^Unused /, "");
  return label.charAt(0).toUpperCase() + label.slice(1);
};

export function pluralize(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : "";
}

export function repoLabel(repoUrl: string): string {
  return repoUrl.replace(/^https:\/\/github\.com\//, "");
}

/** The repository name split so the last word can be set in the italic accent: "dead-code-hunter" -> ["dead-code-", "hunter"]. */
export function repoTitle(repoUrl: string): [string, string] {
  const name = repoLabel(repoUrl).split("/").pop() ?? repoLabel(repoUrl);
  const cut = Math.max(name.lastIndexOf("-"), name.lastIndexOf("_"), name.lastIndexOf("."));
  return cut > 0 ? [name.slice(0, cut + 1), name.slice(cut + 1)] : ["", name];
}
