import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import { isSupabaseConfigured, serverEnv } from "@/lib/env";
import { logError } from "@/lib/http/api";
import { decodeRepCookie, encodeRepCookie, normalizeRepCode, repLandingPath, SALES_COOKIE, SALES_COOKIE_MAX_AGE } from "@/lib/sales/link";

/**
 * Sales rep link: /s/<code>[?to=/pricing] -> the home page (or that page) with sales UTM tags.
 * Remembers the rep in a first-party cookie (the first rep link a browser opens wins) and counts one
 * visit per browser. The account-level attribution is recorded when the visitor signs in
 * ((app)/layout.tsx), so it survives cookie loss after that. A click alone never earns a commission.
 * The Location is relative on purpose (Netlify's req.url is the internal deploy URL).
 */
export async function GET(req: Request, ctx: RouteContext<"/s/[code]">) {
  const code = normalizeRepCode((await ctx.params).code);
  const to = new URL(req.url).searchParams.get("to");
  const headers = new Headers({ Location: code ? repLandingPath(code, to) : "/", "Cache-Control": "no-store" });
  if (!code) return new Response(null, { status: 307, headers });
  const jar = await cookies();
  const existing = decodeRepCookie(jar.get(SALES_COOKIE)?.value);
  if (!existing) {
    let known = true;
    if (isSupabaseConfigured() && serverEnv().supabaseServiceKey) {
      try {
        const { data, error } = await createAdminClient().rpc("sales_log_visit", { p_code: code });
        if (!error) known = Boolean(data);
      } catch (e) {
        logError("sales.visit", e);
      }
    }
    if (known) {
      const secure = new URL(req.url).protocol === "https:" || process.env.NODE_ENV === "production";
      headers.append("Set-Cookie", `${SALES_COOKIE}=${encodeRepCookie(code)}; Max-Age=${SALES_COOKIE_MAX_AGE}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`);
    }
  }
  return new Response(null, { status: 307, headers });
}
