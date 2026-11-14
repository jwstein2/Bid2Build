"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, ArrowRight, Check, Play, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "../ui/button";
import { TOUR_STEPS, WELCOME_VIDEO, type TourStep } from "./steps";

export type TourExit = "dismissed" | "completed";

/**
 * "Welcome to Built2Bid" popup and the seven-step getting started tour, in one dialog.
 * Purely instructional: nothing here reads or writes bids. The caller decides what an exit means
 * (the automatic popup records it; a manual replay doesn't).
 */
export function OnboardingTour({ open, onExit, onCreateBid }: {
  open: boolean;
  /** X, Esc, Not Right Now, Skip Tour → "dismissed". Create My First Bid → "completed". */
  onExit: (how: TourExit) => void;
  /** Called after onExit("completed") to open the real trade chooser. */
  onCreateBid: () => void;
}) {
  const [index, setIndex] = useState(0);
  const step = TOUR_STEPS[index];
  const total = TOUR_STEPS.length;
  const last = index === total - 1;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const moved = useRef(false);

  // On each step change: pause the video if it's hidden, scroll the body to the top, and move focus
  // to the new heading so keyboard and screen-reader users land on the new content.
  useEffect(() => {
    if (index !== 0) videoRef.current?.pause();
    bodyRef.current?.scrollTo({ top: 0 });
    if (moved.current) titleRef.current?.focus({ preventScroll: true });
    // Warm the next step's still so it's on screen the moment Next is pressed.
    const next = TOUR_STEPS[index + 1]?.media;
    if (next?.kind === "image") { const img = new Image(); img.src = next.src; }
  }, [index]);

  const go = (i: number) => { moved.current = true; setIndex(Math.max(0, Math.min(total - 1, i))); };
  const dismiss = () => { videoRef.current?.pause(); onExit("dismissed"); };
  const finish = () => { videoRef.current?.pause(); onExit("completed"); onCreateBid(); };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) dismiss(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-ink/50 backdrop-blur-[2px]" />
        <Dialog.Content
          data-testid="onboarding-dialog"
          aria-describedby="onboarding-body"
          // Clicking or tapping outside never closes it (a stray tap or leaving video fullscreen shouldn't).
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => { if (document.fullscreenElement) e.preventDefault(); }}
          onOpenAutoFocus={(e) => { e.preventDefault(); titleRef.current?.focus({ preventScroll: true }); }}
          className={cn(
            "fixed left-1/2 top-1/2 z-[60] flex w-[calc(100%-1rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl outline-none sm:w-[calc(100%-2rem)]",
            "max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)]",
          )}
        >
          {/* Header: progress + close */}
          <div className="flex items-center gap-3 border-b border-line px-4 py-3 sm:px-6">
            <p className="font-display text-xs font-bold uppercase tracking-[0.14em] text-accent-ink">Getting started</p>
            <Progress index={index} total={total} />
            <Dialog.Close
              className="-mr-1 grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted hover:bg-black/5 hover:text-ink"
              aria-label="Close welcome tour"
              data-testid="onboarding-close"
            >
              <X className="h-5 w-5" aria-hidden />
            </Dialog.Close>
          </div>

          {/* Body scrolls on short screens; header and footer stay put. */}
          <div ref={bodyRef} id="onboarding-body" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
            {/* The video stays mounted (hidden) on later steps so going Back keeps its position. */}
            <div className={index === 0 ? "" : "hidden"}>
              <WelcomeVideo videoRef={videoRef} />
            </div>
            {step.media.kind === "image" && (
              <figure className="mx-auto w-full max-w-[calc(42dvh*16/9)] overflow-hidden rounded-xl border border-line bg-paper shadow-card">
                {/* eslint-disable-next-line @next/next/no-img-element -- small static stills; no optimizer round-trip needed */}
                <img
                  key={step.id}
                  src={step.media.src}
                  alt={step.media.alt}
                  width={960}
                  height={478}
                  decoding="async"
                  className="block h-auto max-h-[42dvh] w-full object-cover object-top"
                />
              </figure>
            )}
            <StepText step={step} titleRef={titleRef} />
          </div>

          {/* Footer: step count + navigation. Two rows on phones, one row from sm up. */}
          <div className="border-t border-line bg-paper px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <p className="text-sm font-semibold text-muted" aria-live="polite" data-testid="onboarding-step">
                Step {index + 1} of {total}
              </p>
              {index > 0 && !last && (
                <button type="button" onClick={dismiss} className="min-h-11 rounded-lg px-2 text-sm font-semibold text-ink-soft underline-offset-4 hover:text-ink hover:underline sm:order-last sm:hidden">
                  Skip Tour
                </button>
              )}
              <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center">
                {index === 0 ? (
                  <>
                    <Button key="not-now" variant="secondary" onClick={dismiss} data-testid="onboarding-not-now">Not Right Now</Button>
                    <Button key="take-tour" variant="accent" onClick={() => go(1)} data-testid="onboarding-take-tour">Take Tour <ArrowRight className="h-4 w-4" aria-hidden /></Button>
                  </>
                ) : (
                  <>
                    {!last && (
                      <button key="skip" type="button" onClick={dismiss} className="hidden min-h-11 rounded-lg px-3 text-sm font-semibold text-ink-soft underline-offset-4 hover:text-ink hover:underline sm:inline-flex sm:items-center" data-testid="onboarding-skip">
                        Skip Tour
                      </button>
                    )}
                    <Button key="back" variant="secondary" onClick={() => go(index - 1)} data-testid="onboarding-back"><ArrowLeft className="h-4 w-4" aria-hidden /> Back</Button>
                    {last ? (
                      <Button key="create" variant="accent" onClick={finish} data-testid="onboarding-create">Create My First Bid</Button>
                    ) : (
                      <Button key="next" variant="accent" onClick={() => go(index + 1)} data-testid="onboarding-next">Next <ArrowRight className="h-4 w-4" aria-hidden /></Button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Progress({ index, total }: { index: number; total: number }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2" role="progressbar" aria-label="Tour progress" aria-valuemin={1} aria-valuemax={total} aria-valuenow={index + 1} aria-valuetext={`Step ${index + 1} of ${total}: ${TOUR_STEPS[index].label}`}>
      <div className="flex min-w-0 flex-1 gap-1" aria-hidden>
        {TOUR_STEPS.map((s, i) => (
          <span key={s.id} className={cn("h-1.5 flex-1 rounded-full transition-colors", i <= index ? "bg-teal" : "bg-line")} />
        ))}
      </div>
      <span className="shrink-0 text-xs font-bold tabular-nums text-ink-soft" aria-hidden>{index + 1}/{total}</span>
    </div>
  );
}

function WelcomeVideo({ videoRef }: { videoRef: React.RefObject<HTMLVideoElement | null> }) {
  const [started, setStarted] = useState(false);
  return (
    // Width is capped by the viewport height so a 16:9 player never pushes the controls off a
    // landscape phone; it keeps the video's own aspect ratio.
    <div className="relative mx-auto w-full max-w-[calc(42dvh*16/9)] overflow-hidden rounded-xl bg-navy shadow-card">
      <video
        ref={videoRef}
        data-testid="onboarding-video"
        className="block aspect-video h-auto w-full bg-navy"
        controls
        playsInline
        preload="none"
        poster={WELCOME_VIDEO.poster}
        width={WELCOME_VIDEO.width}
        height={WELCOME_VIDEO.height}
        onPlay={() => setStarted(true)}
        aria-label="Meet Built2Bid introduction video (captions are shown in the video)"
      >
        <source src={WELCOME_VIDEO.src} type="video/mp4" />
        Your browser can&apos;t play this video. <a href={WELCOME_VIDEO.src}>Download the Meet Built2Bid video</a>.
      </video>
      {!started && (
        <button
          type="button"
          onClick={() => { setStarted(true); void videoRef.current?.play().catch(() => setStarted(false)); }}
          className="group absolute inset-0 grid place-items-center bg-navy/25 transition hover:bg-navy/10"
          data-testid="onboarding-play"
        >
          <span className="flex items-center gap-2.5 rounded-full bg-accent py-2.5 pl-3 pr-4 font-display font-bold text-navy shadow-lg ring-4 ring-white/30 transition group-hover:scale-105">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-navy text-accent"><Play className="ml-0.5 h-4 w-4" fill="currentColor" aria-hidden /></span>
            Play video <span className="font-semibold text-navy/70">{WELCOME_VIDEO.duration}</span>
          </span>
        </button>
      )}
    </div>
  );
}

function StepText({ step, titleRef }: { step: TourStep; titleRef: React.RefObject<HTMLHeadingElement | null> }) {
  return (
    <div className="mt-4 sm:mt-5">
      <Dialog.Title ref={titleRef} tabIndex={-1} style={{ outline: "none" }} className="font-display text-2xl font-extrabold leading-tight text-navy sm:text-[1.75rem]" data-testid="onboarding-title">
        {step.title}
      </Dialog.Title>
      {step.subtitle && <p className="mt-1 font-display text-base font-bold text-accent-ink sm:text-lg">{step.subtitle}</p>}
      <p className="mt-2 text-ink-soft">{step.body}</p>
      {step.bullets && (
        <ul className="mt-3 space-y-1.5 text-[0.9375rem] text-ink-soft">
          {step.bullets.map((b) => (
            <li key={b} className="flex gap-2"><Check className="mt-1 h-4 w-4 shrink-0 text-teal" strokeWidth={3} aria-hidden />{b}</li>
          ))}
        </ul>
      )}
      {step.note && <p className="mt-3 rounded-lg bg-accent-tint px-3 py-2 text-sm font-medium text-ink">{step.note}</p>}
    </div>
  );
}
