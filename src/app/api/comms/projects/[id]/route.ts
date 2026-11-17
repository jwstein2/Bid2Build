import { z } from "zod";
import { fail, json, sameOrigin } from "@/lib/http/api";
import { renderUpdate } from "@/lib/comms/runner";
import { loadSettings, logEvent, requireComm } from "@/lib/comms/server";
import { upcomingWeekly, wantsWeekly } from "@/lib/comms/project-updates";
import { normalizeEmail } from "@/lib/comms/types";

export const runtime = "nodejs";

type Row = Record<string, unknown>;

async function state(g: Extract<Awaited<ReturnType<typeof requireComm>>, { ok: true }>, id: string) {
  const [{ data: pc }, settings, { data: msgs }] = await Promise.all([
    g.admin.from("project_comm_settings").select("*").eq("schedule_id", id).maybeSingle(),
    loadSettings(g.admin, g.access.accountId),
    g.admin.from("comm_messages").select("id, trigger, status, status_reason, scheduled_for, sent_at, subject, approved_at").eq("schedule_id", id).order("created_at", { ascending: false }).limit(20),
  ]);
  const p = pc as Row | null;
  const frequency = (p?.frequency as string) ?? "off";
  const next = (msgs ?? []).find((m) => ["awaiting_review", "scheduled", "approved"].includes(String(m.status)));
  const last = (msgs ?? []).find((m) => m.sent_at);
  const weeklyAt = wantsWeekly(frequency as never) && !p?.paused_at ? upcomingWeekly(new Date(), settings.timezone, settings.updatesWeekday, settings.updatesHour).slot.toISOString() : null;
  return { settings: p ? { frequency, mode: p.mode, recipientEmail: p.recipient_email, recipientName: p.recipient_name, pausedAt: p.paused_at, autoConfirmedAt: p.auto_confirmed_at } : null,
    defaults: { frequency: settings.updatesFrequency, mode: settings.updatesMode, weekday: settings.updatesWeekday, hour: settings.updatesHour, timezone: settings.timezone },
    next: next ?? null, nextWeeklyAt: weeklyAt, last: last ?? null, history: msgs ?? [] };
}

/** The project's customer update settings plus a preview of what the customer would get now. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(404, "not_found", "Not found.");
  const g = await requireComm("view_communications");
  if (!g.ok) return g.res;
  // The caller must be able to read the project (RLS).
  const { data: s } = await g.supabase.from("project_schedules").select("id, status").eq("id", id).maybeSingle();
  if (!s) return fail(404, "not_found", "Project not found.");
  const out = await state(g, id);
  const withPreview = new URL(req.url).searchParams.get("preview") === "1";
  const preview = withPreview ? await renderUpdate(g.admin, id, { postalAddress: (await loadSettings(g.admin, g.access.accountId)).postalAddress }) : null;
  return json({ ...out, scheduleStatus: (s as Row).status, preview: preview ? { subject: preview.subject, body: preview.body, recipient: preview.recipient } : null });
}

const Body = z.object({
  frequency: z.enum(["off", "weekly", "milestone", "both"]),
  mode: z.enum(["review", "automatic"]),
  recipientEmail: z.string().max(320).nullable().optional(),
  recipientName: z.string().max(200).nullable().optional(),
  paused: z.boolean().optional(),
  confirmAutomatic: z.boolean().optional(),
}).strict();

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(404, "not_found", "Not found.");
  const g = await requireComm("configure_project_updates");
  if (!g.ok) return g.res;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Those settings aren't valid.");
  const { data: s } = await g.supabase.from("project_schedules").select("id, company_id, user_id").eq("id", id).maybeSingle();
  if (!s) return fail(404, "not_found", "Project not found.");
  const sc = s as Row;
  // The project must belong to this communications account.
  const owns = g.access.kind === "company" ? sc.company_id === g.access.accountId : !sc.company_id && sc.user_id === g.access.accountId;
  if (!owns) return fail(403, "forbidden", "This project belongs to another account.");
  const { data: cur } = await g.admin.from("project_comm_settings").select("*").eq("schedule_id", id).maybeSingle();
  const c = cur as Row | null;
  const now = new Date().toISOString();
  const row: Row = { schedule_id: id, account_id: g.access.accountId, frequency: p.data.frequency, mode: p.data.mode, updated_by: g.userId };
  if (p.data.recipientEmail !== undefined) {
    const e = p.data.recipientEmail ? normalizeEmail(p.data.recipientEmail) : null;
    if (p.data.recipientEmail && !e) return fail(400, "invalid_email", "That customer email doesn't look right.");
    row.recipient_email = e;
  }
  if (p.data.recipientName !== undefined) row.recipient_name = p.data.recipientName?.trim() || null;
  if (p.data.paused !== undefined) row.paused_at = p.data.paused ? now : null;
  if (p.data.frequency !== "off" && (!c || c.frequency === "off")) row.enabled_at = now;
  if (p.data.mode === "automatic" && c?.mode !== "automatic") {
    if (!g.access.perms.includes("enable_auto_project_updates")) return fail(403, "forbidden", "Only someone your company owner allowed can turn on automatic sending.");
    if (!p.data.confirmAutomatic) return fail(400, "confirm_required", "Confirm automatic sending first.");
    row.auto_confirmed_by = g.userId; row.auto_confirmed_at = now;
  }
  const { error } = c ? await g.admin.from("project_comm_settings").update(row).eq("schedule_id", id) : await g.admin.from("project_comm_settings").insert(row);
  if (error) return fail(500, "save_failed", "Could not save.");
  // Switching back to review: anything queued for automatic sending now waits for approval.
  if (p.data.mode === "review") await g.admin.from("comm_messages").update({ status: "awaiting_review", status_reason: "Project switched to review before sending" }).eq("schedule_id", id).eq("status", "scheduled");
  if (p.data.frequency === "off" || p.data.paused) await g.admin.from("comm_messages").update({ status: "canceled", status_reason: p.data.paused ? "Project updates paused" : "Project updates turned off" }).eq("schedule_id", id).in("status", ["awaiting_review", "scheduled", "approved"]);
  await logEvent(g.admin, { accountId: g.access.accountId, kind: "settings", actorId: g.userId, details: { schedule: id, frequency: p.data.frequency, mode: p.data.mode, paused: p.data.paused ?? null } });
  return json(await state(g, id));
}
