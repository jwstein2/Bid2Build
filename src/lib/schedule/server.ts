import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeCalendar } from "./calendar";
import type { Dep, Revision, ScheduleData, SchedulePermissions, Snapshot, Task, TaskChange } from "./types";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));

export function mapTask(r: Row): Task {
  return {
    id: String(r.id), parentId: s(r.parent_id), kind: r.kind === "item" ? "item" : "section", sourceGroupId: String(r.source_group_id),
    sourceItemId: s(r.source_item_id), splitFrom: s(r.split_from), name: String(r.name ?? ""), sortOrder: Number(r.sort_order ?? 0),
    plannedStart: String(r.planned_start), plannedEnd: String(r.planned_end), durationDays: Number(r.duration_days ?? 1),
    actualStart: s(r.actual_start), actualFinish: s(r.actual_finish), percentComplete: Number(r.percent_complete ?? 0),
    status: (r.status as Task["status"]) ?? "not_started", weight: r.weight === null || r.weight === undefined ? null : Number(r.weight),
    assignee: s(r.assignee), notes: s(r.notes),
  };
}

const mapDep = (r: Row): Dep => ({ from: String(r.predecessor_id), to: String(r.successor_id), lagDays: Number(r.lag_days ?? 0), maxOverlap: Number(r.max_overlap ?? 0) });

export function mapSchedule(raw: Row): ScheduleData {
  const sc = raw.schedule as Row;
  return {
    schedule: {
      id: String(sc.id), estimateId: String(sc.estimate_id), companyId: s(sc.company_id), name: String(sc.name), status: sc.status as ScheduleData["schedule"]["status"],
      provisional: Boolean(sc.provisional), calendar: normalizeCalendar(sc.calendar as never), startDate: String(sc.start_date),
      targetEndDate: s(sc.target_end_date), progressMethod: sc.progress_method === "weight" ? "weight" : "duration", revision: Number(sc.revision),
      updatedAt: String(sc.updated_at),
    },
    snapshot: raw.snapshot as Snapshot,
    tasks: ((raw.tasks as Row[]) ?? []).map(mapTask),
    deps: ((raw.deps as Row[]) ?? []).map(mapDep),
    revisions: ((raw.revisions as Row[]) ?? []).map((r): Revision => ({
      revision: Number(r.revision), summary: String(r.summary), createdAt: String(r.created_at), actorId: s(r.actor_id), changes: (r.changes as TaskChange[]) ?? [],
    })),
    canEdit: Boolean(raw.canEdit),
    permissions: mapPermissions(raw.permissions, Boolean(raw.canEdit)),
  };
}

/** Before the Phase 9 SQL runs, schedule_get has no permissions: everything follows canEdit. */
export function mapPermissions(raw: unknown, canEdit: boolean): SchedulePermissions {
  const r = (raw && typeof raw === "object" ? raw : null) as Record<string, unknown> | null;
  if (!r) return { edit: canEdit, progress: canEdit, dependencies: canEdit, publish: canEdit, pdf: true };
  return { edit: r.edit === true, progress: r.progress === true, dependencies: r.dependencies === true, publish: r.publish === true, pdf: r.pdf === true };
}

/** The schedule if the caller can read it (RLS), else null. Also null before the migration runs. */
export async function loadSchedule(supabase: SupabaseClient, id: string): Promise<ScheduleData | null> {
  const { data, error } = await supabase.rpc("schedule_get", { p_schedule_id: id });
  if (error || !data) return null;
  return mapSchedule(data as Row);
}

export interface ScheduleListRow {
  id: string; estimate_id: string; name: string; status: string; provisional: boolean; company_id: string | null;
  start_date: string; target_end_date: string | null; finish_date: string | null; progress: number; customer_name: string | null; updated_at: string;
}

export async function listSchedules(supabase: SupabaseClient): Promise<ScheduleListRow[] | null> {
  const { data, error } = await supabase.rpc("schedule_list");
  if (error) return null;
  return (data as ScheduleListRow[]) ?? [];
}

