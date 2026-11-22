"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Check, ChevronDown, ChevronUp, Rocket } from "lucide-react";
import { cn } from "@/lib/cn";
import { OPEN_TOUR_EVENT } from "@/lib/onboarding/state";
import { nextStep, type ChecklistStep } from "@/lib/onboarding/checklist";
import { setChecklistHidden } from "@/lib/onboarding/checklist-actions";

/**
 * Home's getting started card: every step to a first signed job, the next one highlighted with its one
 * button. Collapsible; Hide removes it for good (Help › Getting started checklist brings it back).
 */
export function GettingStarted({ steps, className }: { steps: ChecklistStep[]; className?: string }) {
  const [open, setOpen] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [pending, start] = useTransition();
  const done = steps.filter((s) => s.done).length;
  const next = nextStep(steps);
  if (hidden) return null;
  return (
    <section id="getting-started" aria-labelledby="gs-title" data-testid="getting-started" className={cn("rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5", className)}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-tint text-accent-ink"><Rocket className="h-5 w-5" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <h2 id="gs-title" className="font-display text-lg font-extrabold text-navy">Getting started</h2>
          <p className="text-sm text-ink-soft" data-testid="getting-started-progress">{done} of {steps.length} done{next ? ` · Next: ${next.title}` : ""}</p>
        </div>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="gs-list" className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm font-semibold text-ink-soft hover:bg-black/5">
          {open ? <><ChevronUp className="h-4 w-4" aria-hidden /> Collapse</> : <><ChevronDown className="h-4 w-4" aria-hidden /> Show steps</>}
        </button>
        <button type="button" disabled={pending} onClick={() => start(async () => { setHidden(true); await setChecklistHidden(true); })} className="min-h-11 rounded-md px-2 text-sm text-muted hover:bg-black/5 hover:text-ink" data-testid="getting-started-hide" title="You can bring it back from Help &amp; guides">
          Hide
        </button>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-idle-tint" aria-hidden>
        <div className="h-full rounded-full bg-ok transition-all" style={{ width: `${Math.round((done / steps.length) * 100)}%` }} />
      </div>
      {open && (
        <ol id="gs-list" className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {steps.map((s) => {
            const isNext = next?.id === s.id;
            return (
              <li key={s.id} data-testid={`gs-step-${s.id}`} data-done={s.done ? "true" : "false"} className={cn("flex gap-3 rounded-xl border p-3", isNext ? "border-accent bg-accent-tint/40" : "border-line", s.done && "opacity-75")}>
                <span className={cn("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs font-bold", s.done ? "border-ok bg-ok text-white" : "border-line-strong text-muted")} aria-hidden>
                  {s.done ? <Check className="h-3.5 w-3.5" /> : steps.indexOf(s) + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn("font-semibold", s.done && "line-through decoration-1")}>{s.title}<span className="sr-only">{s.done ? " (done)" : " (to do)"}</span></p>
                  {!s.done && <p className="mt-0.5 text-sm text-ink-soft">{s.why}</p>}
                  {!s.done && (s.opensTour ? (
                    <button type="button" onClick={() => window.dispatchEvent(new Event(OPEN_TOUR_EVENT))} aria-haspopup="dialog" className={cn("mt-2 inline-flex min-h-10 items-center rounded-md px-3 text-sm font-semibold", isNext ? "bg-accent text-navy hover:bg-accent-hover" : "border border-line-strong hover:bg-black/5")}>{s.action}</button>
                  ) : (
                    <Link href={s.href} className={cn("mt-2 inline-flex min-h-10 items-center rounded-md px-3 text-sm font-semibold", isNext ? "bg-accent text-navy hover:bg-accent-hover" : "border border-line-strong hover:bg-black/5")}>{s.action}</Link>
                  ))}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {open && <p className="mt-3 text-xs text-muted">Want to look around first? Turn on <Link href="/settings/account#practice" className="font-semibold text-ink underline underline-offset-2">Practice Mode</Link> to explore a sample company. Nothing is sent or charged.</p>}
    </section>
  );
}
