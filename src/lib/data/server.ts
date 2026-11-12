import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { proposalConfigFrom, rowToBusiness, rowsToEstimate } from "./mappers";

export async function loadEstimate(supabase: SupabaseClient, id: string) {
  const [{ data: e, error }, { data: groups }, { data: items }] = await Promise.all([
    supabase.from("estimates").select("*").eq("id", id).maybeSingle(),
    supabase.from("estimate_groups").select("*").eq("estimate_id", id).order("sort_order"),
    supabase.from("estimate_items").select("*").eq("estimate_id", id).order("sort_order"),
  ]);
  if (error || !e) return null;
  return { estimate: rowsToEstimate(e, groups ?? [], items ?? []), proposalConfig: proposalConfigFrom(e.proposal_config), customerId: e.customer_id as string | null };
}

export async function loadBusiness(supabase: SupabaseClient, userId: string, opts: { signedLogo?: boolean } = {}) {
  const { data } = await supabase.from("business_profiles").select("*").eq("user_id", userId).maybeSingle();
  const b = rowToBusiness(data);
  if (opts.signedLogo !== false && b.logoPath) {
    const { data: signed } = await supabase.storage.from("logos").createSignedUrl(b.logoPath, 3600);
    b.logoUrl = signed?.signedUrl ?? null;
  }
  return { business: b, exists: Boolean(data) };
}
