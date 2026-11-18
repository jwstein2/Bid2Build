import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json } from "@/lib/http/api";
import { resolveTaxProvider } from "@/lib/tax-banking/tax/providers";
import { runTaxSync } from "@/lib/tax-banking/tax/sync";
import { syncAll } from "@/lib/tax-banking/bank/service";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Daily V6.9 job (netlify/functions/tax-banking-cron.mts). Authorization: Bearer $TAX_BANKING_CRON_SECRET.
 * Tax: provider rate check + activation + alerts + quarterly digest + authority homepage check. Banking: daily
 * read-only balance/transaction sync for active connections. Returns counts only. Sends no email.
 */
export async function POST(req: Request) {
  const secret = process.env.TAX_BANKING_CRON_SECRET ?? "";
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got), b = Buffer.from(secret);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) return fail(401, "unauthorized", "Not allowed.");
  const db = createAdminClient();
  const tax = await runTaxSync(db, resolveTaxProvider(process.env, { builtin: { db, cache: db } }), { checkAuthorities: true });
  const bank = await syncAll();
  return json({ tax: { status: tax.status, found: tax.found, applied: tax.applied, review: tax.review, activated: tax.activated, alerts: tax.alerts, digests: tax.digests }, bank });
}
