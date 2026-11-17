import { z } from "zod";
import { fail, json } from "@/lib/http/api";
import { dbFail, guardWrite, UUID_RE } from "@/lib/team/route-helpers";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

const body = z.object({
  title: z.string().trim().max(120).nullish(),
  payType: z.enum(["hourly", "salary", "owner", "other"]).default("hourly"),
  hourlyCost: z.union([z.literal(""), z.string().trim().regex(/^\d{1,5}(\.\d{1,2})?$/)]).nullish(),
  hireDate: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).nullish(),
  emergencyName: z.string().trim().max(200).nullish(),
  emergencyPhone: z.string().trim().max(40).nullish(),
  clockEnabled: z.boolean().default(true),
});

/** Save an employee's profile (title, pay type, cost rate, hire date, emergency contact). Managers only. */
export async function POST(req: Request, ctx: Ctx) {
  const g = await guardWrite("employee-save");
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  const p = body.safeParse(await req.json().catch(() => null));
  if (!UUID_RE.test(id) || !p.success) return fail(400, "invalid", "Check the details and try again.");
  const { error } = await g.supabase.rpc("pm_employee_profile_save", { p_resource_id: id, p: p.data });
  if (error) return dbFail("employees.save", error);
  return json({ ok: true });
}
