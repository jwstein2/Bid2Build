import { getTrade, trades } from "@/lib/trades/catalog";
import { renderShareCard, SHARE_CARD_SIZE, SHARE_CARD_TYPE } from "@/lib/seo/share-card";

// Share image for a trade page: the headline plus a real screenshot of that trade's estimate builder.
export const size = SHARE_CARD_SIZE;
export const contentType = SHARE_CARD_TYPE;
export const alt = "Built2Bid estimate builder with this trade's estimate sections";
export const dynamicParams = false;
export function generateStaticParams() { return trades.map((t) => ({ trade: t.slug })); }

export default async function Image({ params }: { params: Promise<{ trade: string }> }) {
  const t = getTrade((await params).trade);
  return renderShareCard({ eyebrow: t ? `For ${t.name.toLowerCase()} contractors` : "For contractors", title: t?.seoTitle ?? "Free Estimate Builder", tradeSlug: t?.slug });
}
