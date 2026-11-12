import { businessSchema, proposalConfigSchema } from "@/lib/estimate/schema";
import { businessToRow } from "@/lib/data/mappers";
import { loadBusiness } from "@/lib/data/server";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, sameOrigin } from "@/lib/http/api";
import { z } from "zod";

export async function GET() {
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const supabase = await createClient();
  const { business, exists } = await loadBusiness(supabase, user.id);
  const { data } = await supabase.from("business_profiles").select("default_proposal_config").eq("user_id", user.id).maybeSingle();
  return json({ business, exists, defaultProposalConfig: data?.default_proposal_config ?? null });
}

const body = z.object({ business: businessSchema, defaultProposalConfig: proposalConfigSchema.optional() });

export async function PUT(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid", "Some business fields are invalid.", { issues: parsed.error.issues.slice(0, 10).map((i) => i.path.join(".")) });
  const b = parsed.data.business;
  // Only accept a logo path inside the caller's own folder.
  if (b.logoPath && !b.logoPath.startsWith(`${user.id}/`)) return fail(400, "invalid", "Invalid logo.");
  const row = { ...businessToRow({ ...b, logoUrl: null }, user.id), ...(parsed.data.defaultProposalConfig ? { default_proposal_config: parsed.data.defaultProposalConfig } : {}) };
  const { error } = await (await createClient()).from("business_profiles").upsert(row, { onConflict: "user_id" });
  if (error) {
    logError("business.save", error, { user: user.id });
    return fail(500, "save_failed", "Could not save your company profile.");
  }
  return json({ ok: true });
}
