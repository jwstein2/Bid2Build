/**
 * Creates (or finds) the Academy Advanced Stripe products and the 15 monthly founding-stage prices, then maps them
 * into academy_adv_prices. Idempotent: safe to run again. Dry run unless --apply is passed.
 *
 *   STRIPE_SECRET_KEY=sk_test_... NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx tsx scripts/academy/advanced/provision.mts [--apply] [--no-db]
 *
 * Refuses a live key unless ACADEMY_ADVANCED_PROVISION_LIVE=true (owner approval required for live prices).
 * The same thing is available without handling keys at all: Academy → Manage → Advanced → "Create test-mode
 * products and prices" on a preview deploy.
 */
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { provisionAcademyPrices } from "../../../src/lib/academy/advanced/provision";

const key = process.env.STRIPE_SECRET_KEY ?? "";
if (!key) { console.error("Set STRIPE_SECRET_KEY (a test key, sk_test_...)."); process.exit(1); }
const apply = process.argv.includes("--apply");
const useDb = !process.argv.includes("--no-db") && Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const db = useDb ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }) : null;

const r = await provisionAcademyPrices({
  stripe: new Stripe(key, { appInfo: { name: "Built2Bid academy provisioning" } }), db, secretKey: key, dryRun: !apply,
  allowLive: process.env.ACADEMY_ADVANCED_PROVISION_LIVE === "true",
}).catch((e: Error) => { console.error(e.message === "live_provision_refused" ? "Live key refused. Live prices need owner approval and ACADEMY_ADVANCED_PROVISION_LIVE=true." : e.message); process.exit(1); });

console.log(`${r.mode} mode${r.dryRun ? " (dry run, nothing created)" : ""}${db ? "" : " (no database: mapping skipped)"}`);
console.table(r.products);
console.table(r.prices.map((p) => ({ plan: p.plan, stage: p.stage, amount: (p.amount_cents / 100).toFixed(2), price: p.price_id ?? "-", status: p.status })));
if (!r.dryRun) console.log(`mapped ${r.mapped} new prices`);
for (const p of r.problems) console.warn("!", p);
