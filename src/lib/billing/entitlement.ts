import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The one server-side check for Unlimited-only features (Saved Items & Pricing, Proposal Templates).
 * It asks the database's public.library_access(): an Unlimited subscription in good standing, or an
 * admin. The same function guards the saved-items RLS policies and the proposal-defaults trigger,
 * so the app and the database can't disagree. Any error counts as "no access".
 */
export async function hasPremiumAccess(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.rpc("library_access");
  return !error && data === true;
}
