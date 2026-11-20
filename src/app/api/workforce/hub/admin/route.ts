import { z } from "zod";
import { fail, json } from "@/lib/http/api";
import { dbFail, guardRead, guardWrite } from "@/lib/team/route-helpers";
import { mapPayWorkers } from "@/lib/workforce/hub/model";
import { loadPayProjection, type PayResult } from "@/lib/workforce/hub/server";

export const runtime = "nodejs";

/** Projected pay admin (HR access only): company settings, each worker's switches, and this period's forecasts. */
export async function GET() {
  const g = await guardRead();
  if (!g.ok) return g.res;
  const { data, error } = await g.supabase.rpc("pm_pay_admin_overview");
  if (error) return dbFail("hub.admin", error);
  const o = (data ?? {}) as Record<string, unknown>;
  const workers = mapPayWorkers(o.workers).slice(0, 60);
  const forecasts: Record<string, PayResult> = {};
  await Promise.all(workers.map(async (w) => { const r = await loadPayProjection(g.supabase, w.id); if (r.ok) forecasts[w.id] = r.data; }));
  return json({ settings: o.settings, gpsOvertimeRule: o.gpsOvertimeRule, workers, forecasts });
}

const cat = z.enum(["project", "shop", "office", "training", "admin", "travel", "other_paid"]);
const ops = z.discriminatedUnion("action", [
  z.object({ action: z.literal("settings"), enabled: z.boolean().optional(), workersCanSee: z.boolean().optional(), displayPeriod: z.enum(["week", "pay_period"]).optional(),
    payFrequency: z.enum(["weekly", "biweekly", "semimonthly", "monthly"]).optional(), periodAnchor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    overtimeRule: z.enum(["federal", "california", "colorado", "alaska", "nevada", "none", ""]).optional(), otMultiplier: z.number().min(1).max(3).optional(),
    dtMultiplier: z.number().min(1).max(4).optional(), differentials: z.partialRecord(z.enum(["project", "shop", "office", "training", "admin", "travel", "other_paid", "night", "weekend"]), z.number().min(0).max(200)).optional() }),
  z.object({ action: z.literal("worker"), resourceId: z.string().uuid(), projectionEnabled: z.boolean().optional(), workerCanSee: z.boolean().nullable().optional(),
    rates: z.partialRecord(cat, z.number().min(0).max(2000)).optional() }),
  z.object({ action: z.literal("classification"), resourceId: z.string().uuid(), classification: z.enum(["w2", "1099", "owner", "other", ""]) }),
]);

export async function POST(req: Request) {
  const g = await guardWrite("hub-admin", 120);
  if (!g.ok) return g.res;
  const p = ops.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Check the details and try again.");
  const o = p.data;
  let r;
  if (o.action === "settings") { const { action: _a, ...rest } = o; void _a; r = await g.supabase.rpc("pm_pay_settings_save", { p: rest }); }
  else if (o.action === "worker") { const { action: _a, resourceId, ...rest } = o; void _a; r = await g.supabase.rpc("pm_worker_pay_prefs_save", { p_resource_id: resourceId, p: rest }); }
  else r = await g.supabase.rpc("pm_worker_classification_set", { p_resource_id: o.resourceId, p_classification: o.classification });
  if (r.error) return dbFail(`hub.admin.${o.action}`, r.error);
  return json({ ok: true, data: r.data });
}
