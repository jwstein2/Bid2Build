import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { companyRpcError } from "@/lib/enterprise/errors";
import { STAGES } from "@/lib/pipeline/board";

const Body = z.object({
  estimateId: z.string().uuid(),
  stage: z.enum(STAGES),
  note: z.string().max(1000).optional(),
  /** Approval / outcome date chosen by the contractor (YYYY-MM-DD). Never in the future (checked in SQL too). */
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * Moves a bid on the contractor's sales pipeline. Who may move which bid, and which transitions are legal
 * (signed bids can't go back before Won, job stages need a won bid), is decided in set_estimate_stage (SQL).
 * This never creates, changes or implies an e-signature.
 */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("pipeline-stage", 240, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  if (!(await getUser())) return fail(401, "not_authenticated", "Sign in required.");
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "That change isn't valid.");
  const b = p.data;
  let effective: string | null = null;
  if (b.effectiveDate) {
    const d = new Date(`${b.effectiveDate}T12:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.getTime() > Date.now() + 864e5) return fail(400, "invalid_date", "Choose a date that isn't in the future.");
    effective = d.toISOString();
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_estimate_stage", {
    p_estimate_id: b.estimateId, p_stage: b.stage, p_note: b.note?.trim() || null, p_effective_at: effective,
  });
  if (error) {
    // Before the V4 migration runs, job stages and dates don't exist yet.
    if (/p_effective_at|estimates_pipeline_stage_check|function .*set_estimate_stage/i.test(error.message ?? ""))
      return fail(409, "migration_pending", "This pipeline move needs a quick database update. Please try again later.");
    const e = companyRpcError(error);
    if (e.status >= 500) logError("pipeline.stage", error, { stage: b.stage });
    return fail(e.status, e.code, e.message);
  }
  return json({ ok: true });
}
