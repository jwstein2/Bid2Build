import { z } from "zod";
import { fail, json } from "@/lib/http/api";
import { mapEntry } from "@/lib/team/records";
import { dbFail, guardRead, guardWrite } from "@/lib/team/route-helpers";
import { mapCorrections, mapMyStatus } from "@/lib/workforce/gps/model";

export const runtime = "nodejs";

/** The employee's own clock: GPS status, assigned sites (only when they accepted the disclosure), corrections. */
export async function GET() {
  const g = await guardRead();
  if (!g.ok) return g.res;
  const [st, corr] = await Promise.all([g.supabase.rpc("pm_gps_my_status"), g.supabase.rpc("pm_time_corrections_list", { p_status: "all" })]);
  if (st.error) return dbFail("gps.me", st.error);
  return json({ status: mapMyStatus(st.data), corrections: corr.error ? [] : mapCorrections(corr.data).filter((c) => c.status === "pending" || Date.now() - Date.parse(c.requestedAt) < 30 * 864e5) });
}

const iso = z.string().datetime({ offset: true });
const category = z.enum(["project", "shop", "office", "training", "admin", "travel", "other_paid", "unpaid"]);
const issue = z.enum(["gps_unavailable", "forgot_phone", "missed_event", "wrong_location", "dispute_auto", "other"]);
const ops = z.discriminatedUnion("action", [
  // Same contract for the browser clock today and a native app later.
  z.object({ action: z.literal("event"), resourceId: z.string().uuid(), locationId: z.string().uuid(), kind: z.enum(["enter", "dwell", "exit", "exit_confirmed"]),
    occurredAt: iso.optional(), accuracyM: z.number().min(0).max(100000), distanceM: z.number().min(0).max(40_000_000),
    source: z.enum(["browser", "pwa", "native_ios", "native_android"]).default("browser"), clientEventId: z.string().max(80).optional(), confirmed: z.boolean().optional() }),
  z.object({ action: z.literal("consent"), resourceId: z.string().uuid(), agree: z.boolean(), version: z.number().int().min(1).max(1000) }),
  z.object({ action: z.literal("device"), resourceId: z.string().uuid(), permission: z.enum(["unknown", "granted", "prompt", "denied", "unavailable"]),
    appMode: z.enum(["browser", "pwa", "native_ios", "native_android"]).optional(), device: z.string().max(60).optional() }),
  z.object({ action: z.literal("resolve"), entryId: z.string().uuid(), answer: z.enum(["working", "clock_out"]), note: z.string().trim().max(200).nullish() }),
  z.object({ action: z.literal("clock_in"), resourceId: z.string().uuid(), locationId: z.string().uuid().nullish(), scheduleId: z.string().uuid().nullish(),
    workType: z.enum(["regular", "travel", "offsite"]).optional(), workCategory: category.optional(), note: z.string().trim().max(500).nullish() }),
  z.object({ action: z.literal("clock_out"), entryId: z.string().uuid(), breakMinutes: z.number().int().min(0).max(720).optional(), paidBreakMinutes: z.number().int().min(0).max(720).optional(),
    note: z.string().trim().max(500).nullish() }),
  z.object({ action: z.literal("correction"), resourceId: z.string().uuid(), entryId: z.string().uuid().nullish(), clockIn: iso, clockOut: iso,
    breakMinutes: z.number().int().min(0).max(720).optional(), paidBreakMinutes: z.number().int().min(0).max(720).optional(), scheduleId: z.string().uuid().nullish(),
    locationId: z.string().uuid().nullish(), workType: z.enum(["regular", "travel", "offsite"]).optional(), workCategory: category.optional(), issue: issue.optional(),
    reason: z.string().trim().min(1).max(500) }),
  z.object({ action: z.literal("withdraw"), id: z.string().uuid() }),
  z.object({ action: z.literal("signoff"), resourceId: z.string().uuid(), week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
]);

export async function POST(req: Request) {
  // Events arrive about once a minute at most while the clock is open; allow headroom for retries.
  const g = await guardWrite("gps-me", 600);
  if (!g.ok) return g.res;
  const p = ops.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Check the details and try again.");
  const o = p.data;
  const rpc = (fn: string, args: Record<string, unknown>) => g.supabase.rpc(fn, args);
  let r;
  switch (o.action) {
    case "event": { const { action: _a, ...rest } = o; void _a; r = await rpc("pm_gps_event", { p: rest }); break; }
    case "consent": r = await rpc("pm_gps_consent", { p_resource_id: o.resourceId, p_agree: o.agree, p_version: o.version }); break;
    case "device": r = await rpc("pm_gps_device_status", { p_resource_id: o.resourceId, p: { permission: o.permission, appMode: o.appMode, device: o.device } }); break;
    case "resolve": r = await rpc("pm_gps_away_resolve", { p_entry_id: o.entryId, p_action: o.answer, p_note: o.note ?? null }); break;
    case "clock_in": { const { action: _a, ...rest } = o; void _a; r = await rpc("pm_clock_in", { p: rest }); break; }
    case "clock_out": { const { action: _a, ...rest } = o; void _a; r = await rpc("pm_clock_out", { p: rest }); break; }
    case "correction": { const { action: _a, ...rest } = o; void _a; r = await rpc("pm_time_correction_request", { p: rest }); break; }
    case "withdraw": r = await rpc("pm_time_correction_withdraw", { p_id: o.id }); break;
    case "signoff": r = await rpc("pm_timesheet_signoff", { p_resource_id: o.resourceId, p_week: o.week }); break;
  }
  if (r.error) return dbFail(`gps.me.${o.action}`, r.error);
  const d = r.data as Record<string, unknown> | null;
  if ((o.action === "resolve" || o.action === "clock_in" || o.action === "clock_out") && d) return json({ ok: true, entry: mapEntry(d) });
  if (o.action === "event" && d) return json({ ok: true, ...d, entry: d.entry ? mapEntry(d.entry as Record<string, unknown>) : null });
  return json({ ok: true, data: d });
}
