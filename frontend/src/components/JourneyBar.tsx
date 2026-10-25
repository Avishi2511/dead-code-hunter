import clsx from "clsx";
import { Check } from "lucide-react";
import { useScanSelection, useSelection } from "@/state/selection";

/** Where the user is in the dig: scanned, reviewed, buried. Driven by real state. */
export function JourneyBar({ scanId }: { scanId: string }) {
  const marked = Object.keys(useScanSelection(scanId)).length;
  const buried = useSelection((s) => s.buried[scanId] ?? false);
  const steps = [
    { label: "Scanned", done: true },
    { label: "Reviewed", done: marked > 0 || buried },
    { label: "Buried", done: buried },
  ];
  const current = steps.findIndex((s) => !s.done);

  return (
    <ol className="flex flex-wrap gap-y-3" aria-label="Progress">
      {steps.map((step, index) => {
        const isCurrent = index === current;
        const last = index === steps.length - 1;
        return (
          <li
            key={step.label}
            className={clsx("flex items-center gap-3", last ? "flex-[0_1_160px]" : "flex-[1_1_200px]")}
            aria-current={isCurrent ? "step" : undefined}
          >
            <span
              className={clsx(
                "flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border-[1.5px]",
                step.done && "border-accent-hover bg-accent",
                isCurrent && "border-rose",
                !step.done && !isCurrent && "border-strong",
              )}
            >
              {step.done ? (
                <Check size={13} strokeWidth={3} />
              ) : isCurrent ? (
                <span className="h-2 w-2 rounded-full bg-rose" />
              ) : null}
            </span>
            <span className={clsx("font-mono text-xs uppercase tracking-[0.16em]", !step.done && !isCurrent && "text-muted")}>
              {step.label}
            </span>
            {!last && <span aria-hidden="true" className={clsx("mr-3.5 h-px flex-1", step.done ? "bg-accent" : "bg-[#2f292a]")} />}
          </li>
        );
      })}
    </ol>
  );
}
