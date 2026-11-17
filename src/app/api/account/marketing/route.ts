import { z } from "zod";
import { createAdminClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, sameOrigin } from "@/lib/http/api";
import { CLIENT_CONSENT_SOURCES } from "@/lib/email/consent-copy";
import { recordMarketingConsent } from "@/lib/email/consent";

/**
 * Sets the signed-in account's optional marketing consent. The timestamp and notice version are set
 * here on the server, never taken from the browser. Sign-in codes and account email don't depend on it.
 */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const p = z.object({ optIn: z.boolean(), source: z.enum(CLIENT_CONSENT_SOURCES).default("account_settings") }).safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Invalid request.");
  try {
    await recordMarketingConsent(createAdminClient(), user.id, { optIn: p.data.optIn, source: p.data.source });
  } catch (e) {
    logError("account.marketing", e);
    return fail(500, "failed", "Could not save your email preference.");
  }
  return json({ ok: true });
}
