import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import { isSupabaseConfigured, serverEnv } from "@/lib/env";
import { logError } from "@/lib/http/api";
import { AFFILIATE_COOKIE, AFFILIATE_COOKIE_MAX_AGE, affiliateLandingPath, cleanTag, decodeAffiliateCookie, encodeAffiliateCookie, normalizeAffiliateCode } from "@/lib/affiliates/link";

const hash = (s: string) => createHash("sha256").update(`b2b-aff:${s}`).digest("hex").slice(0, 32);

/**
 * Affiliate link: /a/<code>[?c=campaign&s=source&to=/pricing] -> the home page (or that public page) with affiliate
 * UTM tags. Logs one click (IP and user agent are stored only as salted hashes, for fraud checks) and remembers the
 * affiliate in a first-party cookie; the first affiliate link a browser opens wins. The account is attributed when
 * the visitor signs up ((app)/layout.tsx): a click alone never earns anything. Bots and prefetches are not counted.
 */
export async function GET(req: Request, ctx: RouteContext<"/a/[code]">) {
  const code = normalizeAffiliateCode((await ctx.params).code);
  const url = new URL(req.url);
  const campaign = cleanTag(url.searchParams.get("c")), source = cleanTag(url.searchParams.get("s"));
  const headers = new Headers({ Location: code ? affiliateLandingPath(code, url.searchParams.get("to"), campaign) : "/", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" });
  if (!code) return new Response(null, { status: 307, headers });
  const ua = req.headers.get("user-agent") ?? "";
  const prefetch = req.headers.get("purpose") === "prefetch" || req.headers.get("sec-purpose")?.includes("prefetch") || req.headers.get("next-router-prefetch") === "1";
  const bot = /bot|crawl|spider|slurp|facebookexternalhit|preview|curl|wget|python-requests|headless/i.test(ua);
  const jar = await cookies();
  if (decodeAffiliateCookie(jar.get(AFFILIATE_COOKIE)?.value) || prefetch || bot) return new Response(null, { status: 307, headers });
  let clickId: string | null = null;
  if (isSupabaseConfigured() && serverEnv().supabaseServiceKey) {
    try {
      const ip = (req.headers.get("x-nf-client-connection-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "").trim();
      const { data, error } = await createAdminClient().rpc("affiliate_log_click", {
        p_code: code, p_campaign: campaign, p_source: source, p_path: url.searchParams.get("to") ?? "/", p_ip_hash: ip ? hash(ip) : null, p_ua_hash: ua ? hash(ua) : null,
      });
      if (error) return new Response(null, { status: 307, headers });
      clickId = (data as string | null) ?? null;
      if (!clickId) return new Response(null, { status: 307, headers }); // unknown or inactive affiliate: no cookie
    } catch (e) {
      logError("affiliate.click", e);
      return new Response(null, { status: 307, headers });
    }
  }
  const secure = url.protocol === "https:" || process.env.NODE_ENV === "production";
  headers.append("Set-Cookie", `${AFFILIATE_COOKIE}=${encodeAffiliateCookie(code, clickId)}; Max-Age=${AFFILIATE_COOKIE_MAX_AGE}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`);
  return new Response(null, { status: 307, headers });
}
