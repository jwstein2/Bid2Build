import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { ATTRIBUTION_COOKIE, ATTRIBUTION_MAX_AGE, encodeAttribution, parseAttribution } from "@/lib/growth/attribution";

/** First-touch campaign attribution: set once from UTM/ic/ref parameters, never overwritten. */
function withAttribution(request: NextRequest, response: NextResponse): NextResponse {
  if (request.cookies.has(ATTRIBUTION_COOKIE) || request.method !== "GET") return response;
  const a = parseAttribution(request.nextUrl);
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
  await supabase.auth.getUser();
  return withAttribution(request, response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/stripe/webhook|api/webhooks/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
