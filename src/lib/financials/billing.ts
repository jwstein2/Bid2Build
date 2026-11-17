/**
 * Solo Financials add-on (owner decision 2026-11-17): $21.99/month on top of the Standard plan, one user
 * plus the free read-only accountant seat. Added as an item on the person's existing Standard
 * subscription, like the Project Command Center add-on.
 *
 * The Stripe price is found by its lookup key and created once by the server if it doesn't exist yet,
 * so no price ID has to be copied into the environment. Items are recognised by the same lookup key.
 * Stripe bills every item on one interval, so annual plans get the yearly price ($219.99, approved
 * 2026-11-17: 12 months for the price of 10).
 */
import type Stripe from "stripe";

export const FIN_SOLO_CENTS = 2199;
export const FIN_SOLO_ANNUAL_CENTS = 21999;
export const FIN_SOLO_LOOKUP = "b2b_fin_solo_monthly";
export const FIN_SOLO_ANNUAL_LOOKUP = "b2b_fin_solo_annual";
export type FinInterval = "month" | "year";
export const finSoloCents = (iv: FinInterval) => (iv === "year" ? FIN_SOLO_ANNUAL_CENTS : FIN_SOLO_CENTS);
export const FIN_LOOKUP_PREFIX = "b2b_fin_";
export const FIN_SOLO_PRODUCT = "Built2Bid Financials (Solo)";

export type FinItem = { id: string; price: { id: string; lookup_key?: string | null; recurring?: { interval?: string } | null } };

export const isFinItem = (i: { price?: { lookup_key?: string | null } | null }) => Boolean(i.price?.lookup_key?.startsWith(FIN_LOOKUP_PREFIX));

/** What the subscription says about the solo Financials add-on. */
export const finFromItems = (items: FinItem[]) => ({ addon: items.some(isFinItem) });

/** The live/test price for the solo add-on on this interval, created on first use. Verifies amount and interval. */
export async function ensureFinSoloPrice(stripe: Stripe, interval: FinInterval = "month"): Promise<string> {
  const key = interval === "year" ? FIN_SOLO_ANNUAL_LOOKUP : FIN_SOLO_LOOKUP;
  const cents = finSoloCents(interval);
  const find = async () => (await stripe.prices.list({ lookup_keys: [key], active: true, limit: 1 })).data[0];
  let price = await find();
  if (!price) {
    // Both intervals share one product: reuse it when the other price already exists.
    const sibling = (await stripe.prices.list({ lookup_keys: [interval === "year" ? FIN_SOLO_LOOKUP : FIN_SOLO_ANNUAL_LOOKUP], active: true, limit: 1 })).data[0];
    const product = typeof sibling?.product === "string" ? sibling.product : sibling?.product?.id;
    try {
      price = await stripe.prices.create({
        currency: "usd", unit_amount: cents, recurring: { interval }, lookup_key: key,
        ...(product ? { product } : { product_data: { name: FIN_SOLO_PRODUCT, metadata: { b2b_kind: "fin_addon_solo" } } }),
        metadata: { b2b_kind: "fin_addon_solo" },
      }, { idempotencyKey: `create-${key}-${cents}` });
    } catch {
      price = await find();   // another request created it first
    }
  }
  if (!price || price.unit_amount !== cents || price.recurring?.interval !== interval || price.currency !== "usd") {
    throw new Error("fin_price_mismatch");
  }
  return price.id;
}
