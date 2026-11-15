"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { LATEST_RELEASE, type Feature } from "@/lib/features/registry";
import { whatsNew } from "@/lib/features/state";
import { Button } from "@/components/ui/button";
import { loadFeatures, saveFeatures, startFeatureTour } from "./client";

/** Dismissible, version-aware "New in Built2Bid" notice on the dashboard: only features this account can use. */
export function WhatsNewNotice() {
  const [list, setList] = useState<Feature[] | null>(null);
  useEffect(() => {
    let live = true;
    void loadFeatures().then((v) => { if (live && v?.signedIn && v.known) setList(whatsNew(v.state, v.access)); });
    return () => { live = false; };
  }, []);
  if (!list?.length) return null;
  const dismiss = () => { setList(null); void saveFeatures({ notice: LATEST_RELEASE.version }); };
  return (
    <aside aria-label="What's new" className="relative flex flex-wrap items-center gap-3 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 pr-10" data-testid="whats-new-notice">
      <Sparkles className="h-5 w-5 shrink-0 text-accent-ink" aria-hidden />
      <p className="min-w-[12rem] flex-1 text-sm text-ink">
        <span className="font-semibold text-navy">New in Built2Bid:</span> {list.map((f) => f.name).join(", ")}.
      </p>
      <span className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => { dismiss(); startFeatureTour(list.map((f) => f.id)); }}>Show me</Button>
        <Link href="/whats-new" onClick={dismiss} className="inline-flex min-h-9 items-center px-2 text-sm font-semibold text-accent-ink underline">What&apos;s New</Link>
      </span>
      <button type="button" onClick={dismiss} className="absolute right-2 top-2 rounded p-1.5 text-muted hover:bg-black/5" aria-label="Dismiss what's new"><X className="h-4 w-4" aria-hidden /></button>
    </aside>
  );
}
