import { z } from "zod";
import { fail, json } from "@/lib/http/api";
import { hrFail } from "@/lib/team/hr-server";
import { guardWrite, UUID_RE } from "@/lib/team/route-helpers";

export const runtime = "nodejs";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const body = z.object({ id: z.string().regex(UUID_RE).optional(), name: z.string().trim().min(1).max(200), issuer: z.string().trim().max(200).optional(),
  number: z.string().trim().max(80).optional(), issuedOn: date, expiresOn: date, note: z.string().trim().max(500).optional() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardWrite("hr-cert", 60);
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail(404, "not_found", "Not found.");
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Add the certification's name, and check the dates.");
  const { data, error } = await g.supabase.rpc("pm_employee_cert_save", { p_resource_id: id, p: p.data });
  if (error) return hrFail("hr.cert.save", error);
  return json({ id: data as string });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardWrite("hr-cert", 60);
  if (!g.ok) return g.res;
  await ctx.params;
  const cert = new URL(req.url).searchParams.get("cert") ?? "";
  if (!UUID_RE.test(cert)) return fail(400, "invalid", "Pick a certification.");
  const { error } = await g.supabase.rpc("pm_employee_cert_remove", { p_id: cert });
  if (error) return hrFail("hr.cert.remove", error);
  return json({ ok: true });
}
