"use client";
import { useEffect } from "react";
import { Compass } from "lucide-react";
import { LATEST_RELEASE } from "@/lib/features/registry";
import { cn } from "@/lib/cn";
import { saveFeatures, startFeatureTour } from "./client";

/**
 * Sidebar "Feature walkthrough": teaches the page and view on screen, right where the person is.
 * With `ids` it walks through those features instead (What's New).
 */
export function FeatureTourButton({ className, label = "Feature walkthrough", ids, guide }: { className?: string; label?: string; ids?: string[]; guide?: string }) {
  return (
    <button type="button" onClick={() => startFeatureTour(ids)} className={cn(className)} data-testid="feature-tour-button" data-guide={guide}>
      <Compass className="h-4 w-4 shrink-0" aria-hidden /> {label}
    </button>
  );
}

/** "Show me how this page works": the same page walkthrough, placed next to a page's help controls. */
export function PageGuideButton({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <button type="button" onClick={() => startFeatureTour()} aria-label="Show me how this page works" title="Show me how this page works" data-testid="page-guide-button" data-guide="page.guide-button"
      className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-sm font-semibold text-accent-ink hover:bg-black/5", className)}>
      <Compass className="h-4 w-4 shrink-0" aria-hidden /><span className={cn(compact && "sr-only")}>Show me how this page works</span>
    </button>
  );
}

/** Visiting What's New counts as seeing the latest notice. */
export function MarkNoticeSeen() {
  useEffect(() => { void saveFeatures({ notice: LATEST_RELEASE.version }); }, []);
  return null;
}
