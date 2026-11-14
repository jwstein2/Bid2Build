import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Permission, CompanyRole } from "./permissions";

export type MyCompany = {
  id: string;
  name: string;
  role: CompanyRole;
  isOwner: boolean;
  permissions: Permission[];
  entitlement: { active: boolean; source: "stripe" | "complimentary" | null; seatLimit: number; expiresAt: string | null };
  seatsUsed: number;
};

/** The signed-in person's company (null when none, or before the Enterprise migration is applied). */
export async function loadMyCompany(supabase: SupabaseClient): Promise<MyCompany | null> {
  const { data, error } = await supabase.rpc("my_company");
  if (error || !data) return null;
  return data as MyCompany;
}

export const can = (c: MyCompany | null, p: Permission) => Boolean(c?.permissions.includes(p));

/** The company's paid Enterprise subscription row (any non-final status), read with the service role. */
export async function companySubscription(admin: SupabaseClient, companyId: string) {
  const { data } = await admin.from("subscriptions")
    .select("stripe_subscription_id, stripe_customer_id, user_id, status, seat_quantity, current_period_end, cancel_at_period_end")
    .eq("company_id", companyId).eq("plan", "enterprise")
    .in("status", ["active", "trialing", "past_due", "unpaid", "paused", "incomplete"])
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  return data as null | { stripe_subscription_id: string; stripe_customer_id: string; user_id: string; status: string; seat_quantity: number | null; current_period_end: string | null; cancel_at_period_end: boolean };
}

/** Sidebar links for the member's company, by permission (null when not in a company). */
export function companyNav(c: MyCompany | null) {
  if (!c) return null;
  const links: { href: "/company/users" | "/company/billing"; label: string }[] = [{ href: "/company/users", label: "Users & Permissions" }];
  if (can(c, "manage_billing")) links.push({ href: "/company/billing", label: "Billing & Licenses" });
  return { name: c.name, links };
}
