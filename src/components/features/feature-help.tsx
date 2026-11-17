"use client";
import { useId, useRef, useState } from "react";
import { CircleHelp } from "lucide-react";
import { getFeature, type FeatureId } from "@/lib/features/registry";
import { cn } from "@/lib/cn";
import { useDismiss } from "@/components/ui/use-dismiss";

/** Small "?" next to a feature: its registry description, opened by tap, click or keyboard. */
export function FeatureHelp({ id, className }: { id: FeatureId; className?: string }) {
  const f = getFeature(id);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const pop = useId();
  const btn = useRef<HTMLButtonElement>(null);
  useDismiss(open, () => setOpen(false), { inside: [box], returnFocus: btn });
  if (!f) return null;
  return (
    <span ref={box} className={cn("relative inline-flex", className)}>
      <button ref={btn} type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={pop} aria-label={`About ${f.name}`}
        className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-black/5 hover:text-ink" data-testid={`help-${id}`}>
        <CircleHelp className="h-4 w-4" aria-hidden />
      </button>
      {open && (
        <span id={pop} role="note" className="absolute right-0 top-9 z-40 w-64 rounded-lg border border-line bg-surface p-3 text-left text-sm text-ink-soft shadow-xl">
          <span className="block font-semibold text-navy">{f.name}</span>
          {f.description}
        </span>
      )}
    </span>
  );
}
