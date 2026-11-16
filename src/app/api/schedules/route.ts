import { createClient, getUser } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { normalizeCalendar } from "@/lib/schedule/calendar";
import { planSections } from "@/lib/schedule/engine";
import { createSchema } from "@/lib/schedule/payload";
import { scheduleDbError } from "@/lib/schedule/server";

export const runtime = "nodejs";

/**
 * Schedule Now, wizard step 8: saves a DRAFT schedule. The server rebuilds every date from the
 * durations, dependencies and calendar (the browser's preview is never trusted), and the database
 * checks access, acceptance and that each section comes from the estimate's frozen snapshot.
 * The customer is not notified.
 */
export async function POST(req: Request) {
  if (!isPmEnabled()) return fail(404, "not_found", "Not found.");
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("schedule-create", 30, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const p = createSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Check the schedule details and try again.");
  const b = p.data;
  const cal = normalizeCalendar(b.calendar);
  const keys = new Set(b.sections.map((x) => x.sourceGroupId));
  if (keys.size !== b.sections.length || b.deps.some((d) => !keys.has(d.from) || !keys.has(d.to) || d.from === d.to)) return fail(400, "invalid", "Check the dependencies and try again.");

  const supabase = await createClient();
  const { data: est } = await supabase.from("estimates").select("id, title, pipeline_stage").eq("id", b.estimateId).maybeSingle();
  if (!est) return fail(404, "not_found", "Bid not found.");
  const { data: groups } = await supabase.from("estimate_groups").select("id, name, sort_order").eq("estimate_id", b.estimateId);
  const byId = new Map(((groups ?? []) as { id: string; name: string; sort_order: number }[]).map((g) => [g.id, g]));
  if (b.sections.some((x) => !byId.has(x.sourceGroupId))) return fail(400, "invalid", "A section isn't on this bid anymore. Go back to step 2.");

  const plan = planSections(
    b.sections.map((x) => ({ key: x.sourceGroupId, sourceGroupId: x.sourceGroupId, name: byId.get(x.sourceGroupId)!.name || "Section", durationDays: x.durationDays, sortOrder: x.sortOrder })),
    b.deps, b.startDate, cal,
  );
  if (!plan) return fail(400, "cycle", "These dependencies loop back on themselves. Remove one so the sections have an order.");
  if (b.targetEndDate && b.targetEndDate < b.startDate) return fail(400, "invalid", "The target completion date is before the start date.");

  const { data, error } = await supabase.rpc("schedule_create", {
    p_estimate_id: b.estimateId,
    p_provisional: b.provisional,
    p: {
      name: b.name?.trim() || est.title, calendar: cal, startDate: plan.reduce((m, x) => (x.plannedStart < m ? x.plannedStart : m), plan[0].plannedStart),
      targetEndDate: b.targetEndDate ?? null,
      tasks: plan.map((x) => ({ key: x.key, kind: "section", sourceGroupId: x.sourceGroupId, name: x.name, plannedStart: x.plannedStart, plannedEnd: x.plannedEnd, durationDays: x.durationDays, sortOrder: x.sortOrder })),
      deps: b.deps,
    },
  });
  if (error) {
    const m = scheduleDbError(error);
    if (m.status === 500) logError("schedule.create", error);
    if (m.code === "forbidden") return fail(403, "forbidden", "Scheduling needs Project Command Center (or an editor seat for company bids).");
    return fail(m.status, m.code, m.message, m.existingId ? { scheduleId: m.existingId } : {});
  }
  // Move a Won bid to Scheduled on the pipeline (best effort; the pipeline's own rules apply).
  if (est.pipeline_stage === "won") {
    const { error: stageErr } = await supabase.rpc("set_estimate_stage", { p_estimate_id: b.estimateId, p_stage: "scheduled", p_note: "Draft schedule created" });
    if (stageErr) logError("schedule.stage", stageErr);
  }
  return json({ id: data as string }, 201);
}
