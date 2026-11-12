import { createClient, getUser } from "@/lib/supabase/server";
import { fail } from "@/lib/http/api";

/** Data portability: everything owned by the signed-in user, read through RLS. */
export async function GET() {
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const supabase = await createClient();
  const tables = ["profiles", "business_profiles", "customers", "estimates", "estimate_groups", "estimate_items", "estimate_versions", "generated_documents", "usage_counters", "usage_events", "subscriptions", "saved_items", "assemblies", "assembly_items", "user_templates"] as const;
  const out: Record<string, unknown> = { exported_at: new Date().toISOString(), account: { id: user.id, email: user.email } };
  for (const t of tables) out[t] = (await supabase.from(t).select("*")).data ?? [];
  return new Response(JSON.stringify(out, null, 2), {
    headers: { "content-type": "application/json", "content-disposition": `attachment; filename="my-data-${new Date().toISOString().slice(0, 10)}.json"`, "cache-control": "no-store" },
  });
}
