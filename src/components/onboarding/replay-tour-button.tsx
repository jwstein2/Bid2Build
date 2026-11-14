"use client";
import { CirclePlay } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { OPEN_TOUR_EVENT } from "@/lib/onboarding/state";

/**
 * Opens the same welcome video and tour the automatic popup shows (OnboardingHost owns it; this only
 * asks it to open). Never changes onboarding status, bids, or billing.
 */
export function ReplayTourButton({ className, children, testId = "replay-tour" }: { className?: string; children?: ReactNode; testId?: string }) {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event(OPEN_TOUR_EVENT))} className={cn(className)} data-testid={testId} aria-haspopup="dialog">
      <CirclePlay className="h-4 w-4 shrink-0" aria-hidden /> {children ?? "Watch Getting Started Tour"}
    </button>
  );
}
