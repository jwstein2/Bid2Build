"use client";
import { useEffect } from "react";
import { Compass } from "lucide-react";
import { LATEST_RELEASE } from "@/lib/features/registry";
import { cn } from "@/lib/cn";
import { saveFeatures, startFeatureTour } from "./client";

/** Starts the feature walkthrough (every feature this account can use, newest first). */
export function FeatureTourButton({ className, label = "Feature walkthrough" }: { className?: string; label?: string }) {
  return (
    <button type="button" onClick={() => startFeatureTour()} className={cn(className)} data-testid="feature-tour-button">
      <Compass className="h-4 w-4 shrink-0" aria-hidden /> {label}
    </button>
  );
}

/** Visiting What's New counts as seeing the latest notice. */
export function MarkNoticeSeen() {
  useEffect(() => { void saveFeatures({ notice: LATEST_RELEASE.version }); }, []);
  return null;
}
