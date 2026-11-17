"use client";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { useState } from "react";
import { TradeIcon } from "../trade-icon";

export interface QuickStartTrade { slug: string; name: string; icon: string; project: string; groups: string[]; lines: number }

/** V6-25 preview: pick a trade in the hero and see what the starter bid will contain before signing up. */
export function HeroQuickStart({ trades, totalTrades }: { trades: QuickStartTrade[]; totalTrades: number }) {
  const [slug, setSlug] = useState(trades[0]?.slug);
  const t = trades.find((x) => x.slug === slug) ?? trades[0];
  if (!t) return null;
  return (
    <div data-testid="hero-quick-start" className="mx-auto w-full max-w-xl rounded-2xl border border-white/15 bg-white/[0.06] p-5 shadow-2xl backdrop-blur sm:p-6 lg:max-w-none">
      <p className="text-xs font-bold uppercase tracking-wider text-cyan">Quick start</p>
      <h2 className="mt-1 text-xl font-bold text-white sm:text-2xl">What are you bidding?</h2>
      <div role="radiogroup" aria-label="Trade" className="mt-4 flex flex-wrap gap-2">
        {trades.map((x) => {
          const on = x.slug === t.slug;
          return (
            <button key={x.slug} type="button" role="radio" aria-checked={on} onClick={() => setSlug(x.slug)}
              className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3.5 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan ${on ? "border-cyan bg-cyan text-navy" : "border-white/20 bg-white/5 text-[#D5DFE9] hover:border-white/40 hover:text-white"}`}>
              <TradeIcon name={x.icon} className="h-4 w-4" />{x.name}
            </button>
          );
        })}
        <a href="#trades" className="inline-flex min-h-11 items-center rounded-full px-2 text-sm font-semibold text-cyan underline-offset-4 hover:underline">All {totalTrades} trades</a>
      </div>
      <div className="mt-5 rounded-xl bg-white p-4 text-ink sm:p-5" aria-live="polite">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Your {t.name.toLowerCase()} bid starts with</p>
        <p className="mt-1 font-display text-lg font-bold leading-snug">{t.project}</p>
        <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {t.groups.map((g) => (
            <li key={g} className="flex items-start gap-2 text-sm text-ink-soft"><Check className="mt-0.5 h-4 w-4 shrink-0 text-teal" aria-hidden />{g}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">{t.lines} common line items ready to price. Change anything, add your own.</p>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3">
        <Link href={`/start/${t.slug}`} data-testid="quick-start-cta"
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-cyan px-5 font-bold sm:w-auto text-navy hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan">
          Start a {t.name.toLowerCase()} bid <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
        <a href="#sample-proposal" className="inline-flex min-h-11 items-center justify-center text-sm font-semibold text-[#D5DFE9] underline-offset-4 hover:text-white hover:underline">See a finished sample proposal</a>
      </div>
      <p className="mt-3 text-xs text-[#B8C6D4]">No account needed to build and preview.</p>
    </div>
  );
}
