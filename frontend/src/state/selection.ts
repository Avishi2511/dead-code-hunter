import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Action } from "@/api/client";

type PerScan = Record<string, Action>;

interface SelectionState {
  byScan: Record<string, PerScan>;
  set: (scanId: string, findingId: string, action: Action | null) => void;
  setMany: (scanId: string, findingIds: string[], action: Action) => void;
  clear: (scanId: string) => void;
}

export const useSelection = create<SelectionState>()(
  persist(
    (set) => ({
      byScan: {},
      set: (scanId, findingId, action) =>
        set((state) => {
          const current = { ...(state.byScan[scanId] ?? {}) };
          if (action === null) delete current[findingId];
          else current[findingId] = action;
          return { byScan: { ...state.byScan, [scanId]: current } };
        }),
      setMany: (scanId, findingIds, action) =>
        set((state) => {
          const current = { ...(state.byScan[scanId] ?? {}) };
          for (const id of findingIds) current[id] = action;
          return { byScan: { ...state.byScan, [scanId]: current } };
        }),
      clear: (scanId) =>
        set((state) => {
          const { [scanId]: _removed, ...rest } = state.byScan;
          return { byScan: rest };
        }),
    }),
    { name: "dch-selections" },
  ),
);

const EMPTY: PerScan = {};

export const useScanSelection = (scanId: string): PerScan => useSelection((s) => s.byScan[scanId] ?? EMPTY);
