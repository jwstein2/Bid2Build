import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { sanitizeCompanyStyle, sanitizeLocks } from "@/lib/operations/proposal-style";
import { missingMigration } from "@/lib/operations/server";

export const runtime = "nodejs";

/** The company's proposal style, policy and recent history (needs "View company proposal style"). */
export async function GET() {
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { data, error } = await (await createClient()).rpc("company_proposal_style");
  if (error) {
    if (missingMigration(error)) return json({ available: false });
    logError("style.get", error);
    return fail(500, "server_error", "We couldn't load the proposal style.");
  }
  if (!data) return fail(403, "forbidden", "Your company role can't view the proposal style.");
  return json({ available: true, ...(data as object) });
}

const schema = z.object({ baseRevision: z.number().int().min(0), style: z.unknown(), locked: z.array(z.string().max(40)).max(30), allowCustomization: z.boolean() });

/**
 * Save the company style and policy. The database checks each part separately: the style needs
 * "Manage company proposal template", the toggle and locks need "Change company-wide proposal policy"
 * (owner-granted only). Inputs are sanitized to presentation keys; nothing here touches prices.
 */
export async function PUT(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("style-save", 60, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const p = schema.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Check the style settings.");
  const { data, error } = await (await createClient()).rpc("company_proposal_style_save", {
    p_base_revision: p.data.baseRevision, p_style: sanitizeCompanyStyle(p.data.style), p_locked: sanitizeLocks(p.data.locked), p_allow: p.data.allowCustomization,
  });
  if (error) {
    const m = error.message;
    if (m.includes("stale_revision")) return fail(409, "stale", "Someone else saved the style. Reload to see their changes.");
    if (m.includes("forbidden_template")) return fail(403, "forbidden", "You need “Manage company proposal template” to change the style.");
    if (m.includes("forbidden_policy")) return fail(403, "forbidden", "Only the company owner (or someone they granted “Change company-wide proposal policy”) can change the toggle or locks.");
    if (m.includes("forbidden")) return fail(403, "forbidden", "You're not in a company.");
    logError("style.save", error);
    return fail(500, "server_error", "We couldn't save the style.");
  }
  return json({ revision: data as number });
}
