import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Action } from "@/api/client";

type PerScan = Record<string, Action>;

interface SelectionState {
  byScan: Record<string, PerScan>;
  /** Scans whose patch the user has confirmed and taken: the last step of the journey. */
  buried: Record<string, boolean>;
  markBuried: (scanId: string) => void;
  set: (scanId: string, findingId: string, action: Action | null) => void;
  setMany: (scanId: string, findingIds: string[], action: Action) => void;
  clear: (scanId: string) => void;
}

export const useSelection = create<SelectionState>()(
  persist(
    (set) => ({
      byScan: {},
      buried: {},
      markBuried: (scanId) => set((state) => ({ buried: { ...state.buried, [scanId]: true } })),
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
