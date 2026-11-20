import { z } from "zod";
import { fail, json } from "@/lib/http/api";
import { dbFail, guardRead, guardWrite } from "@/lib/team/route-helpers";
import { mapAdmin, mapCorrections, mapEvents, mapExceptions } from "@/lib/workforce/gps/model";

export const runtime = "nodejs";

/**
 * V8.2 customer GPS timekeeping, admin side (company owner / Time admins; supervisors read). Customer-facing only.
 * GET: overview (settings, locations, employees), exceptions and pending corrections. ?events=<resourceId> returns
 * one person's geofence events (distance + accuracy only).
 */
export async function GET(req: Request) {
  const g = await guardRead();
  if (!g.ok) return g.res;
  const events = new URL(req.url).searchParams.get("events");
  if (events) {
    if (!/^[0-9a-f-]{36}$/i.test(events)) return fail(400, "invalid", "Pick an employee.");
    const { data, error } = await g.supabase.rpc("pm_gps_events_list", { p_resource_id: events, p_days: 14 });
    if (error) return dbFail("gps.events", error);
    return json({ events: mapEvents(data) });
  }
  const { data, error } = await g.supabase.rpc("pm_gps_admin_overview");
  if (error) return dbFail("gps.overview", error);
  const admin = mapAdmin(data);
  const [ex, corr] = await Promise.all([
    admin.canSupervise ? g.supabase.rpc("pm_gps_exceptions") : Promise.resolve({ data: null, error: null }),
    g.supabase.rpc("pm_time_corrections_list", { p_status: "pending" }),
  ]);
  return json({ admin, exceptions: ex.data ? mapExceptions(ex.data) : null, corrections: corr.error ? [] : mapCorrections(corr.data) });
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const ops = z.discriminatedUnion("action", [
  z.object({ action: z.literal("settings"), enabled: z.boolean().optional(), disclosureAck: z.boolean().optional(), disclosureExtra: z.string().max(2000).nullish(),
    defaultRadiusM: z.number().int().min(30).max(322).optional(), entryDwellMin: z.number().int().min(1).max(30).optional(), exitGraceMin: z.number().int().min(2).max(60).optional(),
    entryAction: z.enum(["auto", "ask"]).optional(), exitAction: z.enum(["ask", "auto"]).optional(), startRule: z.enum(["schedule", "any_time"]).optional(),
    workDays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(), workStart: hhmm.optional(), workEnd: hhmm.optional(), earlyMin: z.number().int().min(0).max(180).optional(),
    travelWindowMin: z.number().int().min(10).max(240).optional(), maxAccuracyM: z.number().int().min(20).max(500).optional(),
    overtimeRule: z.enum(["federal", "california", "colorado", "alaska", "nevada", "none"]).optional(), timezone: z.string().max(64).optional(), retentionDays: z.number().int().min(30).max(365).optional() }),
  z.object({ action: z.literal("location"), id: z.string().uuid().optional(), kind: z.enum(["business", "project", "other"]).optional(), name: z.string().trim().min(1).max(200),
    address: z.string().trim().max(500).nullish(), scheduleId: z.string().uuid().nullish(), lat: z.number().min(-90).max(90).nullish(), lng: z.number().min(-180).max(180).nullish(),
    radiusM: z.number().int().min(30).max(322), pinSource: z.enum(["device", "census", "manual"]).nullish(), pinAccuracyM: z.number().min(0).max(100000).nullish(),
    everyone: z.boolean().optional(), confirm: z.boolean().optional() }),
  z.object({ action: z.literal("location_status"), id: z.string().uuid(), status: z.enum(["active", "archived"]) }),
  z.object({ action: z.literal("assign"), id: z.string().uuid(), resourceIds: z.array(z.string().uuid()).max(500), everyone: z.boolean().optional() }),
  z.object({ action: z.literal("enroll"), resourceId: z.string().uuid(), enrolled: z.boolean().optional(), w2Confirmed: z.boolean().optional() }),
  z.object({ action: z.literal("supervisor"), userId: z.string().uuid(), role: z.enum(["admin", "supervisor"]).nullable() }),
  z.object({ action: z.literal("decide_correction"), id: z.string().uuid(), approve: z.boolean(), note: z.string().trim().max(300).nullish() }),
]);

export async function POST(req: Request) {
  const g = await guardWrite("gps-admin", 240);
  if (!g.ok) return g.res;
  const p = ops.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Check the details and try again.");
  const o = p.data;
  const call = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await g.supabase.rpc(fn, args);
    return error ? dbFail(`gps.${o.action}`, error) : json({ ok: true, data });
  };
  switch (o.action) {
    case "settings": { const { action: _a, ...rest } = o; void _a; return call("pm_gps_settings_save", { p: rest }); }
    case "location": { const { action: _a, ...rest } = o; void _a; return call("pm_work_location_save", { p: rest }); }
    case "location_status": return call("pm_work_location_set_status", { p_id: o.id, p_status: o.status });
    case "assign": return call("pm_work_location_assign", { p_id: o.id, p_resource_ids: o.resourceIds, p_everyone: o.everyone ?? null });
    case "enroll": return call("pm_gps_enrollment_save", { p_resource_id: o.resourceId, p: { enrolled: o.enrolled, w2Confirmed: o.w2Confirmed } });
    case "supervisor": return call("pm_time_supervisor_set", { p_user: o.userId, p_role: o.role });
    case "decide_correction": return call("pm_time_correction_decide", { p_id: o.id, p_approve: o.approve, p_note: o.note ?? null });
  }
}
