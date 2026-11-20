import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emailOwnerAlert } from "@/lib/payouts/notify";
import { money } from "@/lib/payouts/labels";
import { sendAffiliateEmail } from "./emails";

/** After a verified provider event on an affiliate payout: tell the affiliate (live payouts only) and the owner on problems. */
export async function afterAffiliatePayoutEvent(db: SupabaseClient, p: { ref: string; net_cents: number; mode: string; affiliate_id: string }, kind: "paid" | "failed" | "returned") {
  const { data: a } = await db.from("affiliates").select("email, display_name, legal_name").eq("id", p.affiliate_id).maybeSingle();
  if (!a) return;
  const name = (a.display_name ?? a.legal_name ?? null) as string | null;
  if (p.mode === "live") {
    await sendAffiliateEmail(db, `payout/${p.ref}/${kind}`, kind === "paid" ? "payout_sent" : "payout_problem", a.email as string, { name, email: a.email as string, amount: money(p.net_cents), ref: p.ref }, { affiliateId: p.affiliate_id });
  }
  if (kind !== "paid") await emailOwnerAlert(`Affiliate payout ${kind}: ${p.ref}`, `${p.ref} to ${name ?? a.email} (${money(p.net_cents)}) was ${kind}. The commission lines are payable again.`, `aff-payout-${kind}/${p.ref}`);
}
