"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Feature } from "@/lib/features/registry";
import { FEATURE_ICONS } from "./icons";

export type TourEnd = "completed" | "dismissed" | "left";

type Rect = { top: number; left: number; width: number; height: number };
const PAD = 6;
const CARD_W = 340;

/** The visible element the step points at, if it is on this page. */
function findTarget(id: string | undefined): HTMLElement | null {
  if (!id) return null;
  for (const el of document.querySelectorAll<HTMLElement>(`[data-feature="${CSS.escape(id)}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden") return el;
  }
  return null;
}

/**
 * Short guided walkthrough of real controls. Each step highlights its control when it is on the
 * page (otherwise the card explains where to find it, with an Open Feature link). Next, Back, Skip
 * and Finish; Escape skips. It never blocks the app: closing it at any point is fine.
 */
export function FeatureTour({ steps, onEnd }: { steps: Feature[]; onEnd: (how: TourEnd) => void }) {
  const router = useRouter();
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [tick, setTick] = useState(0);
  const card = useRef<HTMLDivElement>(null);
  const step = steps[i];
  const last = i === steps.length - 1;

  const measure = useCallback(() => {
    const el = findTarget(step?.target);
    if (!el) return setRect(null);
    const r = el.getBoundingClientRect();
    setRect({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
  }, [step]);

  // Bring the control into view, then measure (and again after layout settles, e.g. a view switch).
  useLayoutEffect(() => {
    const el = findTarget(step?.target);
    el?.scrollIntoView({ block: "center", inline: "nearest" });
    const raf = requestAnimationFrame(measure);
    const t = setTimeout(measure, 250);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [step, measure, tick]);

  useEffect(() => {
    const on = () => measure();
    window.addEventListener("resize", on);
    window.addEventListener("scroll", on, true);
    return () => { window.removeEventListener("resize", on); window.removeEventListener("scroll", on, true); };
  }, [measure]);

  useEffect(() => { card.current?.focus(); }, [i]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onEnd("dismissed"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEnd]);

  if (!step) return null;
  const Icon = FEATURE_ICONS[step.id];
  const target = rect ? findTarget(step.target) : null;

  // Card placement: below the control if it fits, else above, else centered. Clamped to the viewport.
  const vw = typeof window === "undefined" ? 1024 : window.innerWidth;
  const vh = typeof window === "undefined" ? 768 : window.innerHeight;
  const w = Math.min(CARD_W, vw - 32);
  let style: React.CSSProperties = { width: w, left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
  if (rect) {
    const left = Math.max(16, Math.min(rect.left, vw - w - 16));
    const below = rect.top + rect.height + 12;
    style = below + 220 < vh ? { width: w, left, top: below } : rect.top - 12 > 240 ? { width: w, left, bottom: vh - rect.top + 12 } : style;
  }

  return (
    <div className="fixed inset-0 z-[60]" data-testid="feature-tour">
      {rect ? (
        <div aria-hidden className="pointer-events-none fixed rounded-lg ring-2 ring-accent transition-all duration-200"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height, boxShadow: "0 0 0 9999px rgba(11,45,77,0.55)" }} data-testid="tour-spotlight" />
      ) : (
        <div aria-hidden className="fixed inset-0 bg-ink/40" />
      )}
      {/* Clicks outside the card are absorbed so the page doesn't change under the tour, except on the highlighted control. */}
      {rect && <div aria-hidden className="fixed inset-0" style={{ clipPath: `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${rect.left}px ${rect.top}px, ${rect.left}px ${rect.top + rect.height}px, ${rect.left + rect.width}px ${rect.top + rect.height}px, ${rect.left + rect.width}px ${rect.top}px, ${rect.left}px ${rect.top}px)` }} />}
      <div ref={card} role="dialog" aria-modal="false" aria-labelledby="ft-title" aria-describedby="ft-body" tabIndex={-1}
        className="fixed max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl bg-surface p-4 shadow-2xl outline-none" style={style}>
        <div className="flex items-start gap-3 pr-7">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent-ink"><Icon className="h-4 w-4" aria-hidden /></span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-muted" data-testid="tour-progress">Step {i + 1} of {steps.length}</p>
            <h2 id="ft-title" className="font-display text-base font-extrabold text-navy">{step.walkthrough.title}</h2>
          </div>
        </div>
        <button type="button" onClick={() => onEnd("dismissed")} className="absolute right-3 top-3 rounded p-1 text-muted hover:bg-black/5" aria-label="Close walkthrough"><X className="h-4 w-4" aria-hidden /></button>
        <p id="ft-body" className="mt-2 text-sm text-ink-soft">{step.walkthrough.body}</p>
        {!rect && step.target && <p className="mt-2 text-xs text-muted">This isn&apos;t on the current screen.</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {target && step.walkthrough.cta && (
            <Button size="sm" variant="secondary" onClick={() => { target.click(); setTick((n) => n + 1); }}>Try it</Button>
          )}
          {!rect && step.walkthrough.cta && (
            <Button size="sm" variant="secondary" onClick={() => { onEnd("left"); router.push(step.route); }}>Open Feature</Button>
          )}
          <span className="ml-auto flex gap-2">
            {!last && <Button size="sm" variant="ghost" onClick={() => onEnd("dismissed")}>Skip</Button>}
            {i > 0 && <Button size="sm" variant="ghost" onClick={() => setI(i - 1)}>Back</Button>}
            <Button size="sm" variant="primary" onClick={() => (last ? onEnd("completed") : setI(i + 1))}>{last ? "Finish" : "Next"}</Button>
          </span>
        </div>
      </div>
    </div>
  );
}
