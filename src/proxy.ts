import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { ATTRIBUTION_COOKIE, ATTRIBUTION_MAX_AGE, captureAttribution, encodeAttribution } from "@/lib/growth/attribution";
import { normalizeReferralCode, REFERRAL_COOKIE, REFERRAL_MAX_AGE } from "@/lib/growth/referral";
import { TWO_STEP_REQUIRED, needsStepUp, stepUpExempt } from "@/lib/auth/mfa";
import { demoBlockedMessage, isDemoBlocked, parseDemoClaim } from "@/lib/demo/session";
import { isSwitchableRequest, PRACTICE_PAUSE_COOKIE } from "@/lib/demo/scope";
import { practiceSwap, type CookieOp } from "@/lib/demo/swap";
import { SALES_JOIN_COOKIE, SALES_JOIN_MAX_AGE, inviteTokenFromPath, salesLoginRedirect } from "@/lib/sales/next";
import { canonicalHostRedirect } from "@/lib/config/deploy";
import { appLoginRedirect } from "@/lib/auth/app-next";

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

/**
 * Opening a sales invite link remembers its token (httpOnly) so the invite survives sign-up, email
 * verification in another tab and any redirect. Validity is always checked on the server when used.
 */
function withSalesInvite(request: NextRequest, response: NextResponse): NextResponse {
  const token = request.method === "GET" ? inviteTokenFromPath(request.nextUrl.pathname) : null;
  if (token) response.cookies.set(SALES_JOIN_COOKIE, token, { maxAge: SALES_JOIN_MAX_AGE, httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/" });
  return response;
}

/** Refreshes the Supabase session cookie. Authorization happens in pages/routes, not here. */
export async function proxy(request: NextRequest) {
  // Stray netlify.app hosts (main--built2bid.netlify.app, built2bid.netlify.app) go to built2bid.org
  // before anything else, so nobody signs in and works on the wrong host. GET/HEAD only: a form post
  // or API call is never turned into a GET.
  if (request.method === "GET" || request.method === "HEAD") {
    const canonical = canonicalHostRedirect(request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host, {
      NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
      NEXT_PUBLIC_DEPLOY_CONTEXT: process.env.NEXT_PUBLIC_DEPLOY_CONTEXT,
    });
    if (canonical) return NextResponse.redirect(`${canonical}${request.nextUrl.pathname}${request.nextUrl.search}`, 301);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let response = NextResponse.next({ request });
  if (!url || !key) return withSalesInvite(request, withAttribution(request, response));
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
  let { data: claims } = await supabase.auth.getClaims();
  // Practice Mode covers only the paid app: leaving it pauses the practice session and returns to the real
  // account (Academy, news, admin, public site); coming back resumes it. See src/lib/demo/swap.ts.
  const swapCookies: CookieOp[] = [];
  const path = request.nextUrl.pathname;
  if (claims?.claims && !path.startsWith("/api/") && !path.startsWith("/auth/") && isSwitchableRequest(request.method, request.headers)
    && (parseDemoClaim(claims.claims.app_metadata) || request.cookies.has(PRACTICE_PAUSE_COOKIE))) {
    try {
      const r = await practiceSwap(supabase, path, claims.claims, (n) => request.cookies.get(n)?.value);
      swapCookies.push(...r.cookies);
      if (r.swapped) ({ data: claims } = await supabase.auth.getClaims());
    } catch { /* the request carries on with the session it arrived with */ }
  }
  const secure = request.nextUrl.protocol === "https:";
  const withSwap = <T extends NextResponse>(res: T): T => {
    for (const c of swapCookies) res.cookies.set(c.name, c.value, { maxAge: c.maxAge, httpOnly: c.httpOnly, secure, sameSite: "lax", path: "/" });
    return res;
  };
  // Sales portal: a signed-out visit to a private /sales page goes to the sales sign-in and comes back
  // afterwards. The portal layout still authorizes; this only keeps the destination.
  if (!claims?.claims && request.method === "GET") {
    // App pages do the same with the main sign-in (the app layout alone could only send them to /dashboard).
    const login = salesLoginRedirect(request.nextUrl.pathname, request.nextUrl.search) ?? appLoginRedirect(request.nextUrl.pathname, request.nextUrl.search);
    if (login) {
      const redirect = NextResponse.redirect(new URL(login, request.url));
      response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
      return redirect;
    }
  }
  // Demo / Practice Mode: actions that would charge money, change billing or reach a real person are
  // refused for demo logins before any route runs (the database has its own guards as a backstop).
  const demoClaim = request.nextUrl.pathname.startsWith("/api/") ? parseDemoClaim(claims?.claims?.app_metadata) : null;
  if (demoClaim && isDemoBlocked(request.nextUrl.pathname, request.method)) {
    return Response.json({ error: { code: "demo_blocked", message: demoBlockedMessage(demoClaim.kind) } }, { status: 403 }) as unknown as NextResponse;
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
      return withSwap(redirect);
    }
  }
  return withSwap(withSalesInvite(request, withAttribution(request, response)));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/stripe/webhook|api/stripe/connect-webhook|api/webhooks/|api/health|media/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp4|webm|vtt)$).*)"],
};
