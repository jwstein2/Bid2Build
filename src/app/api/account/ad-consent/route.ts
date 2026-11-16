import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, sameOrigin } from "@/lib/http/api";
import { AD_CONSENT_KEY } from "@/lib/growth/consent";

/** Store the signed-in account's ad-measurement choice (and Meta browser ids, if granted). */
const body = z.object({ granted: z.boolean(), fbp: z.string().max(200).regex(/^fb\.\d\.\d+\.\d+$/).optional(), fbc: z.string().max(600).regex(/^fb\.\d\.\d+\.[\w-]+$/).optional() });

export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const user = await getUser();
  if (!user) return json({ ok: true, stored: false });
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Invalid request.");
  const value = p.data.granted ? { granted: true, at: new Date().toISOString(), fbp: p.data.fbp ?? null, fbc: p.data.fbc ?? null } : { granted: false, at: new Date().toISOString() };
  const { error } = await (await createClient()).auth.updateUser({ data: { [AD_CONSENT_KEY]: value } });
  if (error) { logError("ad_consent.save", error, { user: user.id }); return fail(500, "save_failed", "Could not save that."); }
  return json({ ok: true, stored: true });
}
