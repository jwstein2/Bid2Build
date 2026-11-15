import { z } from "zod";
import { estimateSchema, proposalConfigSchema } from "@/lib/estimate/schema";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, sameOrigin } from "@/lib/http/api";
import { saveProjectProfile } from "@/lib/market/server";
import { estimateOptionsToStore, worksheetToStore } from "@/lib/data/mappers";
import { fillLocationFromAddress } from "@/lib/geo/address";

const body = z.object({ estimate: estimateSchema, proposalConfig: proposalConfigSchema });

export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in to save to your account.");
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid", "Some estimate fields are invalid.", { issues: parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join("."), message: i.message })) });
  const { proposalConfig } = parsed.data;
  // Fill EMPTY ZIP/state/city from a typed project address ("..., Austin, TX 78701") so reports and
  // regional pricing know where the job is. Never overwrites what the contractor entered. Location is
  // not part of the proposal or its content hash, so this never creates a new version.
  const estimate = { ...parsed.data.estimate, location: fillLocationFromAddress(parsed.data.estimate.location, parsed.data.estimate.customer.projectAddress) };
  const supabase = await createClient();
  // The worksheet (calculator inputs, minimum charge) and the final-bid rounding preference ride
  // inside proposal_config: no schema change.
  const worksheet = worksheetToStore(estimate);
  const { error } = await supabase.rpc("save_estimate", { p: { ...estimate, proposalConfig: { ...proposalConfig, ...estimateOptionsToStore(estimate), worksheet: worksheet ?? undefined } } });
  if (error) {
    logError("estimates.save", error, { user: user.id });
    if (error.code === "P0002" || /row-level security/.test(error.message)) return fail(404, "not_found", "Estimate not found.");
    return fail(500, "save_failed", "We could not save your estimate. Your changes are still on this device.");
  }
  await saveProjectProfile(supabase, user.id, estimate);
  return json({ ok: true, savedAt: new Date().toISOString() });
}
