import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, sameOrigin } from "@/lib/http/api";

/**
 * Customers for the bid builder's picker: every customer record the caller may read (their own, and
 * company customers they can see through RLS), so one company never keeps a separate list per employee.
 */
export async function GET() {
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { data } = await (await createClient()).from("customers").select("id, name, email, phone, project_address, notes").order("name").limit(1000);
  return json({ customers: (data ?? []).map((c) => ({ id: c.id, name: c.name, email: c.email ?? undefined, phone: c.phone ?? undefined, projectAddress: c.project_address ?? undefined, notes: c.notes ?? undefined })) });
}

const body = z.object({
  name: z.string().trim().min(1).max(200), email: z.string().max(320).optional(), phone: z.string().max(50).optional(),
  projectAddress: z.string().max(500).optional(), notes: z.string().max(4000).optional(),
  customerType: z.enum(["person", "business"]).optional(), companyName: z.string().max(200).optional(),
});

/** Create a customer by hand (Customers → New customer). Company members' records join the company. */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Customer name is required.");
  const supabase = await createClient();
  const base = { user_id: user.id, name: p.data.name, email: p.data.email?.trim() || null, phone: p.data.phone?.trim() || null, project_address: p.data.projectAddress?.trim() || null, notes: p.data.notes?.trim() || null };
  const extra = { customer_type: p.data.customerType ?? "person", company_name: p.data.companyName?.trim() || null };
  let res = await supabase.from("customers").insert({ ...base, ...extra }).select("id, name, email, phone, project_address").single();
  // Before the Customer Hub database update the extra columns don't exist yet.
  if (res.error && /customer_type|company_name/.test(res.error.message)) res = await supabase.from("customers").insert(base).select("id, name, email, phone, project_address").single();
  if (res.error || !res.data) return fail(500, "save_failed", "Could not save customer.");
  const d = res.data;
  return json({ customer: { id: d.id, name: d.name, email: d.email ?? undefined, phone: d.phone ?? undefined, projectAddress: d.project_address ?? undefined } });
}
