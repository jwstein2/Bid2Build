import { z } from "zod";
import { fail, json } from "@/lib/http/api";
import { TIME_OFF_KINDS } from "@/lib/team/hr";
import { hrFail } from "@/lib/team/hr-server";
import { guardWrite, UUID_RE } from "@/lib/team/route-helpers";

export const runtime = "nodejs";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const add = z.object({ kind: z.enum(Object.keys(TIME_OFF_KINDS) as [string, ...string[]]), startDate: day, endDate: day.optional(), hours: z.number().positive().max(2000),
  status: z.enum(["requested", "approved"]).optional(), note: z.string().trim().max(500).optional() });
const decide = z.object({ entryId: z.string().regex(UUID_RE), status: z.enum(["approved", "denied", "canceled"]) });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardWrite("hr-pto", 60);
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail(404, "not_found", "Not found.");
  const p = add.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Pick the kind of time off, the dates and the hours.");
  const { data, error } = await g.supabase.rpc("pm_pto_save", { p_resource_id: id, p: p.data });
  if (error) return hrFail("hr.pto.save", error);
  return json({ id: data as string }, 201);
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardWrite("hr-pto", 60);
  if (!g.ok) return g.res;
  await ctx.params;
  const p = decide.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Pick an entry.");
  const { error } = await g.supabase.rpc("pm_pto_set_status", { p_id: p.data.entryId, p_status: p.data.status });
  if (error) return hrFail("hr.pto.status", error);
  return json({ ok: true });
}
