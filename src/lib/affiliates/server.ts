import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { createClient, getUser, type SessionUser } from "../supabase/server";
import { isSupabaseConfigured } from "../env";

type Db = Awaited<ReturnType<typeof createClient>>;

export interface AffiliateStep { key: string; label: string; done: boolean }
export interface AffiliateMe {
  id: string; code: string; status: string; email: string; legal_name: string | null; display_name: string | null; business_name: string | null;
  phone: string | null; address_line1: string | null; address_line2: string | null; city: string | null; state: string | null; postal_code: string | null;
  country: string | null; tax_residency: string | null; contact_pref: string | null; marketing_opt_in: boolean; submitted_at: string | null; status_reason: string | null;
  onboarding: { steps: AffiliateStep[]; lessons_done: number; us_payouts: boolean; w9_status: string; tin_last4: string | null; agreement_accepted: boolean;
    destination: { institution_name: string | null; last4: string | null; status: string; eligible_from: string | null; mode: string } | null };
  channel: Record<string, unknown> | null;
  corrections: { id: string; field: string; proposed_value: string; status: string; review_note: string | null; created_at: string }[];
  lessons: string[];
  agreement: { id: string; version: number; title: string; body: string; legal_status: string; accepted_at: string | null } | null;
  policy: Record<string, unknown> | null;
}

export type AffiliateAccess =
  | { kind: "affiliate"; user: SessionUser; me: AffiliateMe; db: Db }
  | { kind: "blocked"; user: SessionUser; status: string; reason: string | null }
  | { kind: "none"; user: SessionUser };

/** Signed-in affiliate gate (own session; affiliate_me links an approved application or accepted invite by verified email). */
export async function loadAffiliate(next = "/affiliate-hub"): Promise<AffiliateAccess> {
  if (!isSupabaseConfigured()) redirect("/affiliate-hub/login");
  const user = await getUser();
  if (!user) redirect(`/affiliate-hub/login?next=${encodeURIComponent(next)}`);
  const db = await createClient();
  const { data, error } = await db.rpc("affiliate_me");
  const me = (error ? null : data) as (AffiliateMe & { reason?: string }) | null;
  if (!me) return { kind: "none", user };
  if (!me.onboarding) return { kind: "blocked", user, status: me.status, reason: me.reason ?? null };
  return { kind: "affiliate", user, me, db };
}

/** Pages past onboarding: active affiliates only (others go to setup or see their status). */
export async function requireActiveAffiliate(next: string) {
  const a = await loadAffiliate(next);
  if (a.kind !== "affiliate") redirect("/affiliate-hub");
  if (a.me.status !== "active" && a.me.status !== "terminated") redirect("/affiliate-hub/onboarding");
  return a;
}

export const safeHubNext = (n: string | null | undefined) => (n && /^\/affiliate-hub(\/[a-z0-9/_-]*)?$/i.test(n) && !n.startsWith("/affiliate-hub/login") ? n : "/affiliate-hub");

/** Invite tokens: 32 random bytes (base64url) in the link; only the hash is stored. */
export const newInviteToken = () => randomBytes(32).toString("base64url");
export const inviteTokenHash = (token: string) => createHash("sha256").update(`b2b-aff-invite:${token}`).digest("hex");

/** The active affiliate's dashboard data (own rows only, privacy-safe customer labels). */
export async function loadDashboard(next: string) {
  const a = await requireActiveAffiliate(next);
  const { data, error } = await a.db.rpc("affiliate_my_dashboard");
  if (error || !data) throw new Error("affiliate_dashboard_unavailable");
  return { ...a, dash: data as import("./portfolio").Dashboard & Record<string, unknown> };
}
