import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { creditStatusFrom, type CreditStatus } from "./status";

/** Balances for the signed-in user. Also grants starter credits on first call after verification. */
export async function loadCreditStatus(supabase: SupabaseClient): Promise<CreditStatus | null> {
  const { data, error } = await supabase.rpc("credit_status");
  if (error) return null;
  return creditStatusFrom(data);
}
