import type Stripe from "stripe";
import { ADV_PLANS, DEFAULT_STAGES, PRODUCT_IDS, PRODUCT_NAMES, priceLookupKey, stagePrice, type AdvPlan, type Stage } from "./plans";

/**
 * Idempotent Stripe provisioning for Academy Advanced: 3 products with fixed custom ids and 15 monthly prices
 * (3 plans × 5 founding stages) found by lookup key, then mapped into academy_adv_prices.
 *
 * Re-running is safe: existing products and prices are reused, nothing is ever deleted, and an existing price whose
 * amount no longer matches is reported, never edited (Stripe prices are immutable). Live mode is refused unless the
 * caller passes allowLive, which the admin action and CLI only do with ACADEMY_ADVANCED_PROVISION_LIVE=true.
 */
type StripeLike = Pick<Stripe, "products" | "prices">;
type DbLike = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

export type ProvisionRow = { plan: AdvPlan; stage: number; lookup_key: string; amount_cents: number; price_id: string | null; product_id: string; status: "created" | "existing" | "mismatch" | "planned" };
export type ProvisionResult = { mode: "test" | "live"; dryRun: boolean; products: { id: string; status: "created" | "existing" | "planned" }[]; prices: ProvisionRow[]; mapped: number; problems: string[] };

const METADATA = { product_line: "academy_advanced" } as const;

export async function provisionAcademyPrices(opts: {
  stripe: StripeLike; db: DbLike | null; secretKey: string; stages?: Stage[]; dryRun?: boolean; allowLive?: boolean; actor?: string | null; taxCode?: string | null;
}): Promise<ProvisionResult> {
  const mode: "test" | "live" = /^(sk|rk)_live_/.test(opts.secretKey) ? "live" : "test";
  if (mode === "live" && !opts.allowLive) throw new Error("live_provision_refused");
  const stages = opts.stages?.length ? opts.stages : DEFAULT_STAGES;
  const dryRun = Boolean(opts.dryRun);
  const result: ProvisionResult = { mode, dryRun, products: [], prices: [], mapped: 0, problems: [] };

  for (const plan of ADV_PLANS) {
    const productId = PRODUCT_IDS[plan];
    let exists = false;
    try { await opts.stripe.products.retrieve(productId); exists = true; }
    catch (e) { if ((e as { code?: string; statusCode?: number }).statusCode !== 404 && (e as { code?: string }).code !== "resource_missing") throw e; }
    if (!exists && !dryRun) {
      await opts.stripe.products.create(
        { id: productId, name: PRODUCT_NAMES[plan], metadata: { ...METADATA, plan }, ...(opts.taxCode ? { tax_code: opts.taxCode } : {}) },
        { idempotencyKey: `academy-product-${productId}` },
      );
    }
    result.products.push({ id: productId, status: exists ? "existing" : dryRun ? "planned" : "created" });

    for (const s of stages) {
      const key = priceLookupKey(plan, s.stage, "month");
      const amount = stagePrice(s, plan);
      const found = exists ? (await opts.stripe.prices.list({ lookup_keys: [key], active: true, limit: 1 })).data[0] : undefined;
      let row: ProvisionRow;
      if (found) {
        const ok = found.unit_amount === amount && found.currency === "usd" && found.recurring?.interval === "month" && found.recurring?.interval_count === 1;
        row = { plan, stage: s.stage, lookup_key: key, amount_cents: amount, price_id: found.id, product_id: productId, status: ok ? "existing" : "mismatch" };
        if (!ok) result.problems.push(`${key}: Stripe price ${found.id} is ${found.unit_amount} ${found.currency}/${found.recurring?.interval}, expected ${amount} usd/month. Not mapped.`);
      } else if (dryRun) {
        row = { plan, stage: s.stage, lookup_key: key, amount_cents: amount, price_id: null, product_id: productId, status: "planned" };
      } else {
        const created = await opts.stripe.prices.create(
          { product: productId, currency: "usd", unit_amount: amount, recurring: { interval: "month", interval_count: 1 }, lookup_key: key, nickname: `Stage ${s.stage} founding price`, tax_behavior: "exclusive", metadata: { ...METADATA, plan, stage: String(s.stage), interval: "month" } },
          { idempotencyKey: `academy-price-${key}-${amount}` },
        );
        row = { plan, stage: s.stage, lookup_key: key, amount_cents: amount, price_id: created.id, product_id: productId, status: "created" };
      }
      result.prices.push(row);
    }
  }

  if (!dryRun && opts.db) {
    const { data: current } = await opts.db.from("academy_adv_prices").select("plan, stage, billing_interval, stripe_price_id").eq("mode", mode).eq("active", true);
    const have = new Map<string, string>(((current ?? []) as { plan: string; stage: number; billing_interval: string; stripe_price_id: string }[]).map((r) => [`${r.plan}:${r.stage}:${r.billing_interval}`, r.stripe_price_id]));
    for (const r of result.prices) {
      if (!r.price_id || r.status === "mismatch") continue;
      const k = `${r.plan}:${r.stage}:month`;
      const existing = have.get(k);
      if (existing === r.price_id) continue;
      if (existing) { result.problems.push(`${k} is already mapped to ${existing}; left as is. Deactivate it in Manage → Advanced to switch to ${r.price_id}.`); continue; }
      const { error } = await opts.db.from("academy_adv_prices").insert({
        mode, plan: r.plan, stage: r.stage, billing_interval: "month", amount_cents: r.amount_cents, currency: "usd",
        stripe_product_id: r.product_id, stripe_price_id: r.price_id, active: true, created_by: opts.actor ?? null,
      });
      if (error) result.problems.push(`${k}: could not save mapping (${error.message}).`);
      else result.mapped++;
    }
  }
  return result;
}
