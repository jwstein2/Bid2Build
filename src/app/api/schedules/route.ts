import { createClient, getUser } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { normalizeCalendar } from "@/lib/schedule/calendar";
import { planSections } from "@/lib/schedule/engine";
import { createSchema } from "@/lib/schedule/payload";
import { scheduleDbError } from "@/lib/schedule/server";

export const runtime = "nodejs";

/**
 * Schedule Now, wizard step 8: saves a DRAFT schedule (or publishes it straight away when asked). The server rebuilds every date from the
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
  // V4.3: a newly approved job is reviewed by a PM before it is scheduled (Needs PM Review → Ready to Schedule).
  const { data: review, error: reviewErr } = await supabase.from("project_reviews").select("status").eq("estimate_id", b.estimateId).maybeSingle();
  if (!reviewErr && review?.status === "needs_review") {
    if (!b.markReviewed) return fail(409, "needs_review", "Review this newly approved job before scheduling it.");
  }
  const needsMark = !reviewErr && review?.status === "needs_review";
  const { data: groups } = await supabase.from("estimate_groups").select("id, name, sort_order").eq("estimate_id", b.estimateId);
  const byId = new Map(((groups ?? []) as { id: string; name: string; sort_order: number }[]).map((g) => [g.id, g]));
  if (b.sections.some((x) => !byId.has(x.sourceGroupId))) return fail(400, "invalid", "A section isn't on this bid anymore. Go back to step 2.");

  const plan = planSections(
    b.sections.map((x) => ({ key: x.sourceGroupId, sourceGroupId: x.sourceGroupId, name: byId.get(x.sourceGroupId)!.name || "Section", durationDays: x.durationDays, sortOrder: x.sortOrder, offsetDays: x.offsetDays ?? 0 })),
    b.deps, b.startDate, cal,
  );
  if (!plan) return fail(400, "cycle", "These dependencies loop back on themselves. Remove one so the sections have an order.");
  if (b.targetEndDate && b.targetEndDate < b.startDate) return fail(400, "invalid", "The target completion date is before the start date.");

  // Recorded only once the request is otherwise valid, so a rejected schedule never marks the job reviewed.
  if (needsMark) {
    const { error: markErr } = await supabase.rpc("project_mark_reviewed", { p_estimate_id: b.estimateId, p_note: null });
    if (markErr) return fail(403, "forbidden_review", "Your company role can't review approved jobs. Ask a project manager to review it first.");
  }
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
  // V4.3: a DRAFT schedule never moves the pipeline. The project becomes Scheduled when a schedule is
  // published as the active schedule (a database trigger does it, the same from every entry point).
  const id = data as string;
  if (b.publish && !b.provisional) {
    const { data: s } = await supabase.from("project_schedules").select("revision").eq("id", id).maybeSingle();
    const { error: pubErr } = await supabase.rpc("schedule_save", { p_schedule_id: id, p_base_revision: s?.revision ?? 1, p: { summary: "Published as the active schedule", schedule: { status: "active" } } });
    if (pubErr) { logError("schedule.publish", pubErr); return json({ id, published: false, publishError: scheduleDbError(pubErr).message }, 201); }
    return json({ id, published: true }, 201);
  }
  return json({ id }, 201);
}
