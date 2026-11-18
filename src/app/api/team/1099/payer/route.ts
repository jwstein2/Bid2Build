import { z } from "zod";
import { fail, json } from "@/lib/http/api";
import { dbFail, guardRead, guardWrite } from "@/lib/team/route-helpers";

export const runtime = "nodejs";

/** Your own legal name, EIN and address, printed as the payer on 1099-NEC forms. */
export async function GET() {
  const g = await guardRead();
  if (!g.ok) return g.res;
  const { data, error } = await g.supabase.from("pm_payer_profiles").select("legal_name, ein, address, phone").maybeSingle();
  if (error) return dbFail("subs.1099.payer", error);
  const p = data as { legal_name: string; ein: string | null; address: string | null; phone: string | null } | null;
  return json(p ? { legalName: p.legal_name, ein: p.ein, address: p.address, phone: p.phone } : null);
}

const body = z.object({ legalName: z.string().trim().min(1).max(200), ein: z.string().trim().max(20).optional(), address: z.string().trim().max(500).optional(), phone: z.string().trim().max(40).optional() });

export async function POST(req: Request) {
  const g = await guardWrite("sub-payer", 30);
  if (!g.ok) return g.res;
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Enter your legal business name.");
  if (p.data.ein && p.data.ein.replace(/\D/g, "").length !== 9) return fail(400, "invalid", "An EIN has 9 digits (NN-NNNNNNN).");
  const { error } = await g.supabase.rpc("pm_payer_profile_save", { p: p.data });
  if (error) return dbFail("subs.1099.payer.save", error);
  return json({ ok: true });
}
