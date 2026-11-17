import type { SupabaseClient } from "@supabase/supabase-js";

type EntitlementRow = { tier?: string | null; source?: string | null };

/** True when a user_entitlement() result says the person's access comes from an Enterprise company seat. */
export function isCompanySeat(data: unknown): boolean {
  const row = (Array.isArray(data) ? data[0] : data) as EntitlementRow | null | undefined;
  return Boolean(row && typeof row === "object" && row.tier === "enterprise" && row.source === "company_seat");
}

/**
 * Does this person currently hold an active Enterprise company seat (paid or complimentary)? Used to
 * stop selling a personal Unlimited plan to someone whose company already licenses them. Fails open
 * (returns false) if the entitlement function is unavailable, so checkout never breaks on it.
 */
export async function holdsCompanySeat(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await admin.rpc("user_entitlement", { p_user_id: userId });
  return !error && isCompanySeat(data);
}
