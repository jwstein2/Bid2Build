import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, sameOrigin } from "@/lib/http/api";
import { CONSENT_POLICY_VERSION } from "@/lib/market/server";

const body = z.object({ sharePrices: z.boolean(), shareCosts: z.boolean(), commercialUse: z.boolean() });

/**
 * Market-data sharing consent. Everything defaults to off. Costs and commercial use require price
 * sharing. Turning price sharing off deletes the user's contributed observations (database trigger);
 * turning cost sharing off strips costs and margins from them.
 */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Invalid request.");
  const sharePrices = p.data.sharePrices;
  const row = {
    user_id: user.id,
    share_prices: sharePrices,
    share_costs: sharePrices && p.data.shareCosts,
    commercial_use: sharePrices && p.data.commercialUse,
    policy_version: CONSENT_POLICY_VERSION,
    updated_at: new Date().toISOString(),
  };
  const { error } = await (await createClient()).from("market_consent").upsert(row, { onConflict: "user_id" });
  if (error) {
    logError("market.consent", error, { user: user.id });
    return fail(500, "save_failed", "Could not save your sharing preference.");
  }
  return json({ ok: true, consent: { sharePrices: row.share_prices, shareCosts: row.share_costs, commercialUse: row.commercial_use } });
}
