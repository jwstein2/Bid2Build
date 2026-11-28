import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { TradePicker } from "@/components/marketing/trade-picker";
import { pickerTrades } from "@/lib/trades/picker";

export const metadata: Metadata = { title: "Create New Bid", robots: { index: false } };

/**
 * "Create New Bid" inside the app: the same trade picker as the public /bids page, but in the app frame
 * (sidebar, search) so starting a bid doesn't feel like leaving the app. Picking a trade goes to
 * /start/[trade], which opens the builder (also inside the sidebar when signed in).
 */
export default function NewBidPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6" data-guide-page="bids.new">
      <Breadcrumbs items={[{ label: "Create New Bid" }]} />
      <div>
        <h1 className="text-3xl font-extrabold">What are you bidding today?</h1>
        <p className="mt-2 max-w-2xl text-ink-soft">Choose a trade to start with suggested sections and items, or start a custom project. Every trade uses the same pricing engine and proposal builder.</p>
      </div>
      <TradePicker trades={pickerTrades()} guides={false} />
    </div>
  );
}
