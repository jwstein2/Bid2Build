import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { TimeEntry } from "@/lib/team/records";
import { isWorkCategory, localDay } from "@/lib/team/records";
import { entriesToHours, mapPayInputs, payPeriod, projectPay, type PayProjection } from "./pay";
import { mapScheduleItem } from "./model";

type Supa = Awaited<ReturnType<typeof createClient>>;
export type PayResult = { available: false } | { available: true; audience: "admin" | "worker"; projection: PayProjection };

/**
 * Projected pay for one worker. The database decides who may see it (pm_pay_inputs returns no amounts otherwise);
 * the math happens here on the server, so a hidden worker never receives a rate or an amount.
 */
export async function loadPayProjection(supabase: Supa, resourceId: string, day?: string): Promise<{ ok: true; data: PayResult } | { ok: false; error: { message?: string; code?: string } }> {
  const inp = await supabase.rpc("pm_pay_inputs", { p_resource_id: resourceId });
  if (inp.error) return { ok: false, error: inp.error };
  const inputs = mapPayInputs(inp.data);
  if (!inputs) return { ok: true, data: { available: false } };
  const today = day ?? localDay(new Date().toISOString(), inputs.timezone);
  const period = payPeriod(today, inputs.settings);
  const fromTs = new Date(`${period.from}T00:00:00Z`); fromTs.setUTCDate(fromTs.getUTCDate() - 1);
  const toTs = new Date(`${period.to}T00:00:00Z`); toTs.setUTCDate(toTs.getUTCDate() + 2);
  const [sch, ent] = await Promise.all([
    supabase.rpc("pm_worker_schedule", { p_resource: resourceId, p_from: period.from, p_to: period.to }),
    supabase.from("pm_time_entries").select("id, resource_id, schedule_id, clock_in, clock_out, break_minutes, status, work_category")
      .eq("resource_id", resourceId).neq("status", "rejected").gte("clock_in", fromTs.toISOString()).lt("clock_in", toTs.toISOString()).limit(500),
  ]);
  if (sch.error) return { ok: false, error: sch.error };
  if (ent.error) return { ok: false, error: ent.error };
  const schedule = (Array.isArray(sch.data) ? sch.data : []).map((x) => mapScheduleItem(x as Record<string, unknown>)).map((s) => ({ date: s.date, hours: s.hours, category: s.category }));
  const entries = ((ent.data ?? []) as Record<string, unknown>[]).map((e) => ({
    id: String(e.id), resourceId: String(e.resource_id), scheduleId: (e.schedule_id as string | null) ?? null, clockIn: String(e.clock_in), clockOut: (e.clock_out as string | null) ?? null,
    breakMinutes: Number(e.break_minutes ?? 0), status: e.status, workCategory: isWorkCategory(e.work_category) ? e.work_category : undefined,
  })) as unknown as TimeEntry[];
  const projection = projectPay(inputs, schedule, entriesToHours(entries, inputs.timezone, period.from, period.to), today);
  return { ok: true, data: { available: true, audience: inputs.audience, projection } };
}
