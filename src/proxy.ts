import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { ATTRIBUTION_COOKIE, ATTRIBUTION_MAX_AGE, captureAttribution, encodeAttribution } from "@/lib/growth/attribution";
import { normalizeReferralCode, REFERRAL_COOKIE, REFERRAL_MAX_AGE } from "@/lib/growth/referral";
import { TWO_STEP_REQUIRED, needsStepUp, stepUpExempt } from "@/lib/auth/mfa";
import { DEMO_BLOCKED_MESSAGE, isDemoBlocked, parseDemoClaim } from "@/lib/demo/session";
import { salesLoginRedirect } from "@/lib/sales/next";

/** First-touch attribution: set once from UTM/ic/ref parameters, an ad click id or an outside referrer host; never overwritten. */
function withAttribution(request: NextRequest, response: NextResponse): NextResponse {
  if (request.method !== "GET") return response;
  // Referral code: kept in its own cookie so a referral still counts when the visitor already has
  // first-touch attribution from an earlier visit. The first referral link wins.
  const ref = normalizeReferralCode(request.nextUrl.searchParams.get("ref"));
  if (ref && !request.cookies.has(REFERRAL_COOKIE)) {
    response.cookies.set(REFERRAL_COOKIE, ref, { maxAge: REFERRAL_MAX_AGE, httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/" });
  }
  if (request.cookies.has(ATTRIBUTION_COOKIE)) return response;
  const a = captureAttribution(request.nextUrl, request.headers.get("referer"), request.headers.get("user-agent"));
  if (a) response.cookies.set(ATTRIBUTION_COOKIE, encodeAttribution(a), { maxAge: ATTRIBUTION_MAX_AGE, httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/" });
  return response;
}

/** Refreshes the Supabase session cookie. Authorization happens in pages/routes, not here. */
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let response = NextResponse.next({ request });
  if (!url || !key) return withAttribution(request, response);
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  // getClaims() refreshes an expired session (writing the new cookies above) and verifies the token.
  // With Supabase asymmetric JWT signing keys it verifies locally against the cached public key, so
  // this runs on every page and prefetch without a call to the Auth server. With the legacy shared
  // secret it falls back to the Auth server, same as getUser(). Pages still authorize with getUser().
  const { data: claims } = await supabase.auth.getClaims();
  // Sales portal: a signed-out visit to a private /sales page goes to the sales sign-in and comes back
  // afterwards. The portal layout still authorizes; this only keeps the destination.
  if (!claims?.claims && request.method === "GET") {
    const login = salesLoginRedirect(request.nextUrl.pathname, request.nextUrl.search);
    if (login) {
      const redirect = NextResponse.redirect(new URL(login, request.url));
      response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
      return redirect;
    }
  }
  // Demo / Practice Mode: actions that would charge money, change billing or reach a real person are
  // refused for demo logins before any route runs (the database has its own guards as a backstop).
  if (request.nextUrl.pathname.startsWith("/api/") && parseDemoClaim(claims?.claims?.app_metadata) && isDemoBlocked(request.nextUrl.pathname, request.method)) {
    return Response.json({ error: { code: "demo_blocked", message: DEMO_BLOCKED_MESSAGE } }, { status: 403 }) as unknown as NextResponse;
  }
  // Two-step sign-in: a session that passed only the email code (aal1) on an account with an authenticator
  // must enter the authenticator code before using the app. Only checked for signed-in aal1 sessions; reads
  // the session cookie, no network call.
  if (claims?.claims?.aal === "aal1" && !stepUpExempt(request.nextUrl.pathname)) {
    const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (needsStepUp(level)) {
      if (request.nextUrl.pathname.startsWith("/api/")) {
        return Response.json({ error: { code: TWO_STEP_REQUIRED, message: "Enter the code from your authenticator app to continue." } }, { status: 401 }) as unknown as NextResponse;
      }
      const to = request.nextUrl.clone();
      to.pathname = "/auth/mfa";
      to.search = `?next=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`;
      const redirect = NextResponse.redirect(to);
      response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
      return redirect;
    }
  }
  return withAttribution(request, response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/stripe/webhook|api/webhooks/|api/health|media/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp4|webm|vtt)$).*)"],
};
