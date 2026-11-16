import { normalizeReferralCode, referralLandingPath } from "@/lib/growth/referral";

/**
 * Short referral link: /r/<code> -> /?ref=<code>&utm_source=referral&... The proxy stores the code
 * in its own cookie on the landing request. Unknown-looking codes just go to the home page.
 * The Location is relative on purpose: on Netlify req.url is the internal deploy URL
 * (<id>--built2bid.netlify.app), which would move the visitor off built2bid.org.
 */
export async function GET(_req: Request, ctx: RouteContext<"/r/[code]">) {
  const c = normalizeReferralCode((await ctx.params).code);
  return new Response(null, { status: 307, headers: { Location: c ? referralLandingPath(c) : "/", "Cache-Control": "no-store" } });
}
