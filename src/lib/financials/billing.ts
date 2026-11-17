/**
 * Solo Financials add-on (owner decision 2026-11-17): $21.99/month on top of the Standard plan, one user
 * plus the free read-only accountant seat. Added as an item on the person's existing Standard
 * subscription, like the Project Command Center add-on.
 *
 * The Stripe price is found by its lookup key and created once by the server if it doesn't exist yet,
 * so no price ID has to be copied into the environment. Items are recognised by the same lookup key.
 * Annual plans: Stripe bills every item on one interval, so the add-on is monthly-plan only until a
 * yearly price is approved.
 */
import type Stripe from "stripe";

export const FIN_SOLO_CENTS = 2199;
export const FIN_SOLO_LOOKUP = "b2b_fin_solo_monthly";
export const FIN_LOOKUP_PREFIX = "b2b_fin_";
export const FIN_SOLO_PRODUCT = "Built2Bid Financials (Solo)";

export type FinItem = { id: string; price: { id: string; lookup_key?: string | null; recurring?: { interval?: string } | null } };

export const isFinItem = (i: { price?: { lookup_key?: string | null } | null }) => Boolean(i.price?.lookup_key?.startsWith(FIN_LOOKUP_PREFIX));

/** What the subscription says about the solo Financials add-on. */
export const finFromItems = (items: FinItem[]) => ({ addon: items.some(isFinItem) });

/** The live/test price for the solo add-on, created on first use. Verifies amount and interval. */
export async function ensureFinSoloPrice(stripe: Stripe): Promise<string> {
  const find = async () => (await stripe.prices.list({ lookup_keys: [FIN_SOLO_LOOKUP], active: true, limit: 1 })).data[0];
  let price = await find();
  if (!price) {
    try {
      price = await stripe.prices.create({
        currency: "usd", unit_amount: FIN_SOLO_CENTS, recurring: { interval: "month" }, lookup_key: FIN_SOLO_LOOKUP,
        product_data: { name: FIN_SOLO_PRODUCT, metadata: { b2b_kind: "fin_addon_solo" } },
        metadata: { b2b_kind: "fin_addon_solo" },
      }, { idempotencyKey: `create-${FIN_SOLO_LOOKUP}-${FIN_SOLO_CENTS}` });
    } catch {
      price = await find();   // another request created it first
    }
  }
  if (!price || price.unit_amount !== FIN_SOLO_CENTS || price.recurring?.interval !== "month" || price.currency !== "usd") {
    throw new Error("fin_price_mismatch");
  }
  return price.id;
}
