import { z } from "zod";
import { fail, json } from "@/lib/http/api";
import { dbFail, guardRead, guardWrite, UUID_RE } from "@/lib/team/route-helpers";
import { mapScheduleItem } from "@/lib/workforce/hub/model";

export const runtime = "nodejs";
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^\d{2}:\d{2}$/);

/** A worker's schedule for a date range (internal shifts + project assignments + time off). */
export async function GET(req: Request) {
  const g = await guardRead();
  if (!g.ok) return g.res;
  const u = new URL(req.url);
  const id = u.searchParams.get("resourceId") ?? "", from = u.searchParams.get("from") ?? "", to = u.searchParams.get("to") ?? "";
  if (!UUID_RE.test(id) || !day.safeParse(from).success || !day.safeParse(to).success) return fail(400, "invalid", "Pick a person and dates.");
  const { data, error } = await g.supabase.rpc("pm_worker_schedule", { p_resource: id, p_from: from, p_to: to });
  if (error) return dbFail("hub.schedule", error);
  return json({ items: (Array.isArray(data) ? data : []).map((x) => mapScheduleItem(x as Record<string, unknown>)) });
}

const ops = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), id: z.string().uuid().optional(), resourceId: z.string().uuid().optional(), date: day.optional(), dates: z.array(day).max(62).optional(),
    startTime: time, endTime: time, unpaidBreakMinutes: z.number().int().min(0).max(240).optional(),
    category: z.enum(["project", "shop", "office", "training", "admin", "travel", "other_paid"]), scheduleId: z.string().uuid().nullish(), locationId: z.string().uuid().nullish(),
    notes: z.string().trim().max(1000).nullish() }),
  z.object({ action: z.literal("cancel"), id: z.string().uuid() }),
]);

export async function POST(req: Request) {
  const g = await guardWrite("hub-shifts", 300);
  if (!g.ok) return g.res;
  const p = ops.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Check the shift details and try again.");
  const o = p.data;
  if (o.action === "cancel") {
    const { error } = await g.supabase.rpc("pm_work_shift_cancel", { p_id: o.id });
    if (error) return dbFail("hub.shift.cancel", error);
    return json({ ok: true });
  }
  const { action: _a, ...rest } = o; void _a;
  const { data, error } = await g.supabase.rpc("pm_work_shift_save", { p: rest });
  if (error) return dbFail("hub.shift.save", error);
  return json({ ok: true, shifts: data });
}
