import Link from "next/link";
import { familyTint, TradeIcon } from "@/components/trade-icon";
import { getTrade } from "@/lib/trades/catalog";

/** The trades most new contractors bid first (spec priority order). Every slug exists in the catalog. */
export const FIRST_BID_TRADES = ["decks", "general-contracting", "painting", "roofing", "concrete", "kitchens", "bathrooms", "flooring", "electrical", "siding", "drywall"] as const;

/**
 * Shown on the dashboard to an account with no bids yet: one question ("What type of work are you
 * bidding?") and a trade opens a ready-to-fill estimate. Company details can be added in the bid or
 * later; nothing is asked up front.
 */
export function FirstBidStart({ companyName }: { companyName: string | null }) {
  const list = FIRST_BID_TRADES.map((s) => getTrade(s)).filter((t): t is NonNullable<ReturnType<typeof getTrade>> => Boolean(t));
  return (
    <section aria-labelledby="first-bid-title" className="rounded-2xl border border-brand/25 bg-brand-tint p-5 sm:p-6" data-testid="first-bid-start">
      <h2 id="first-bid-title" className="text-xl font-extrabold text-navy sm:text-2xl">Welcome to Built2Bid{companyName ? `, ${companyName}` : ""}. Let&apos;s get your first estimate started.</h2>
      <p className="mt-1 text-ink-soft">What type of work are you bidding? Your estimate opens with the usual sections for that trade, ready for your quantities and costs.</p>
      <ul className="mt-4 flex flex-wrap gap-2">
        {list.map((t) => (
          <li key={t.slug}>
            <Link href={`/start/${t.slug}`} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:border-brand/50">
              <span className={`grid h-7 w-7 place-items-center rounded-full ${familyTint[t.family]}`}><TradeIcon name={t.icon} className="h-4 w-4" /></span>
              {t.name}
            </Link>
          </li>
        ))}
        <li><Link href="/bids" className="inline-flex min-h-11 items-center rounded-full px-3 py-1.5 text-sm font-semibold text-accent-ink underline">All trades</Link></li>
      </ul>
      <p className="mt-3 text-sm text-muted">Then: add your customer and project, price the estimate, preview the proposal, and download or send it.</p>
    </section>
  );
}
