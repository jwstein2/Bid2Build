import { NextResponse } from "next/server";
import { normalizeReferralCode, referralLandingPath } from "@/lib/growth/referral";

/**
 * Short referral link: /r/<code> -> /?ref=<code>&utm_source=referral&... The proxy stores the code
 * in its own cookie on the landing request. Unknown-looking codes just go to the home page.
 */
export function GET(req: Request, ctx: RouteContext<"/r/[code]">) {
  return ctx.params.then(({ code }) => {
    const c = normalizeReferralCode(code);
    return NextResponse.redirect(new URL(c ? referralLandingPath(c) : "/", req.url), 307);
  });
}
