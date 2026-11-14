"use client";
import Link from "next/link";
import { Gem } from "lucide-react";
import { ANNUAL, MONTHLY } from "@/lib/billing/plans";
import { cn } from "@/lib/cn";
import { CheckoutButton } from "./checkout-button";
import { PREMIUM_FEATURES, type PremiumFeature } from "@/lib/billing/premium-features";

export { PREMIUM_FEATURES, type PremiumFeature };

/**
 * Small diamond that marks an Unlimited feature. `tone="dark"` for the navy sidebar, `"light"` on
 * white cards. Hover shows "Unlimited feature"; screen readers hear the same words.
 */
export function PremiumDiamond({ tone = "light", className }: { tone?: "light" | "dark"; className?: string }) {
  return (
    <span title="Unlimited feature" className={cn("inline-flex shrink-0 items-center", className)}>
      <Gem className={cn("h-3.5 w-3.5", tone === "dark" ? "text-cyan" : "text-accent-ink")} aria-hidden />
      <span className="sr-only">(Unlimited feature)</span>
    </span>
  );
}

/**
 * Upgrade panel for a free account that opens an Unlimited feature: what it does, both Unlimited
 * plans through the existing Stripe checkout, and a way out that keeps free estimating available.
 */
export function PremiumUpgrade({
  feature, signedIn, note, notNowHref, onNotNow, className,
}: { feature: PremiumFeature; signedIn: boolean; note?: string; notNowHref?: string; onNotNow?: () => void; className?: string }) {
  const f = PREMIUM_FEATURES[feature];
  return (
    <div className={cn("rounded-xl border border-line bg-paper p-4 sm:p-5", className)}>
      <p className="flex items-center gap-2 font-display font-bold text-navy"><Gem className="h-4 w-4 text-accent-ink" aria-hidden /> {f.title} is an Unlimited feature</p>
      <p className="mt-1 text-sm text-ink-soft">{f.pitch}</p>
      {note && <p className="mt-2 text-sm text-ink-soft">{note}</p>}
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <CheckoutButton plan="monthly" signedIn={signedIn} label={`Upgrade to Unlimited · ${MONTHLY.price}${MONTHLY.per}`} className="min-w-0 [&_button]:h-auto [&_button]:min-h-11 [&_button]:whitespace-normal [&_button]:py-2" />
        <CheckoutButton plan="annual" signedIn={signedIn} label={`Go Annual · ${ANNUAL.price}${ANNUAL.per}`} variant="secondary" className="min-w-0 [&_button]:h-auto [&_button]:min-h-11 [&_button]:whitespace-normal [&_button]:py-2" />
      </div>
      <p className="mt-3 text-xs text-muted">
        Estimating and proposals stay available on your current plan.{" "}
        {onNotNow ? (
          <button type="button" onClick={onNotNow} className="font-semibold text-accent-ink underline">Not now</button>
        ) : (
          <Link href={notNowHref ?? "/dashboard"} className="font-semibold text-accent-ink underline">Not now</Link>
        )}
      </p>
    </div>
  );
}
