import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui/misc";
import { TradePicker } from "@/components/marketing/trade-picker";
import { familyTint, TradeIcon } from "@/components/trade-icon";
import { trades } from "@/lib/trades/catalog";
import { pickerTrades } from "@/lib/trades/picker";

export const metadata: Metadata = {
  title: "Estimate Builders for Every Trade",
  description: "Free estimate and proposal builders for roofing, decks, concrete, kitchens, electrical, plumbing, HVAC and 30 more construction trades.",
  alternates: { canonical: "/bids" },
};

export default function BidsIndex() {
  const families = Array.from(new Set(trades.map((t) => t.family)));
  return (
    <Container className="py-14">
      <h1 className="text-4xl font-extrabold">What are you bidding today?</h1>
      <p className="mt-3 max-w-2xl text-lg text-ink-soft">Choose a trade to start with suggested sections and items, or start a custom project. Every trade uses the same pricing engine and proposal builder.</p>
      <div className="mt-10"><TradePicker trades={pickerTrades()} /></div>
      <div className="mt-16 grid gap-10 md:grid-cols-2 lg:grid-cols-3">
        {families.map((f) => (
          <section key={f}>
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted">{f}</h2>
            <ul className="mt-3 space-y-2">
              {trades.filter((t) => t.family === f).map((t) => (
                <li key={t.slug}>
                  <Link href={`/bids/${t.slug}`} className="flex items-start gap-3 rounded-lg border border-line bg-surface p-3 hover:border-brand/40">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${familyTint[t.family]}`}><TradeIcon name={t.icon} className="h-5 w-5" /></span>
                    <span>
                      <span className="block font-semibold">{t.seoTitle}</span>
                      <span className="block text-sm text-muted">{t.headline}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Container>
  );
}
