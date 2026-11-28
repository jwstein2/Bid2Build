import "server-only";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isDemoLogin } from "@/lib/demo/session";
import { CHECKLIST_DISMISSED_KEY } from "@/lib/growth/activation";
import { CHECKLIST_META_KEY, SENT_OR_LATER, WON_OR_LATER, checklistSteps, type ChecklistStep } from "./checklist";

/**
 * Steps for the Home getting started card, or null when it shouldn't show: hidden by the person,
 * a Practice Mode login (the sample company already has everything), or every step done.
 * Any read that fails counts as "not done", so the card errs toward helping.
 */
export async function loadChecklist(user: User): Promise<ChecklistStep[] | null> {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  if (meta[CHECKLIST_META_KEY] || meta[CHECKLIST_DISMISSED_KEY]) return null;
  if (isDemoLogin(user)) return null;
  const db = await createClient();
  const count = (r: { count: number | null; error: unknown }) => (r.error ? 0 : r.count ?? 0);
  const [biz, profile, bids, sent, won, items, latest, links, signed] = await Promise.all([
    db.from("business_profiles").select("company_name, logo_path").eq("user_id", user.id).maybeSingle(),
    db.from("profiles").select("onboarding_status").eq("id", user.id).maybeSingle(),
    db.from("estimates").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    db.from("estimates").select("id", { count: "exact", head: true }).eq("user_id", user.id).in("pipeline_stage", [...SENT_OR_LATER]),
    db.from("estimates").select("id", { count: "exact", head: true }).eq("user_id", user.id).in("pipeline_stage", [...WON_OR_LATER]),
    db.from("saved_items").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    db.from("estimates").select("id").eq("user_id", user.id).neq("status", "archived").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    // Signing evidence counts on its own, so a signed bid finishes "Send" and "Win" even if its stage lags.
    db.from("signing_requests").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    db.from("signatures").select("id", { count: "exact", head: true }).eq("user_id", user.id),
  ]);
  const b = (biz.data ?? null) as { company_name?: string | null; logo_path?: string | null } | null;
  const steps = checklistSteps({
    companyName: Boolean(b?.company_name?.trim()),
    logo: Boolean(b?.logo_path),
    tourDone: (profile.data as { onboarding_status?: string | null } | null)?.onboarding_status === "completed",
    bids: count(bids), sentBids: count(sent), wonBids: count(won), savedItems: count(items),
    signingLinks: count(links), signedBids: count(signed),
    latestBidId: (latest.data as { id?: string } | null)?.id ?? null,
  });
  return steps.every((s) => s.done) ? null : steps;
}
