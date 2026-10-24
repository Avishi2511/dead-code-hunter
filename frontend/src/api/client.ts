import type { components } from "./schema";

export type Schemas = components["schemas"];
export type ScanView = Schemas["ScanView"];
export type FindingSummary = Schemas["FindingSummary"];
export type FindingDetail = Schemas["FindingDetail"];
export type GraphView = Schemas["GraphView"];
export type GraphNode = Schemas["GraphNode"];
export type CleanupView = Schemas["CleanupView"];
export type FindingType = FindingDetail["type"];
export type Level = FindingDetail["level"];
export type Action = Schemas["SelectionIn"]["action"];

export const API_BASE: string = import.meta.env.VITE_API_BASE_URL ?? "/api";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body);
    } catch {
      /* keep the status text */
    }
    throw new ApiError(response.status, detail);
  }
  return response.json() as Promise<T>;
}

export interface FindingFilters {
  type?: string;
  level?: string;
  q?: string;
  path?: string;
}

function query(params: Record<string, string | number | string[] | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    for (const item of Array.isArray(value) ? value : [value]) search.append(key, String(item));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export const api = {
  createScan: (body: { repoUrl: string; ref?: string; subdir?: string }) =>
    request<Schemas["ScanCreated"]>("/scans", { method: "POST", body: JSON.stringify(body) }),
  runScan: (id: string) => request<ScanView>(`/scans/${id}/run`, { method: "POST" }),
  scan: (id: string) => request<ScanView>(`/scans/${id}`),
  findings: (id: string, filters: FindingFilters = {}) =>
    request<Schemas["FindingList"]>(`/scans/${id}/findings${query({ ...filters, limit: 2000 })}`),
  finding: (id: string, findingId: string) =>
    request<FindingDetail>(`/scans/${id}/findings/${encodeURIComponent(findingId)}`),
  neighborhood: (id: string, focus: string[], hops = 2) =>
    request<GraphView>(`/scans/${id}/graph${query({ focus, hops })}`),
  moduleGraph: (id: string) => request<GraphView>(`/scans/${id}/graph?view=modules`),
  file: (id: string, path: string) => request<Schemas["FileView"]>(`/scans/${id}/files${query({ path })}`),
  createCleanup: (id: string, selections: { findingId: string; action: Action }[]) =>
    request<Schemas["CleanupCreated"]>(`/scans/${id}/cleanups`, {
      method: "POST",
      body: JSON.stringify({ selections }),
    }),
  runCleanup: (cleanupId: string) => request<CleanupView>(`/cleanups/${cleanupId}/run`, { method: "POST" }),
  cleanup: (cleanupId: string) => request<CleanupView>(`/cleanups/${cleanupId}`),
};

export const patchUrl = (cleanupId: string) => `${API_BASE}/cleanups/${cleanupId}/patch`;
export const reportUrl = (cleanupId: string) => `${API_BASE}/cleanups/${cleanupId}/report`;
