import { z } from "zod";
import { extractBrand } from "@/lib/import/website";
import { safeFetch, SafeFetchError } from "@/lib/security/ssrf";
import { processLogo } from "@/lib/security/upload";
import { getUser, createAdminClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { fail, json, rateLimit, sameOrigin } from "@/lib/http/api";

export const runtime = "nodejs";
export const maxDuration = 30;

const MESSAGES: Record<string, string> = {
  invalid_url: "That doesn't look like a website address.",
  blocked_protocol: "Only http and https websites can be imported.",
  blocked_port: "That address uses a port we can't import from.",
  blocked_host: "That address can't be imported. Use your public website address.",
  private_address: "That address points to a private network and can't be imported.",
  dns_failed: "We couldn't find that website. Check the spelling.",
  timeout: "The website took too long to respond.",
  too_large: "The page was too large to import.",
  too_many_redirects: "The website redirected too many times.",
  fetch_failed: "We couldn't reach that website.",
  bad_redirect: "The website returned an invalid redirect.",
};

async function log(status: string, host: string | null, code: string | null, userId: string | null) {
  if (!isSupabaseConfigured()) return;
  try { await createAdminClient().from("import_logs").insert({ user_id: userId, url_host: host, status, error_code: code }); } catch { /* best effort */ }
}

export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("import", 8, 10 * 60_000))) return fail(429, "rate_limited", "Too many imports. Please wait a few minutes or enter details manually.");
  const parsed = z.object({ url: z.string().min(3).max(2048) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid_url", MESSAGES.invalid_url);
  const user = await getUser().catch(() => null);
  if (isSupabaseConfigured()) {
    const { data: flag } = await createAdminClient().from("feature_flags").select("enabled").eq("key", "website_import").maybeSingle();
    if (flag && !flag.enabled) return fail(503, "disabled", "Website import is turned off right now. Enter your details manually.");
  }

  let page;
  try {
    page = await safeFetch(parsed.data.url);
  } catch (e) {
    const code = e instanceof SafeFetchError ? e.code : "fetch_failed";
    await log(["private_address", "blocked_host", "blocked_protocol", "blocked_port"].includes(code) ? "blocked" : "failed", null, code, user?.id ?? null);
    return fail(422, code, MESSAGES[code] ?? MESSAGES.fetch_failed);
  }
  if (page.status >= 400) {
    await log("failed", page.url.hostname, `http_${page.status}`, user?.id ?? null);
    return fail(422, "http_error", `The website responded with an error (${page.status}).`);
  }
  if (!/text\/html|application\/xhtml/i.test(page.contentType)) {
    await log("failed", page.url.hostname, "not_html", user?.id ?? null);
    return fail(422, "not_html", "That address isn't a web page.");
  }
  const brand = extractBrand(page.body.toString("utf8"), page.url);

  let logoDataUrl: string | null = null;
  for (const candidate of brand.logoCandidates.slice(0, 3)) {
    try {
      const img = await safeFetch(candidate, { accept: "image/png,image/jpeg,image/webp,image/svg+xml", maxBytes: 2_000_000, timeoutMs: 6000 });
      const processed = await processLogo(img.body);
      if (processed.ok && processed.width >= 32) { logoDataUrl = `data:image/png;base64,${processed.png.toString("base64")}`; break; }
    } catch { /* try next */ }
  }
  const found = [brand.companyName, brand.phone, brand.email, brand.address, logoDataUrl].filter(Boolean).length;
  await log(found >= 2 ? "success" : "partial", page.url.hostname, null, user?.id ?? null);
  return json({ ...brand, website: page.url.origin, logoDataUrl, logoCandidates: undefined });
}
