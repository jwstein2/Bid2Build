import { z } from "zod";
import { fail, json } from "@/lib/http/api";
import { dbFail, guardRead, guardWrite } from "@/lib/team/route-helpers";
import { mapEntry, mapTimesheet } from "@/lib/team/records";

export const runtime = "nodejs";

const coord = z.number().finite();
const loc = { lat: coord.min(-90).max(90).optional(), lng: coord.min(-180).max(180).optional(), accuracyM: z.number().finite().min(0).max(100000).optional() };
const iso = z.string().datetime({ offset: true });
const ops = z.discriminatedUnion("action", [
  z.object({ action: z.literal("clock_in"), resourceId: z.string().uuid(), scheduleId: z.string().uuid().nullish(), note: z.string().trim().max(500).nullish(), ...loc }),
  z.object({ action: z.literal("clock_out"), entryId: z.string().uuid(), scheduleId: z.string().uuid().nullish(), breakMinutes: z.number().int().min(0).max(720).optional(), note: z.string().trim().max(500).nullish(), ...loc }),
  z.object({ action: z.literal("save"), id: z.string().uuid().optional(), resourceId: z.string().uuid().optional(), scheduleId: z.string().uuid().nullish(),
    clockIn: iso, clockOut: iso, breakMinutes: z.number().int().min(0).max(720).default(0), note: z.string().trim().max(500).nullish(), reason: z.string().trim().max(300).nullish() }),
  z.object({ action: z.literal("decide"), ids: z.array(z.string().uuid()).min(1).max(500), decision: z.enum(["approve", "reject", "reopen"]), note: z.string().trim().max(300).nullish() }),
]);

/** Time entries between ?from and ?to (ISO). Managers get everyone's; staff get their own. */
export async function GET(req: Request) {
  const g = await guardRead();
  if (!g.ok) return g.res;
  const u = new URL(req.url);
  const from = u.searchParams.get("from"), to = u.searchParams.get("to");
  if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)) || Date.parse(to) - Date.parse(from) > 400 * 864e5) {
    return fail(400, "invalid", "Pick a date range of up to about a year.");
  }
  const { data, error } = await g.supabase.rpc("pm_timesheet", { p_from: from, p_to: to });
  if (error) return dbFail("time.list", error);
  return json(mapTimesheet(data));
}

/**
 * Clock in / clock out (own punch, or a manager for crew without a login), manager add/fix with a reason,
 * and approve / send back / reopen. Location is sent only when the person ticked "Include my location".
 */
export async function POST(req: Request) {
  const g = await guardWrite("time-clock", 240);
  if (!g.ok) return g.res;
  const p = ops.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Check the details and try again.");
  const o = p.data;
  const hasLoc = o.action !== "save" && o.action !== "decide" && o.lat !== undefined && o.lng !== undefined;
  if (o.action === "clock_in" || o.action === "clock_out") {
    const payload = o.action === "clock_in"
      ? { resourceId: o.resourceId, scheduleId: o.scheduleId ?? null, note: o.note ?? null }
      : { entryId: o.entryId, ...(o.scheduleId !== undefined ? { scheduleId: o.scheduleId } : {}), breakMinutes: o.breakMinutes, note: o.note ?? null };
    const withLoc = hasLoc ? { ...payload, lat: o.lat, lng: o.lng, accuracyM: o.accuracyM ?? null } : payload;
    const { data, error } = await g.supabase.rpc(o.action === "clock_in" ? "pm_clock_in" : "pm_clock_out", { p: withLoc });
    if (error) return dbFail(`time.${o.action}`, error);
    return json(mapEntry(data as Record<string, unknown>));
  }
  if (o.action === "save") {
    if (!o.id && !o.resourceId) return fail(400, "invalid", "Pick who this time is for.");
    const { action: _a, ...rest } = o;
    void _a;
    const { data, error } = await g.supabase.rpc("pm_time_entry_save", { p: rest });
    if (error) return dbFail("time.save", error);
    return json(mapEntry(data as Record<string, unknown>));
  }
  const { data, error } = await g.supabase.rpc("pm_time_entries_decide", { p_ids: o.ids, p_action: o.decision, p_note: o.note ?? null });
  if (error) return dbFail("time.decide", error);
  return json({ changed: data as number });
}
