import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json } from "@/lib/http/api";
import { runOfficialImports } from "@/lib/tax-banking/tax/importer";
import { taxProviderMode } from "@/lib/tax-banking/isolation";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Hourly official tax-rate import (netlify/functions/tax-rates-cron.mts). Authorization: Bearer $TAX_BANKING_CRON_SECRET.
 * Reads each state's official rate (and boundary) files, oldest import first, inside a short time budget. Free: no
 * paid provider, no credentials. Returns per-state counts only. Off when TAX_PROVIDER=none.
 */
export async function POST(req: Request) {
  const secret = process.env.TAX_BANKING_CRON_SECRET ?? "";
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got), b = Buffer.from(secret);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) return fail(401, "unauthorized", "Not allowed.");
  if (taxProviderMode(process.env) !== "builtin") return json({ skipped: "built-in tax engine is off" });
  const out = await runOfficialImports(createAdminClient(), { budgetMs: 18_000 });
  return json({ error: out.error, states: out.results.map((r) => ({ state: r.state, status: r.status, rates: r.rates, changes: r.changes, zips: r.zips, alerts: r.alerts })) });
}
