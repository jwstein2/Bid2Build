import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { plaidPrices, plaidUsage, type PlaidConnRow, type PlaidUsage } from "./plaid-cost";

/** Owner-only (service role). Reads aggregate connection rows and sync counts, never balances or transactions. */
export async function loadPlaidUsage(now = new Date()): Promise<PlaidUsage | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.from("fin_bank_connections").select("id, status, created_at, disconnected_at").eq("provider", "plaid").eq("sandbox", false).limit(5000);
    if (error) return null;
    const conns = (data ?? []) as PlaidConnRow[];
    let calls = 0;
    if (conns.length) {
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
      for (let i = 0; i < conns.length; i += 200) {
        const { count } = await admin.from("fin_audit_log").select("id", { count: "exact", head: true })
          .eq("action", "bank.synced").eq("entity_type", "bank_connection").gte("created_at", monthStart).in("entity_id", conns.slice(i, i + 200).map((c) => c.id));
        calls += count ?? 0;
      }
    }
    return plaidUsage(conns, calls, plaidPrices(), now);
  } catch {
    return null;
  }
}