const WON = ["won", "scheduled", "in_progress", "completed"];

/** Accepted bids (Won or a job stage, or signed by the customer) that don't have a schedule yet. */
export async function readyToSchedule(supabase: SupabaseClient, scheduled: Set<string>) {
  const [{ data: won }, { data: signed }] = await Promise.all([
    supabase.from("estimates").select("id, title, customer_name, estimate_number, pipeline_stage, updated_at").in("pipeline_stage", WON).order("updated_at", { ascending: false }).limit(100),
    supabase.from("signatures").select("estimate_id").limit(500),
  ]);
  const signedIds = new Set(((signed ?? []) as { estimate_id: string }[]).map((r) => r.estimate_id));
  const rows = ((won ?? []) as { id: string; title: string; customer_name: string; estimate_number: string; pipeline_stage: string }[]);
  const extra = [...signedIds].filter((id) => !rows.some((r) => r.id === id));
  if (extra.length) {
    const { data } = await supabase.from("estimates").select("id, title, customer_name, estimate_number, pipeline_stage, updated_at").in("id", extra.slice(0, 100));
    rows.push(...((data ?? []) as typeof rows));
  }
  return rows.filter((r) => !scheduled.has(r.id)).map((r) => ({ ...r, signed: signedIds.has(r.id) }));
}

/** Is the estimate accepted (Won/job stage or signed)? Mirrors estimate_is_accepted() in SQL. */
export async function estimateAccepted(supabase: SupabaseClient, estimateId: string, stage: string | null): Promise<{ accepted: boolean; signed: boolean }> {
  const { data } = await supabase.from("signatures").select("id").eq("estimate_id", estimateId).limit(1);
  const signed = Boolean(data?.length);
  return { accepted: signed || WON.includes(stage ?? ""), signed };
}

/** Maps database errors from schedule_create / schedule_save to API errors. */
export function scheduleDbError(e: { message?: string; code?: string; details?: string } | null): { status: number; code: string; message: string; existingId?: string; revision?: number } {
  const m = e?.message ?? "";
  if (m.includes("schedule_exists")) return { status: 409, code: "schedule_exists", message: "This bid already has a schedule.", existingId: e?.details };
  if (m.includes("not_accepted")) return { status: 409, code: "not_accepted", message: "This bid hasn't been accepted yet. Schedule it as provisional, or mark it Won first." };
  if (m.includes("stale_revision")) return { status: 409, code: "stale_revision", message: "Someone else changed this schedule. Reload to see the latest version.", revision: Number(e?.details) || undefined };
  if (m.includes("forbidden_live_edit")) return { status: 403, code: "forbidden_live_edit", message: "Your company role can't change dates on a live schedule." };
  if (m.includes("forbidden_confirm")) return { status: 403, code: "forbidden_confirm", message: "Your company role can't confirm task completion." };
  if (m.includes("forbidden_progress")) return { status: 403, code: "forbidden_progress", message: "Your company role can't update progress on this schedule." };
  if (m.includes("forbidden_dependencies")) return { status: 403, code: "forbidden_dependencies", message: "Your company role can't change task dependencies." };
  if (m.includes("forbidden_edit")) return { status: 403, code: "forbidden_edit", message: "Your company role can update progress here but can't change dates or tasks." };
  if (m.includes("forbidden")) return { status: 403, code: "forbidden", message: "You can view this schedule but can't edit it." };
  if (m.includes("cannot_delete_section")) return { status: 400, code: "cannot_delete_section", message: "Sections from the estimate can't be deleted." };
  if (/unknown_source|bad_parent|unknown_task|no_tasks/.test(m) || e?.code === "23514" || e?.code === "22023") return { status: 400, code: "invalid", message: "That change isn't valid. Reload and try again." };
  return { status: 500, code: "server_error", message: "We couldn't save the schedule. Please try again." };
}
