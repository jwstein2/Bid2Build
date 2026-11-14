"use client";
import { CirclePlay } from "lucide-react";
import { cn } from "@/lib/cn";
import { OPEN_TOUR_EVENT } from "@/lib/onboarding/state";

/** Replays the welcome video and tour. Never changes onboarding status, bids, or billing. */
export function ReplayTourButton({ className }: { className?: string }) {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event(OPEN_TOUR_EVENT))} className={cn(className)} data-testid="replay-tour">
      <CirclePlay className="h-4 w-4" aria-hidden /> Watch Getting Started Tour
    </button>
  );
}
