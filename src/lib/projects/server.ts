import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, todayIn } from "@/lib/schedule/calendar";
import { mapWorkspace, type Workspace } from "./workspace";

/** Default window: five weeks back, four months ahead. Older/later dates load on demand. */
export function defaultWindow(tz = "America/Chicago"): { from: string; to: string } {
  const today = todayIn(tz);
  return { from: addDays(today, -35), to: addDays(today, 120) };
}

/** Authorized projects + tasks in a window, or null before the V4.1 SQL runs (callers fall back). */
export async function loadWorkspace(supabase: SupabaseClient, from: string, to: string): Promise<Workspace | null> {
  const { data, error } = await supabase.rpc("pm_workspace", { p_from: from, p_to: to });
  if (error || !data) return null;
  return mapWorkspace(data as Record<string, unknown>);
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
