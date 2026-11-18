import { permanentRedirect } from "next/navigation";

/**
 * V7.3: the "Pricing data" page is retired (it only listed pricing sources that were never connected).
 * Old bookmarks go to Saved Items & Pricing. The provider catalog in src/lib/pricing/provider.ts, price
 * imports, supplier pricing and every pricing table are kept for future use.
 */
export default function RetiredPricingData() {
  permanentRedirect("/dashboard/items");
}
