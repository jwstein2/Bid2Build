"use client";
import Link from "next/link";
import { createContext, useContext } from "react";
import { Gem } from "lucide-react";
import { ANNUAL, MONTHLY } from "@/lib/billing/plans";
import { cn } from "@/lib/cn";
import { CheckoutButton } from "./checkout-button";
import { PREMIUM_FEATURES, type PremiumFeature } from "@/lib/billing/premium-features";

export { PREMIUM_FEATURES, type PremiumFeature };

/**
 * Whether the signed-in account already has premium (library_access(): Unlimited, Enterprise,
 * complimentary or admin). Provided by the signed-in app layout; null where nobody provided it.
 */
const PremiumAccess = createContext<boolean | null>(null);
export function PremiumAccessProvider({ unlocked, children }: { unlocked: boolean; children: React.ReactNode }) {
  return <PremiumAccess.Provider value={unlocked}>{children}</PremiumAccess.Provider>;
}

/**
 * Small diamond that marks an Unlimited feature. `tone="dark"` for the navy sidebar, `"light"` on
 * white cards. Hover shows "Unlimited feature"; screen readers hear the same words.
 * Never shown to an account that already has premium.
 */
export function PremiumDiamond({ tone = "light", className }: { tone?: "light" | "dark"; className?: string }) {
  if (useContext(PremiumAccess) === true) return null;
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
  feature, signedIn, note, notNowHref, onNotNow, className, title,
}: { feature: PremiumFeature; signedIn: boolean; note?: string; notNowHref?: string; onNotNow?: () => void; className?: string; title?: string }) {
  const f = { ...PREMIUM_FEATURES[feature], ...(title ? { title } : {}) };
  return (
    <div className={cn("rounded-xl border border-line bg-paper p-4 sm:p-5", className)}>
      <p className="flex items-center gap-2 font-display font-bold text-navy"><Gem className="h-4 w-4 text-accent-ink" aria-hidden /> {f.title} {title ? "are" : "is"} an Unlimited feature</p>
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
