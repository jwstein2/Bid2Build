import { z } from "zod";
import { fail, json } from "@/lib/http/api";
import { hrFail } from "@/lib/team/hr-server";
import { guardWrite, UUID_RE } from "@/lib/team/route-helpers";

export const runtime = "nodejs";

const body = z.object({ userId: z.string().regex(UUID_RE), on: z.boolean() });

/** The company owner names (or removes) HR managers, who can then open HR files. */
export async function POST(req: Request) {
  const g = await guardWrite("hr-managers", 30);
  if (!g.ok) return g.res;
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Pick a person.");
  const { error } = await g.supabase.rpc("pm_hr_manager_set", { p_user: p.data.userId, p_on: p.data.on });
  if (error) return hrFail("hr.managers", error);
  return json({ ok: true });
}
