import { z } from "zod";
import { fail, json } from "@/lib/http/api";
import { dbFail, guardRead, guardWrite, UUID_RE } from "@/lib/team/route-helpers";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

/** One supplier's price imports (the caller's own) and the Saved Items it prices. */
export async function GET(_req: Request, ctx: Ctx) {
  const g = await guardRead();
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail(404, "not_found", "Supplier not found.");
  const { data, error } = await g.supabase.rpc("pm_supplier_detail", { p_id: id });
  if (error) return dbFail("suppliers.detail", error);
  return json(data);
}

/** Archive or restore a supplier. Past imports keep their link. */
export async function POST(req: Request, ctx: Ctx) {
  const g = await guardWrite("supplier-status");
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  const p = z.object({ status: z.enum(["active", "archived"]) }).safeParse(await req.json().catch(() => null));
  if (!UUID_RE.test(id) || !p.success) return fail(400, "invalid", "Check the request and try again.");
  const { error } = await g.supabase.rpc("pm_supplier_set_status", { p_id: id, p_status: p.data.status });
  if (error) return dbFail("suppliers.status", error);
  return json({ ok: true });
}
