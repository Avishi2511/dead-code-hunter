import { useQuery } from "@tanstack/react-query";
import { api, type FindingFilters } from "./client";

const POLL_MS = 1000;

export function useScan(id: string) {
  return useQuery({
    queryKey: ["scan", id],
    queryFn: () => api.scan(id),
    refetchInterval: (query) =>
      query.state.data?.status === "pending" || query.state.data?.status === "running" ? POLL_MS : false,
  });
}

export function useFindings(id: string, filters: FindingFilters = {}, enabled = true) {
  return useQuery({ queryKey: ["findings", id, filters], queryFn: () => api.findings(id, filters), enabled });
}

export function useFinding(id: string, findingId: string) {
  return useQuery({ queryKey: ["finding", id, findingId], queryFn: () => api.finding(id, findingId) });
}

export function useNeighborhood(id: string, focus: string[], hops = 2) {
  return useQuery({
    queryKey: ["neighborhood", id, focus, hops],
    queryFn: () => api.neighborhood(id, focus, hops),
    enabled: focus.length > 0,
  });
}

export function useModuleGraph(id: string) {
  return useQuery({ queryKey: ["modules", id], queryFn: () => api.moduleGraph(id) });
}

export function useCleanup(cleanupId: string | null) {
  return useQuery({
    queryKey: ["cleanup", cleanupId],
    queryFn: () => api.cleanup(cleanupId as string),
    enabled: cleanupId !== null,
    refetchInterval: (query) =>
      query.state.data?.status === "pending" || query.state.data?.status === "running" ? POLL_MS : false,
  });
}
