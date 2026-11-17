"use client";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Compass, Lock, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { REVEAL_FEATURE_EVENT } from "@/lib/features/state";

export type TourEnd = "completed" | "dismissed";

/** One walkthrough card. Page guides and feature announcements both become these. */
export interface TourStep {
  key: string;
  title: string;
  body: string;
  hint?: string;
  /** Ids of the control, alternatives in order; matched against `attr`. */
  targets: string[];
  attr: "data-guide" | "data-feature";
  /** Temporary local UI to open first (see REVEAL_FEATURE_EVENT). */
  reveal?: string;
  icon?: LucideIcon;
  locked?: boolean;
  /**
   * Page guides only show steps whose control is on screen (missing ones are skipped and reported).
   * Feature announcements may explain a feature that lives elsewhere: then the card offers a link the
   * person can choose to follow, and nothing moves on its own.
   */
  optional?: { href: string; label: string };
}

type Rect = { top: number; left: number; width: number; height: number };
const PAD = 6;
const CARD_W = 340;
const GAP = 12;

const matches = (attr: string, id: string) => `[${attr}~="${CSS.escape(id)}"]`;

function visible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0;
}

/** The visible element a step points at, if it's on this screen. Elements under the walkthrough itself don't count. */
export function findTarget(step: Pick<TourStep, "targets" | "attr">): HTMLElement | null {
  for (const id of step.targets) {
    for (const el of document.querySelectorAll<HTMLElement>(matches(step.attr, id))) {
      if (!el.closest("[data-testid='feature-tour']") && visible(el)) return el;
    }
  }
  return null;
}

/** Records a step whose control wasn't found, so stale targets are caught in development and tests. */
function reportMissing(step: TourStep, page: string | null) {
  const entry = { page, step: step.key, targets: step.targets };
  const w = window as unknown as { __b2bGuideMissing?: unknown[] };
  (w.__b2bGuideMissing ??= []).push(entry);
  if (process.env.NODE_ENV !== "production") console.warn("[walkthrough] skipped a step whose control isn't on screen", entry);
}

function scrollParents(el: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (/(auto|scroll)/.test(cs.overflow + cs.overflowX + cs.overflowY) && (p.scrollHeight > p.clientHeight || p.scrollWidth > p.clientWidth)) out.push(p);
  }
  return out;
}

/**
 * Guided walkthrough of real controls on the current page. It spotlights each control, explains it,
 * and offers Back, Next, Skip and Close (Escape closes; arrow keys move). It never navigates, clicks,
 * saves or sends anything: the overlay absorbs clicks so advancing can't press a button under it.
 * Scroll positions it changes to bring a control into view are put back when it closes, and focus
 * returns to where it was.
 */
