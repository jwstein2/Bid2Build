import { z } from "zod";
import { fail, json } from "@/lib/http/api";
import { dbFail, guardRead, guardWrite } from "@/lib/team/route-helpers";
import { mapSuppliers } from "@/lib/team/records";

export const runtime = "nodejs";

const body = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200),
  accountNumber: z.string().trim().max(80).nullish(),
  repName: z.string().trim().max(200).nullish(),
  email: z.union([z.literal(""), z.string().trim().email().max(320)]).nullish(),
  phone: z.string().trim().max(40).nullish(),
  website: z.string().trim().max(300).nullish(),
  address: z.string().trim().max(500).nullish(),
  trades: z.array(z.string().trim().max(40)).max(20).default([]),
  notes: z.string().trim().max(2000).nullish(),
});

/** The caller's supplier directory (company-wide, or the solo account's). */
export async function GET() {
  const g = await guardRead();
  if (!g.ok) return g.res;
  const { data, error } = await g.supabase.rpc("pm_suppliers_list");
  if (error) return dbFail("suppliers.list", error);
  return json(mapSuppliers(data));
}

/** Create or update a supplier. Permission checks are repeated in SQL. */
export async function POST(req: Request) {
  const g = await guardWrite("supplier-save");
  if (!g.ok) return g.res;
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", p.error.issues.some((i) => i.path[0] === "email") ? "Check the email address." : "Check the details and try again.");
  const { data, error } = await g.supabase.rpc("pm_supplier_save", { p: p.data });
  if (error) return dbFail("suppliers.save", error);
  return json({ id: data as string });
}
