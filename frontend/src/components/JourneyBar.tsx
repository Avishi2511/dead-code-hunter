import clsx from "clsx";
import { Check } from "lucide-react";
import { useScanSelection, useSelection } from "@/state/selection";

/** Where the user is in the dig: surveyed, marked for burial, laid to rest. Driven by real state. */
export function JourneyBar({ scanId }: { scanId: string }) {
  const marked = Object.keys(useScanSelection(scanId)).length;
  const buried = useSelection((s) => s.buried[scanId] ?? false);
  const steps = [
    { label: "Surveyed", done: true, note: "grounds mapped" },
    { label: "Marked for burial", done: marked > 0 || buried, note: marked > 0 ? `${marked} marked` : "nothing marked yet" },
    { label: "Laid to rest", done: buried, note: buried ? "patch taken" : "patch not taken" },
  ];
  const current = steps.findIndex((s) => !s.done);

  return (
    <ol className="mb-5 flex items-center gap-2 overflow-x-auto text-xs" aria-label="Progress">
      {steps.map((step, index) => (
        <li key={step.label} className="flex items-center gap-2">
          {index > 0 && <span className={clsx("h-px w-8 sm:w-14", step.done || index === current ? "bg-accent" : "bg-border")} />}
          <span
            className={clsx(
              "flex h-5 w-5 items-center justify-center rounded-full border text-[10px]",
              step.done ? "border-accent bg-accent text-text" : index === current ? "border-accent-hover text-text" : "border-border text-muted",
            )}
          >
            {step.done ? <Check size={11} /> : index + 1}
          </span>
          <span className={step.done || index === current ? "text-text" : "text-muted"}>
            {step.label} <span className="hidden text-muted sm:inline">· {step.note}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
