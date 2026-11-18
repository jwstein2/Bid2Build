import { z } from "zod";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { createClient, getUser } from "@/lib/supabase/server";
import { estimateTax, saveEstimateCalc } from "@/lib/tax-banking/tax/estimate-tax";
import { REVIEW_TEXT } from "@/lib/tax-banking/tax/types";

export const runtime = "nodejs";

const body = z.object({ estimateId: z.string().uuid(), work: z.enum(["new_construction", "repair"]).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), save: z.boolean().optional() });

/**
 * "View Tax Details" for a bid. Read-only unless save=true (stores an unlocked draft calculation the owner of the bid
 * can see later). Never changes the bid's own tax rate or a signed proposal. RLS decides whether the caller can read the bid.
 */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("tax-calc", 60, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid", "Check the details and try again.");
  const db = await createClient();
  try {
    const out = await estimateTax(db, parsed.data.estimateId, { work: parsed.data.work, date: parsed.data.date });
    if (!out) return fail(404, "not_found", "We couldn't find that bid.");
    let savedId: string | null = null;
    if (parsed.data.save) savedId = await saveEstimateCalc(db, parsed.data.estimateId, out.result).catch(() => null);
    return json({ ...out, savedId, reasonText: Object.fromEntries(out.result.reviewReasons.map((r) => [r, REVIEW_TEXT[r]])) });
  } catch (e) {
    logError("tax.calculate", e);
    return fail(500, "server_error", "Tax details aren't available right now. Your bid is unchanged.");
  }
}
