import { Check } from "lucide-react";

export const GENERATOR_STEPS = ["Describe", "Generate", "Review", "Costs", "Duplicates & units", "Approve", "Use in bids"] as const;

/** The seven steps of "Generate My Price Library". Scrolls sideways on a phone instead of wrapping. */
export function StepBar({ current }: { current: number }) {
  return (
    <ol className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 text-xs sm:mx-0 sm:px-0" aria-label="Steps">
      {GENERATOR_STEPS.map((s, k) => {
        const n = k + 1;
        const state = n < current ? "done" : n === current ? "now" : "next";
        return (
          <li key={s} aria-current={state === "now" ? "step" : undefined}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 ${state === "now" ? "border-brand bg-brand text-white" : state === "done" ? "border-ok/40 bg-ok-tint text-ok" : "border-line text-muted"}`}>
            {state === "done" ? <Check className="h-3.5 w-3.5" aria-hidden /> : <span className="font-bold">{n}</span>}
            <span className="font-semibold">{s}</span>
          </li>
        );
      })}
    </ol>
  );
}
