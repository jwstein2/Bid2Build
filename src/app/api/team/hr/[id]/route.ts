import { z } from "zod";
import { fail, json } from "@/lib/http/api";
import { HR_FIELDS } from "@/lib/team/hr";
import { hrFail } from "@/lib/team/hr-server";
import { guardWrite, UUID_RE } from "@/lib/team/route-helpers";

export const runtime = "nodejs";

const value = z.union([z.string().max(5000), z.number().finite(), z.boolean(), z.null()]);
const body = z.object({ values: z.record(z.enum(Object.keys(HR_FIELDS) as [keyof typeof HR_FIELDS, ...(keyof typeof HR_FIELDS)[]]), value) });

/** Save changed fields of an employee's HR file (owner / HR managers only; checked by the database). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardWrite("hr-save", 60);
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail(404, "not_found", "Not found.");
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Check the details and try again.");
  if (Object.keys(p.data.values).length === 0) return json({ ok: true });
  const { error } = await g.supabase.rpc("pm_employee_hr_save", { p_resource_id: id, p: p.data.values });
  if (error) return hrFail("hr.save", error);
  return json({ ok: true });
}
