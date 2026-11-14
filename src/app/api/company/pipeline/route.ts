import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { companyRpcError } from "@/lib/enterprise/errors";
import { STAGES } from "@/lib/enterprise/pipeline";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("stage"), estimateId: z.string().uuid(), stage: z.enum(STAGES), note: z.string().max(1000).optional() }),
  z.object({ action: z.literal("approval_rule"), required: z.boolean() }),
]);

/** Pipeline stage changes and the approval rule. Who may do what is decided in set_estimate_stage (SQL). */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("company-pipeline", 120, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  if (!(await getUser())) return fail(401, "not_authenticated", "Sign in required.");
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "That change isn't valid.");
  const supabase = await createClient();
  const b = p.data;
  const { error } = b.action === "stage"
    ? await supabase.rpc("set_estimate_stage", { p_estimate_id: b.estimateId, p_stage: b.stage, p_note: b.note ?? null })
    : await supabase.rpc("set_company_approval_rule", { p_required: b.required });
  if (error) {
    const e = companyRpcError(error);
    if (e.status >= 500) logError("company.pipeline", error, { action: b.action });
    return fail(e.status, e.code, e.message);
  }
  return json({ ok: true });
}
