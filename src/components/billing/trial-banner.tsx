"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { EXPIRY_FORMAT } from "@/lib/trial/text";

const subscribe = () => () => {};

/**
 * Facebook BID trial banner: the exact end date and time in the viewer's own time zone, plus a
 * separate, optional upgrade link. Shown while the trial is active and for a short while after it ends.
 */
export function TrialBanner({ state, expiresAt }: { state: "active" | "expired"; expiresAt: string }) {
  // Server renders UTC; the browser re-renders in local time (no hydration mismatch warnings).
  const when = useSyncExternalStore(
    subscribe,
    () => new Date(expiresAt).toLocaleString(undefined, EXPIRY_FORMAT),
    () => new Date(expiresAt).toLocaleString("en-US", { ...EXPIRY_FORMAT, timeZone: "UTC" }),
  );
  const ended = state === "expired";
  return (
    <div data-testid="trial-banner" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent-tint px-4 py-3 text-sm">
      <p className="flex items-start gap-2 text-ink">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent-ink" aria-hidden />
        {ended ? (
          <span>Your free week of Built2Bid Unlimited ended on <strong>{when}</strong>. Your bids and customers are all still here, and your normal plan is back in place.</span>
        ) : (
          <span>Your free week of Built2Bid Unlimited is active until <strong>{when}</strong>. No card is on file and nothing will be charged.</span>
        )}
      </p>
      <Link href="/pricing" className="font-semibold text-accent-ink underline">{ended ? "See plans" : "Upgrade (optional)"}</Link>
    </div>
  );
}
