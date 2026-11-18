import { fail, json } from "@/lib/http/api";
import { dbFail, guardRead } from "@/lib/team/route-helpers";
import { mapCrossCheck } from "@/lib/pricing/providers";

export const runtime = "nodejs";

/**
 * Price cross-check across the supplier price lists the caller imported (and, in a company, imports
 * linked to company suppliers). ?q= searches product names and SKUs; without it, returns products two or
 * more suppliers price. Only real imported prices; no live supplier source is connected yet.
 */
export async function GET(req: Request) {
  const g = await guardRead();
  if (!g.ok) return g.res;
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length > 100) return fail(400, "invalid", "Shorten the search to 100 characters.");
  const { data, error } = await g.supabase.rpc("supplier_price_cross_check", { p_query: q || null });
  if (error) return dbFail("supplier-pricing.cross-check", error);
  return json(mapCrossCheck(data));
}