export function FeatureTour({ steps: initial, label, page, onEnd }: { steps: TourStep[]; label?: string; page?: string | null; onEnd: (how: TourEnd) => void }) {
  const [steps, setSteps] = useState(initial);
  const [i, setI] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [rect, setRect] = useState<Rect | null>(null);
  // Whether the current step's control was found (keyed by step, so a new step starts unknown).
  const [seen, setSeen] = useState<{ key: string; ok: boolean } | null>(null);
  const [vp, setVp] = useState({ w: 1024, h: 768 });
  const card = useRef<HTMLDivElement>(null);
  const step = steps[i];
  const stepsRef = useRef(steps);
  useEffect(() => { stepsRef.current = steps; }, [steps]);
  const last = i === steps.length - 1;
  const found = step && seen?.key === step.key ? seen.ok : null;

  // Remember where the page was so closing puts it back exactly.
  const [memo] = useState(() => ({
    x: typeof window === "undefined" ? 0 : window.scrollX,
    y: typeof window === "undefined" ? 0 : window.scrollY,
    els: new Map<HTMLElement, [number, number]>(),
    focus: typeof document === "undefined" ? null : document.activeElement,
  }));
  useEffect(() => () => {
    window.dispatchEvent(new CustomEvent(REVEAL_FEATURE_EVENT, { detail: null }));
    const m = memo;
    m.els.forEach(([l, t], el) => { el.scrollLeft = l; el.scrollTop = t; });
    window.scrollTo({ left: m.x, top: m.y, behavior: "instant" as ScrollBehavior });
    if (m.focus instanceof HTMLElement && m.focus.isConnected) m.focus.focus({ preventScroll: true });
  }, [memo]);

  const measure = useCallback(() => {
    setVp({ w: window.innerWidth, h: window.innerHeight });
    const el = step ? findTarget(step) : null;
    if (!el) return setRect(null);
    const r = el.getBoundingClientRect();
    setRect({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
  }, [step]);

  // Open any temporary UI the step needs, bring the control into view, measure. A page-guide step whose
  // control never appears is dropped and the walkthrough continues in the same direction.
  useLayoutEffect(() => {
    if (!step) return;
    if (step.reveal) window.dispatchEvent(new CustomEvent(REVEAL_FEATURE_EVENT, { detail: step.reveal }));
    let done = false;
    const settle = (final: boolean) => {
      if (done) return;
      const el = findTarget(step);
      if (el) {
        done = true;
        for (const p of scrollParents(el)) if (!memo.els.has(p)) memo.els.set(p, [p.scrollLeft, p.scrollTop]);
        const r = el.getBoundingClientRect();
        const vh = window.innerHeight;
        // Phones dock the card to an edge, so a tall control is lined up with the other edge to keep most of it visible.
        if (window.innerWidth < 640 && r.height > vh / 2 - 40) window.scrollBy({ top: r.top - 16, behavior: "instant" as ScrollBehavior });
        else if (r.top < 64 || r.bottom > vh - 64 || r.left < 0 || r.right > window.innerWidth) el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" as ScrollBehavior });
        setSeen({ key: step.key, ok: true });
        measure();
        return;
      }
      if (!final) return;
      done = true;
      if (step.optional) { setSeen({ key: step.key, ok: false }); measure(); return; }
      reportMissing(step, page ?? null);
      const next = stepsRef.current.filter((s) => s.key !== step.key);
      setSteps(next);
      setI((n) => Math.max(0, Math.min(dir === 1 ? n : n - 1, next.length - 1)));
    };
    const raf = requestAnimationFrame(() => settle(false));
    // A revealed control may take a frame or two to render; ordinary targets are found at once.
    const timers = step.reveal ? [80, 200, 450].map((ms, k, a) => setTimeout(() => settle(k === a.length - 1), ms)) : [setTimeout(() => settle(true), 30)];
    return () => { done = true; cancelAnimationFrame(raf); timers.forEach(clearTimeout); };
  }, [step, measure, dir, page, memo]);

  useEffect(() => {
    const on = () => measure();
    window.addEventListener("resize", on);
    window.addEventListener("scroll", on, true);
    return () => { window.removeEventListener("resize", on); window.removeEventListener("scroll", on, true); };
  }, [measure]);

  const go = useCallback((d: 1 | -1) => {
    setDir(d);
    if (d === 1 && last) onEnd("completed");
    else setI((n) => Math.max(0, Math.min(n + d, steps.length - 1)));
  }, [last, onEnd, steps.length]);

  useEffect(() => { card.current?.focus({ preventScroll: true }); }, [i, found]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onEnd("dismissed"); return; }
      if (!card.current?.contains(document.activeElement)) return;
      if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
      if (e.key === "ArrowLeft" && i > 0) { e.preventDefault(); go(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEnd, go, i]);

  // Nothing on this screen to point at: say so plainly instead of showing a broken step.
  if (!steps.length) {
    return (
      <div className="fixed inset-0 z-[60]" data-testid="feature-tour">
        <div aria-hidden className="fixed inset-0 bg-ink/30" onClick={() => onEnd("dismissed")} />
        <div ref={card} role="dialog" aria-modal="false" aria-labelledby="ft-title" tabIndex={-1} data-testid="tour-empty"
          className="fixed left-1/2 top-1/2 w-[min(340px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-surface p-4 shadow-2xl outline-none">
          <h2 id="ft-title" className="font-display text-base font-extrabold text-navy">{label ?? "This page"}</h2>
          <p className="mt-2 text-sm text-ink-soft">There&apos;s nothing to walk through on this screen right now. Open another page and choose Feature walkthrough there.</p>
          <div className="mt-3 flex justify-end"><Button size="sm" variant="primary" onClick={() => onEnd("dismissed")}>Close</Button></div>
        </div>
      </div>
    );
  }
  if (!step || found === null) return <div className="fixed inset-0 z-[60]" data-testid="feature-tour" aria-busy="true" />;

  const Icon = step.locked ? Lock : step.icon ?? Compass;
  const { w: vw, h: vh } = vp;
  const phone = vw < 640;
  const w = Math.min(CARD_W, vw - 32);

  // Card placement: never over the control. Phones dock the card to the top or bottom edge (inside the
  // safe area) on the side away from the control; wider screens put it below, above, right or left.
  let style: React.CSSProperties = { width: w, left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
  let place = "center";
  if (rect) {
    const below = rect.top + rect.height + GAP, aboveRoom = rect.top - GAP;
    if (phone) {
      // Dock on the side with more free space, away from the control.
      const targetLow = rect.top > vh - (rect.top + rect.height);
      style = targetLow
        ? { left: 16, right: 16, top: "calc(env(safe-area-inset-top, 0px) + 12px)" }
        : { left: 16, right: 16, bottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" };
      place = targetLow ? "top" : "bottom";
    } else {
      const left = Math.max(16, Math.min(rect.left, vw - w - 16));
      const cardH = 230;
      if (below + cardH < vh) { style = { width: w, left, top: below }; place = "below"; }
      else if (aboveRoom > cardH) { style = { width: w, left, bottom: vh - rect.top + GAP }; place = "above"; }
      else if (rect.left + rect.width + GAP + w < vw - 16) { style = { width: w, left: rect.left + rect.width + GAP, top: Math.max(16, Math.min(rect.top, vh - cardH - 16)) }; place = "right"; }
      else if (rect.left - GAP - w > 16) { style = { width: w, left: rect.left - GAP - w, top: Math.max(16, Math.min(rect.top, vh - cardH - 16)) }; place = "left"; }
      else { style = { width: w, left, bottom: 16 }; place = "bottom"; }
    }
  }

  return (
    <div className="fixed inset-0 z-[60]" data-testid="feature-tour" data-step={step.key}>
      {rect ? (
        // The scrim is a box-shadow around the control, so the highlight edge is an outline. --tour-scrim is
        // darker in the Dark and Black themes (globals.css).
        <div aria-hidden className="pointer-events-none fixed rounded-lg outline-2 outline-accent motion-safe:transition-all motion-safe:duration-200"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height, boxShadow: "0 0 0 9999px var(--tour-scrim, rgba(11,45,77,0.55))" }} data-testid="tour-spotlight" />
      ) : (
        <div aria-hidden className="fixed inset-0 bg-ink/40" />
      )}
      {/* Absorbs every click (the highlighted control included) so moving through the walkthrough can't press anything on the page. */}
      <div aria-hidden className="fixed inset-0" data-testid="tour-shield" />
      <div ref={card} role="dialog" aria-modal="false" aria-labelledby="ft-title" aria-describedby="ft-body" tabIndex={-1} data-place={place}
        className="fixed max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border border-line bg-surface p-4 shadow-2xl outline-none" style={style} data-testid="tour-card">
        <div className="flex items-start gap-3 pr-7">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent-ink"><Icon className="h-4 w-4" aria-hidden /></span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-muted" data-testid="tour-progress">{label ? `${label} · ` : ""}Step {i + 1} of {steps.length}</p>
            <h2 id="ft-title" className="font-display text-base font-extrabold text-navy">{step.title}</h2>
          </div>
        </div>
        <button type="button" onClick={() => onEnd("dismissed")} className="absolute right-1 top-1 sm:right-2 sm:top-2 grid h-11 w-11 place-items-center sm:h-9 sm:w-9 rounded-md text-muted hover:bg-black/5" aria-label="Close walkthrough" data-testid="tour-close"><X className="h-4 w-4" aria-hidden /></button>
        <p id="ft-body" className="mt-2 text-sm text-ink-soft">{step.body}</p>
        {step.hint && <p className="mt-2 rounded-md bg-paper px-2 py-1.5 text-xs text-ink-soft" data-testid="tour-hint"><b>Tip:</b> {step.hint}</p>}
        {!rect && step.optional && <p className="mt-2 text-xs text-muted">It&apos;s on another page. <Link href={step.optional.href} className="font-semibold text-accent-ink underline" onClick={() => onEnd("dismissed")}>{step.optional.label}</Link> when you&apos;re ready.</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="ml-auto flex gap-2">
            {!last && <Button size="sm" variant="ghost" onClick={() => onEnd("dismissed")} className="min-h-11 sm:min-h-10">Skip</Button>}
            {i > 0 && <Button size="sm" variant="ghost" onClick={() => go(-1)} className="min-h-11 sm:min-h-10">Back</Button>}
            <Button size="sm" variant="primary" onClick={() => go(1)} className="min-h-11 sm:min-h-10">{last ? "Finish" : "Next"}</Button>
          </span>
        </div>
      </div>
    </div>
  );
}
