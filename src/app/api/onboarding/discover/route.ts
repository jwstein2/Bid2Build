import { z } from "zod";
import { discoverBranding, DISCOVER_ERRORS } from "@/lib/onboarding/discover";
import { createAdminClient, getUser } from "@/lib/supabase/server";
import { fail, json, rateLimit, sameOrigin } from "@/lib/http/api";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Onboarding: suggest branding from the signed-in user's public website. Read-only: returns
 * suggestions with their source; nothing is saved until the user approves them (POST /api/onboarding/branding).
 */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  if (!(await rateLimit(`discover:${user.id}`, 6, 10 * 60_000))) return fail(429, "rate_limited", "Too many lookups. Wait a few minutes or enter your details by hand.");
  const parsed = z.object({ url: z.string().trim().min(3).max(2048) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid_url", DISCOVER_ERRORS.invalid_url);
  const admin = createAdminClient();
  const { data: flag } = await admin.from("feature_flags").select("enabled").eq("key", "website_import").maybeSingle();
  if (flag && !flag.enabled) return fail(503, "disabled", "Website lookup is turned off right now. Enter your details by hand.");
  const res = await discoverBranding(parsed.data.url);
  const blocked = !res.ok && ["private_address", "blocked_host", "blocked_protocol", "blocked_port"].includes(res.code);
  try {
    await admin.from("import_logs").insert({ user_id: user.id, url_host: res.ok ? new URL(res.data.finalUrl).hostname : null, status: res.ok ? (Object.keys(res.data.fields).length >= 2 ? "success" : "partial") : blocked ? "blocked" : "failed", error_code: res.ok ? null : res.code });
  } catch { /* best effort */ }
  if (!res.ok) return fail(422, res.code, DISCOVER_ERRORS[res.code] ?? DISCOVER_ERRORS.fetch_failed);
  return json(res.data);
}
