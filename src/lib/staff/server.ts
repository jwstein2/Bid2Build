import "server-only";
import { notFound, redirect } from "next/navigation";
import { createAdminClient, createClient, getUser, type SessionUser } from "../supabase/server";
import { isSupabaseConfigured } from "../env";
import { requireAdminTwoStep } from "../admin/server";

export type StaffCap = "staff.view" | "staff.manage" | "payouts.view" | "payouts.manage" | "payouts.activate" | "banking.view" | "banking.manage" | "tax.view" | "reports.export" | "reconcile" | "self.view";

/**
 * Internal staff / finance authorization (V8.1). Capabilities come from public.staff_capabilities() in the
 * database, so every page, action and export checks the same rules. Callers without the capability get a 404
 * (the area isn't disclosed). Returns a service-role client: every admin_* function re-checks p_caller.
 */
export async function requireStaffCap(cap: StaffCap): Promise<{ user: SessionUser; db: ReturnType<typeof createAdminClient>; caps: string[]; owner: boolean }> {
  if (!isSupabaseConfigured()) notFound();
  const user = await getUser();
  if (!user || !user.emailVerified) notFound();
  const db = createAdminClient();
  const { data, error } = await db.rpc("staff_capabilities", { p_user: user.id });
  const caps = (error ? [] : (data as string[] | null) ?? []);
  if (!caps.includes(cap)) notFound();
  const owner = caps.includes("payouts.activate");
  // The owner's admin account always needs the authenticator step here too (same rule as requireAdmin).
  if (owner) await requireAdminTwoStep();
  return { user, db, caps, owner };
}

/** True when this session passed the authenticator step (aal2). Financial administration requires it. */
export async function hasTwoStep(): Promise<boolean> {
  const sb = await createClient();
  const { data } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.currentLevel === "aal2";
}

export const TWO_STEP_FINANCE = "Financial administration needs two-step sign-in. Turn it on in Account settings → Two-step sign-in, sign in with your authenticator code, then try again.";

/** The signed-in staff member's own view (self-service pages). Redirects signed-out visitors to sign in. */
export async function loadStaffSelf(next = "/staff") {
  if (!isSupabaseConfigured()) redirect("/staff/login");
  const user = await getUser();
  if (!user) redirect(`/staff/login?next=${encodeURIComponent(next)}`);
  const db = await createClient();
  const { data, error } = await db.rpc("staff_me");
  return { user, db, me: (error ? null : data) as StaffMe | null };
}

export interface StaffAgreement { id: string; kind: string; version: number; title: string; body: string; legal_status: string; accepted: boolean; optional?: boolean }
export interface OnboardingStep { key: string; label: string; state: "done" | "todo" | "blocked" | "payroll" }
export interface StaffMe {
  id: string; status: string; email: string; display_name: string; preferred_name: string | null; legal_first_name: string | null; legal_last_name: string | null;
  phone: string | null; address_line1: string | null; address_line2: string | null; city: string | null; state: string | null; postal_code: string | null; country: string;
  emergency_name: string | null; emergency_phone: string | null; emergency_relation: string | null; job_title: string | null; department: string | null;
  classification: string; comp_types: string[]; pay_rate_cents: number | null; pay_unit: string | null; pay_frequency: string | null; payment_method: string; start_date: string | null;
  roles: string[]; caps: string[]; sales_rep: { id: string } | null; role_confirmed_at: string | null; security_confirmed_at: string | null;
  onboarding: { steps: OnboardingStep[]; complete: boolean; missing_agreements: { id: string; kind: string; title: string }[] };
  tax: { w9_status: string; tin_type: string | null; tin_last4: string | null; w4_status: string; state_w4_status: string; i9_section1_status: string; wage_notice_ack_at: string | null } | null;
  required_agreements: StaffAgreement[];
  fee_policy: { version: number; standard_fixed_cents: number; standard_bps: number; instant_enabled: boolean; instant_fixed_cents: number; instant_bps: number; instant_min_cents: number; monthly_account_cents: number; disclosure: string; approved: boolean } | null;
  payout_mode: "off" | "test" | "live";
  destinations: { mode: string; institution_name: string | null; last4: string | null; status: string; eligible_from: string | null; account_type: string }[];
}
