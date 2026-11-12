/**
 * Creates (or reuses) the BuildYourBid Unlimited product and its two prices in Stripe TEST mode.
 * Idempotent via lookup keys. Refuses live keys.
 *   STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/stripe-setup.ts
 */
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY ?? "";
if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
  console.error("Refusing to run: set STRIPE_SECRET_KEY to a TEST key (sk_test_...). Live setup requires owner approval.");
  process.exit(1);
}
const stripe = new Stripe(key);

const PRICES = [
  { lookup_key: "byb_unlimited_monthly", unit_amount: 1999, interval: "month" as const, nickname: "Unlimited Monthly" },
  { lookup_key: "byb_unlimited_annual", unit_amount: 14900, interval: "year" as const, nickname: "Unlimited Annual" },
];

async function main() {
  const existing = await stripe.prices.list({ lookup_keys: PRICES.map((p) => p.lookup_key), active: true, expand: ["data.product"] });
  let productId = existing.data.map((p) => (typeof p.product === "string" ? p.product : p.product.id))[0];
  if (!productId) {
    const product = await stripe.products.create({ name: "BuildYourBid Unlimited", description: "Unlimited finalized proposal exports.", metadata: { app: "buildyourbid" } });
    productId = product.id;
  }
  const out: Record<string, string> = {};
  for (const p of PRICES) {
    const found = existing.data.find((e) => e.lookup_key === p.lookup_key);
    const price = found ?? (await stripe.prices.create({ product: productId, currency: "usd", unit_amount: p.unit_amount, recurring: { interval: p.interval }, lookup_key: p.lookup_key, nickname: p.nickname }));
    out[p.interval] = price.id;
  }
  console.log(`STRIPE_PRICE_MONTHLY=${out.month}\nSTRIPE_PRICE_ANNUAL=${out.year}`);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
