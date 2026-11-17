import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, sameOrigin } from "@/lib/http/api";

const UUID = /^[0-9a-f-]{36}$/i;
const body = z.object({
  name: z.string().trim().min(1).max(200), email: z.string().max(320).default(""), phone: z.string().max(50).default(""),
  projectAddress: z.string().max(500).default(""), notes: z.string().max(4000).default(""),
  customerType: z.enum(["person", "business"]).default("person"), companyName: z.string().max(200).default(""),
});

/**
 * Edit the shared customer record. The database checks who may edit (owner, or a company member allowed
 * to edit team bids); bids and signed proposals keep the details they were created with.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { id } = await params;
  if (!UUID.test(id)) return fail(400, "invalid", "Unknown customer.");
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Customer name is required.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("customer_update", { p_customer: id, p: p.data });
  if (error) {
    if (error.code === "42501") return fail(403, "forbidden", "You don't have permission to edit this customer.");
    logError("customers.update", error, { user: user.id });
    return fail(500, "save_failed", "Could not save this customer.");
  }
  return json({ ok: true });
}

/** Delete a customer that has no bids (records with bids are merged instead, so no bid loses its link). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { id } = await params;
  if (!UUID.test(id)) return fail(400, "invalid", "Unknown customer.");
  const supabase = await createClient();
  const { count } = await supabase.from("estimates").select("id", { count: "exact", head: true }).eq("customer_id", id);
  if (count) return fail(409, "has_bids", "This customer has bids. Merge it into another customer instead of deleting it.");
  // RLS: only the record's owner can delete it.
  const { data, error } = await supabase.from("customers").delete().eq("id", id).select("id");
  if (error || !data?.length) return fail(403, "forbidden", "You can't delete this customer.");
  return json({ ok: true });
}
