"use client";
import Link from "next/link";
import { useState } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ChecklistStep } from "@/lib/growth/activation";

/**
 * Small, dismissible "first bid" progress card on the dashboard. Every step is computed on the
 * server from what the account actually did; nothing here is required to use Built2Bid.
 */
export function ActivationChecklist({ steps }: { steps: ChecklistStep[] }) {
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState(false);
  if (hidden) return null;
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  const dismiss = async () => {
    setHidden(true);
    const r = await fetch("/api/account/checklist", { method: "POST" }).catch(() => null);
    if (!r?.ok) { setHidden(false); setError(true); }
  };
  return (
    <section aria-labelledby="checklist-title" className="rounded-xl border border-line bg-surface p-4 sm:p-5" data-testid="activation-checklist">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="checklist-title" className="font-bold text-navy">Get your first bid out the door</h2>
          <p className="text-sm text-ink-soft">{done} of {steps.length} done. Pick up wherever you like.</p>
          <div className="mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-black/5" aria-hidden>
            <div className="h-full rounded-full bg-ok" style={{ width: `${(done / steps.length) * 100}%` }} />
          </div>
        </div>
        <button type="button" onClick={() => void dismiss()} className="-m-2 grid h-11 w-11 shrink-0 place-items-center rounded-md text-muted hover:bg-black/5" aria-label="Hide the first bid checklist"><X className="h-4 w-4" /></button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-danger">Couldn&apos;t hide the checklist. Please try again.</p>}
      <ol className="mt-4 grid gap-2 md:grid-cols-5">
        {steps.map((s, i) => (
          <li key={s.key} className={cn("rounded-lg border p-3 text-sm", s.done ? "border-ok/30 bg-ok-tint" : s === next ? "border-brand/40 bg-brand-tint" : "border-line")} data-done={s.done}>
            <p className="flex items-center gap-2 font-semibold text-ink">
              <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px]", s.done ? "bg-ok text-white" : "bg-black/5 text-ink-soft")} aria-hidden>{s.done ? <Check className="h-3 w-3" strokeWidth={3} /> : i + 1}</span>
              <span>{s.label}<span className="sr-only">{s.done ? " (done)" : " (to do)"}</span></span>
            </p>
            {!s.done && <p className="mt-1 text-ink-soft">{s.hint}</p>}
            {!s.done && s === next && <Link href={s.href} className="mt-2 inline-flex min-h-9 items-center font-semibold text-accent-ink underline">{s.cta}</Link>}
          </li>
        ))}
      </ol>
    </section>
  );
}
