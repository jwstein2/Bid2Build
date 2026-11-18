import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, rateLimit, sameOrigin } from "@/lib/http/api";
import { isCancelReason, isClickTarget, isOfferId } from "@/lib/offers/policy";
import { claimOffer, logOffer } from "@/lib/offers/server";
import { referralLink, type MyReferral } from "@/lib/growth/referral";

export const runtime = "nodejs";

const Body = z.object({
  offer: z.string().max(40),
  action: z.enum(["claim", "clicked", "dismissed", "answered"]),
  detail: z.string().max(40).optional(),
});

/**
 * In-app offers (src/lib/offers/policy.ts).
 *  claim     → { show } after checking caps and suppression; records "shown" when allowed.
 *  clicked   → detail = where it went (fixed list).
 *  dismissed → no detail.
 *  answered  → "Before you go" reason (fixed list), RET-1 only.
 * Never stores bid content, amounts, names or emails.
 */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  if (!(await rateLimit(`offers:${user.id}`, 40, 10 * 60_000))) return fail(429, "rate_limited", "Too many requests.");
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !isOfferId(parsed.data.offer)) return fail(400, "bad_request", "Unknown offer.");
  const { offer, action, detail } = parsed.data as { offer: Parameters<typeof logOffer>[1]; action: "claim" | "clicked" | "dismissed" | "answered"; detail?: string };
  const supabase = await createClient();

  if (action === "claim") {
    const show = await claimOffer(supabase, user, offer);
    if (!show) return json({ show: false });
    if (offer === "t8_first_sent") {
      const { data } = await supabase.rpc("my_referral");
      const r = data as MyReferral | null;
      return json({ show: true, referralLink: r?.code ? referralLink(r.code) : null });
    }
    return json({ show: true });
  }
  if (action === "clicked" && detail !== undefined && !isClickTarget(detail)) return fail(400, "bad_request", "Unknown target.");
  if (action === "answered" && (offer !== "ret1_cancel" || !isCancelReason(detail))) return fail(400, "bad_request", "Unknown reason.");
  const ok = await logOffer(user.id, offer, action, action === "dismissed" ? null : detail ?? null);
  return json({ ok });
}
