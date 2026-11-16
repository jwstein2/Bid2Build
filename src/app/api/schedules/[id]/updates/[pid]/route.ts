import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { newSigningToken, hashSigningToken } from "@/lib/esign/token";
import { getPublication, publicationDbError } from "@/lib/schedule/publications";
import { site } from "@/lib/site";

export const runtime = "nodejs";
const UUID = /^[0-9a-f-]{36}$/i;
type Ctx = { params: Promise<{ id: string; pid: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  if (!isPmEnabled()) return fail(404, "not_found", "Not found.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { id, pid } = await ctx.params;
  if (!UUID.test(id) || !UUID.test(pid)) return fail(404, "not_found", "Update not found.");
  const pub = await getPublication(await createClient(), id, pid);
  return pub ? json({ publication: pub }) : fail(404, "not_found", "Update not found.");
}

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("link"), days: z.number().int().min(1).max(90).default(30) }).strict(),
  z.object({ action: z.literal("revoke") }).strict(),
  z.object({ action: z.literal("delivery"), method: z.enum(["pdf_download", "email_draft", "share_sheet", "link_copied"]) }).strict(),
]);

/**
 * link     -> a new secure share link for this update (the raw token is returned once, never stored).
 * revoke   -> turns the link off.
 * delivery -> records what the contractor did (PDF downloaded, email draft opened). Never "delivered".
 */
export async function POST(req: Request, ctx: Ctx) {
  if (!isPmEnabled()) return fail(404, "not_found", "Not found.");
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("schedule-update-action", 120, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { id, pid } = await ctx.params;
  if (!UUID.test(id) || !UUID.test(pid)) return fail(404, "not_found", "Update not found.");
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "That request isn't valid.");
  const supabase = await createClient();
  const pub = await getPublication(supabase, id, pid);
  if (!pub) return fail(404, "not_found", "Update not found.");

  let url: string | undefined;
  let error: { message?: string } | null = null;
  if (p.data.action === "link") {
    const token = newSigningToken();
    ({ error } = await supabase.rpc("schedule_publication_link", { p_publication_id: pid, p_token_hash: hashSigningToken(token), p_days: p.data.days }));
    url = `${site.url}/updates/${token}`;
  } else if (p.data.action === "revoke") {
    ({ error } = await supabase.rpc("schedule_publication_revoke_link", { p_publication_id: pid }));
  } else {
    ({ error } = await supabase.rpc("schedule_publication_delivery", { p_publication_id: pid, p_method: p.data.method }));
  }
  if (error) {
    const e = publicationDbError(error);
    if (e.status >= 500) logError("schedule.update_action", error, { action: p.data.action });
    return fail(e.status, e.code, e.status === 500 ? "Something went wrong. Please try again." : e.message);
  }
  return json({ publication: await getPublication(supabase, id, pid), ...(url ? { url } : {}) });
}
