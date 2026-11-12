import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, sameOrigin } from "@/lib/http/api";

export async function GET() {
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { data } = await (await createClient()).from("customers").select("id, name, email, phone, project_address, notes").order("name").limit(500);
  return json({ customers: (data ?? []).map((c) => ({ id: c.id, name: c.name, email: c.email ?? undefined, phone: c.phone ?? undefined, projectAddress: c.project_address ?? undefined, notes: c.notes ?? undefined })) });
}

const body = z.object({ name: z.string().min(1).max(200), email: z.string().max(320).optional(), phone: z.string().max(50).optional(), projectAddress: z.string().max(500).optional(), notes: z.string().max(4000).optional() });

export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Customer name is required.");
  const { data, error } = await (await createClient()).from("customers")
    .insert({ user_id: user.id, name: p.data.name.trim(), email: p.data.email || null, phone: p.data.phone || null, project_address: p.data.projectAddress || null, notes: p.data.notes || null })
    .select("id, name, email, phone, project_address").single();
  if (error) return fail(500, "save_failed", "Could not save customer.");
  return json({ customer: { id: data.id, name: data.name, email: data.email ?? undefined, phone: data.phone ?? undefined, projectAddress: data.project_address ?? undefined } });
}
