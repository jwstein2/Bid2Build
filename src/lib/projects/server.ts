import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, todayIn } from "@/lib/schedule/calendar";
import { mapWorkspace, type AssignmentStatus, type Workspace } from "./workspace";
import { mapTeam, type Team } from "./team";

/** Default window: five weeks back, four months ahead. Older/later dates load on demand. */
export function defaultWindow(tz = "America/Chicago"): { from: string; to: string } {
  const today = todayIn(tz);
  return { from: addDays(today, -35), to: addDays(today, 120) };
}

/** Authorized projects + tasks in a window, or null before the V4.1 SQL runs (callers fall back). */
export async function loadWorkspace(supabase: SupabaseClient, from: string, to: string): Promise<Workspace | null> {
  const [{ data, error }, asg] = await Promise.all([
    supabase.rpc("pm_workspace", { p_from: from, p_to: to }),
    supabase.rpc("pm_task_assignments", { p_from: from, p_to: to }),
  ]);
  if (error || !data) return null;
  const ws = mapWorkspace(data as Record<string, unknown>);
  // V4.2 directory assignments (absent until that SQL runs: tasks then use the free-text assignee).
  if (!asg.error && Array.isArray(asg.data)) {
    const byId = new Map((asg.data as { id: string; resourceId: string | null; status: string | null }[]).map((a) => [a.id, a]));
    for (const t of ws.tasks) {
      const a = byId.get(t.id);
      if (a) { t.resourceId = a.resourceId; t.assignmentStatus = (a.status as AssignmentStatus | null) ?? null; }
    }
  }
  return ws;
}

/** The caller's Team & Subcontractors directory, or null before the V4.2 SQL runs. */
export async function loadTeam(supabase: SupabaseClient): Promise<Team | null> {
  const { data, error } = await supabase.rpc("pm_team");
  if (error || !data) return null;
  return mapTeam(data);
}

/** Maps directory / assignment RPC errors to API errors. */
export function teamDbError(e: { message?: string } | null): { status: number; code: string; message: string } {
  const m = e?.message ?? "";
  if (m.includes("name_required")) return { status: 400, code: "name_required", message: "Add a name." };
  if (m.includes("not_member")) return { status: 400, code: "not_member", message: "Staff can only be linked to an active member of your company." };
  if (m.includes("bad_member")) return { status: 400, code: "bad_member", message: "A crew can only include active staff and subcontractors from your list." };
  if (m.includes("bad_resource")) return { status: 400, code: "bad_resource", message: "Pick someone from your Team & Subcontractors list." };
  if (m.includes("stale_revision")) return { status: 409, code: "stale_revision", message: "Someone else changed this schedule. Reload to see the latest version." };
  if (m.includes("not_found")) return { status: 404, code: "not_found", message: "That entry no longer exists." };
  if (m.includes("forbidden")) return { status: 403, code: "forbidden", message: "You can view this but can't change it." };
  if (m.includes("bad_")) return { status: 400, code: "invalid", message: "Check the details and try again." };
  return { status: 500, code: "server_error", message: "We couldn't save that. Please try again." };
}

export interface ActivityItem { kind: string; audience: "internal" | "customer"; summary: string; actor: string | null; at: string }
export async function loadActivity(supabase: SupabaseClient, scheduleId: string): Promise<ActivityItem[] | null> {
  const { data, error } = await supabase.rpc("project_activity_feed", { p_schedule_id: scheduleId });
  if (error) return null;
  return ((data as ActivityItem[]) ?? []).slice(0, 200);
}

/** Maps workspace RPC errors to API errors. */
export function workspaceDbError(e: { message?: string; details?: string } | null): { status: number; code: string; message: string } {
  const m = e?.message ?? "";
  if (m.includes("not_member")) return { status: 400, code: "not_member", message: "Pick someone from your company." };
  if (m.includes("incomplete_tasks")) return { status: 409, code: "incomplete_tasks", message: `${e?.details ?? "Some"} task(s) aren't marked complete. Finish them, or close out anyway with a reason.` };
  if (m.includes("stale_revision")) return { status: 409, code: "stale_revision", message: "Someone else changed this schedule. Reload to see the latest version." };
  if (m.includes("already_completed")) return { status: 409, code: "already_completed", message: "This project is already complete." };
  if (m.includes("not_completed")) return { status: 409, code: "not_completed", message: "This project isn't complete." };
  if (m.includes("bad_finish")) return { status: 400, code: "bad_finish", message: "The completion date can't be before the project start." };
  if (m.includes("bad_window")) return { status: 400, code: "bad_window", message: "Pick a shorter date range." };
  if (m.includes("forbidden")) return { status: 403, code: "forbidden", message: "You can view this project but can't change it." };
  return { status: 500, code: "server_error", message: "We couldn't save that. Please try again." };
}
