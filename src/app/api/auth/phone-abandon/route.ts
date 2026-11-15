import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { isAbandonedPhoneSignup, phoneDigits } from "@/lib/auth/phone";
import { isSmsAuthAllowedOnServer } from "@/lib/auth/config";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";

export const runtime = "nodejs";

const PAGE = 1000;
const MAX_PAGES = 20;

/**
 * Called by the sign-in box when "I'm new here" could not text the code. Removes the phone-only
 * account Supabase created a moment earlier, but only when it is provably that leftover (see
 * isAbandonedPhoneSignup): unconfirmed, never signed in, no email, minutes old. Always answers the
 * same way so it can't be used to learn whether a number has an account.
 */
export async function POST(req: Request) {
  // SMS auth is off: this route does nothing and looks like it doesn't exist.
  if (!isSmsAuthAllowedOnServer()) return fail(404, "not_found", "Not found.");
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("phone-abandon", 5, 10 * 60_000))) return fail(429, "rate_limited", "Too many requests.");
  const p = z.object({ phone: z.string().min(8).max(20) }).safeParse(await req.json().catch(() => null));
  const digits = p.success ? phoneDigits(p.data.phone) : "";
  if (digits.length < 8 || digits.length > 15) return fail(400, "invalid", "Invalid phone number.");
  try {
    const admin = createAdminClient();
    const now = Date.now();
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PAGE });
      if (error) throw error;
      const users = data?.users ?? [];
      const match = users.find((u) => phoneDigits(u.phone) === digits);
      if (match) {
        if (isAbandonedPhoneSignup(match, digits, now)) {
          const { error: delErr } = await admin.auth.admin.deleteUser(match.id);
          if (delErr) throw delErr;
          await admin.from("audit_logs").insert({ actor_id: null, action: "auth.phone_signup_abandoned", target_type: "user", target_id: match.id });
        }
        break;
      }
      if (users.length < PAGE) break;
    }
  } catch (e) {
    logError("auth.phone_abandon", e);
  }
  return json({ ok: true });
}
