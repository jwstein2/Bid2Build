import { createClient, getUser } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { normalizeCalendar } from "@/lib/schedule/calendar";
import { diffTasks, validateSchedule } from "@/lib/schedule/engine";
import { NEW_ID, saveSchema } from "@/lib/schedule/payload";
import { loadSchedule, scheduleDbError } from "@/lib/schedule/server";
import { changeKinds } from "@/lib/schedule/permissions";
import type { Task } from "@/lib/schedule/types";
import { liveDateChanges } from "@/lib/operations/live-schedule";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(_req: Request, ctx: Ctx) {
  if (!isPmEnabled()) return fail(404, "not_found", "Not found.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { id } = await ctx.params;
  if (!UUID.test(id)) return fail(404, "not_found", "Schedule not found.");
  const data = await loadSchedule(await createClient(), id);
  return data ? json(data) : fail(404, "not_found", "Schedule not found.");
}

const IMMUTABLE = ["kind", "sourceGroupId", "sourceItemId", "parentId", "splitFrom"] as const;
const FIELDS = ["name", "sortOrder", "plannedStart", "plannedEnd", "durationDays", "actualStart", "actualFinish", "percentComplete", "status", "weight", "assignee", "notes"] as const;

/**
 * Saves an edit. The browser sends the whole task list as it should be after the edit; the server
 * re-validates everything (dates, durations from the calendar, completion rules, dependency loops,
 * line items belonging to their section), checks the revision so two editors can't overwrite each
 * other, and records a revision with every task whose dates changed.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  if (!isPmEnabled()) return fail(404, "not_found", "Not found.");
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("schedule-save", 240, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { id } = await ctx.params;
  if (!UUID.test(id)) return fail(404, "not_found", "Schedule not found.");
  const p = saveSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "That change isn't valid.");
  const b = p.data;

  const supabase = await createClient();
  const cur = await loadSchedule(supabase, id);
  if (!cur) return fail(404, "not_found", "Schedule not found.");
  if (!cur.canEdit) return fail(403, "forbidden", "You can view this schedule but can't edit it.");
  if (cur.schedule.revision !== b.baseRevision) return fail(409, "stale_revision", "Someone else changed this schedule. Reload to see the latest version.");

  const cal = normalizeCalendar(b.schedule?.calendar ?? cur.schedule.calendar);
  const { tasks, problems } = validateSchedule(b.tasks as Task[], b.deps, cal);
  if (problems.length) return fail(400, "invalid_schedule", problems[0].message, { problems: problems.slice(0, 20) });

  const before = new Map(cur.tasks.map((t) => [t.id, t]));
  const ids = new Set(tasks.map((t) => t.id));
  for (const t of tasks) {
    const o = before.get(t.id);
    if (!o && !NEW_ID.test(t.id)) return fail(400, "invalid", "A task in this change no longer exists. Reload and try again.");
    if (o && IMMUTABLE.some((k) => o[k] !== t[k])) return fail(400, "invalid", "Tasks can't be moved to another section.");
    if (!o && (t.kind === "section" && !t.splitFrom)) return fail(400, "invalid", "Sections come from the estimate.");
    if (!o && t.parentId && NEW_ID.test(t.parentId)) return fail(400, "invalid", "Line items belong to an estimate section.");
  }
  for (const o of cur.tasks) if (!ids.has(o.id) && o.kind === "section" && !o.splitFrom) return fail(400, "cannot_delete_section", "Sections from the estimate can't be deleted.");

  const changed = tasks.filter((t) => { const o = before.get(t.id); return !o || FIELDS.some((k) => o[k] !== t[k]); });
  const removed = cur.tasks.filter((o) => !ids.has(o.id)).map((o) => o.id);
  const depKey = (d: { from: string; to: string; lagDays: number; maxOverlap: number }) => `${d.from}>${d.to}:${d.lagDays}:${d.maxOverlap}`;
  const depsChanged = cur.deps.map(depKey).sort().join("|") !== b.deps.map(depKey).sort().join("|");
  const meta = b.schedule && Object.keys(b.schedule).length ? b.schedule : null;
  if (!changed.length && !removed.length && !depsChanged && !meta) return json({ revision: cur.schedule.revision, unchanged: true });

  // Phase 9: dates/structure, progress and dependencies each need their own permission.
  const need = changeKinds(cur.tasks, changed, removed.length > 0, depsChanged, meta);
  const perm = cur.permissions;
  if (need.edit && !perm.edit) return fail(403, "forbidden_edit", perm.progress ? "Your company role can update progress here but can't change dates or tasks." : "You can view this schedule but can't edit it.");
  if (need.progress && !perm.progress) return fail(403, "forbidden_progress", "Your company role can't update progress on this schedule.");
  if (need.dependencies && !perm.dependencies) return fail(403, "forbidden_dependencies", "Your company role can't change task dependencies.");

  // V4.3: changing dates on the live (active) schedule needs an explicit confirmation from the editor
  // (and the database separately requires "Edit live schedules" on company projects).
  const live = cur.schedule.status === "active";
  const moved = live ? liveDateChanges(cur.tasks, tasks, cur.deps) : [];
  if (moved.length && !b.confirmLive) return fail(409, "confirm_required", "This is a live schedule. Confirm the date change to save it.", { changes: moved.slice(0, 50) });

  const patch: Record<string, unknown> = {
    summary: b.summary,
    changes: diffTasks(cur.tasks, tasks).slice(0, 500),
    tasks: changed.map((t) => (NEW_ID.test(t.id) ? { ...t, id: undefined, key: t.id } : t)),
    delete: removed,
  };
  if (depsChanged) patch.deps = b.deps;
  if (meta) patch.schedule = { ...meta, ...(meta.calendar ? { calendar: cal } : {}) };

  const { data, error } = await supabase.rpc("schedule_save", { p_schedule_id: id, p_base_revision: b.baseRevision, p: patch });
  if (error) {
    const m = scheduleDbError(error);
    if (m.status === 500) logError("schedule.save", error);
    return fail(m.status, m.code, m.message);
  }
  const fresh = await loadSchedule(supabase, id);
  return json({ revision: data as number, schedule: fresh });
}
