import { articles, getArticle } from "@/lib/learn/articles";
import { renderShareCard, SHARE_CARD_SIZE, SHARE_CARD_TYPE } from "@/lib/seo/share-card";

// Share image for a guide: its title, plus the related trade's builder screenshot for trade pricing guides.
export const size = SHARE_CARD_SIZE;
export const contentType = SHARE_CARD_TYPE;
export const alt = "Built2Bid contractor guide";
export const dynamicParams = false;
export function generateStaticParams() { return articles.map((a) => ({ slug: a.slug })); }

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const a = getArticle((await params).slug);
  return renderShareCard({ eyebrow: a?.trade ? "Pricing guide" : "Contractor guide", title: a?.title ?? "Built2Bid Guides", tradeSlug: a?.trade });
}
