import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";
import type Stripe from "stripe";
import { pmPriceMismatch, type PmPrices } from "./billing";
import { parsePmSeats, type PmSeat, type PmSeats } from "./seats";

export type PmAccess = {
  scope: "company" | "individual" | "none";
  companyId: string | null;
  editorLimit: number;
  editorsAssigned: number;
  canEdit: boolean;
  source: string | null;
  editUntil: string | null;
  addon: boolean;
  addonUntil: string | null;
  extraEditors: number;
};

export const pmPrices = (): PmPrices => {
  const e = serverEnv();
  return { addonMonthly: e.stripePricePmAddon || undefined, addonAnnual: e.stripePricePmAddonAnnual || undefined, editor: e.stripePricePmEditor || undefined };
};

/** The signed-in person's PM access (null when the PM migration isn't applied yet). */
export async function loadPmAccess(supabase: SupabaseClient): Promise<PmAccess | null> {
  const { data, error } = await supabase.rpc("my_pm_access");
  if (error || !data) return null;
  return data as PmAccess;
}

/** The person's own (non-Enterprise) Stripe subscription that the add-on attaches to. */
export async function individualSubscription(admin: SupabaseClient, userId: string) {
  const { data } = await admin.from("subscriptions")
    .select("stripe_subscription_id, stripe_customer_id, status, plan, current_period_end, cancel_at_period_end")
    .eq("user_id", userId).neq("plan", "enterprise")
    .in("status", ["active", "trialing", "past_due", "unpaid", "paused", "incomplete"])
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  return data as null | { stripe_subscription_id: string; stripe_customer_id: string; status: string; plan: string | null; current_period_end: string | null; cancel_at_period_end: boolean };
}

/** Sum of proration lines on a Stripe invoice preview. */
export function prorationCents(lines: { amount: number; parent?: unknown }[]): number {
  return lines
    .filter((l) => (l as { parent?: { subscription_item_details?: { proration?: boolean } } }).parent?.subscription_item_details?.proration)
    .reduce((s, l) => s + l.amount, 0);
}

/** Refuse to charge if the configured Stripe price doesn't match the advertised amount (cached 10 min). */
const verifiedAt = new Map<string, number>();
export async function verifyPmPrice(stripe: Stripe, priceId: string, cents: number, interval: "month" | "year") {
  if ((verifiedAt.get(priceId) ?? 0) > Date.now() - 10 * 60_000) return;
  const why = pmPriceMismatch(await stripe.prices.retrieve(priceId), cents, interval);
  if (why) throw Object.assign(new Error(`PM Stripe price ${priceId} does not match the advertised pricing: ${why}`), { code: "pricing_mismatch" });
  verifiedAt.set(priceId, Date.now());
}

export type SeatMember = { id: string; name: string; role: string };

/**
 * Everything the seat card needs (V4 Phase 9): the seats from company_pm_seats() plus the active roster.
 * Before the Phase 9 SQL runs, falls back to the plain pm_editors list ranked by assignment time.
 */
export async function loadSeatCard(supabase: SupabaseClient, extraPaid: number): Promise<{ seats: PmSeats; members: SeatMember[] } | null> {
  const [pm, { data: roster }, seatsRes] = await Promise.all([
    loadPmAccess(supabase),
    supabase.rpc("company_roster"),
    supabase.rpc("company_pm_seats"),
  ]);
  if (!pm) return null;
  const members = ((roster ?? []) as { user_id: string; display_name: string | null; email: string | null; role: string; status: string }[])
    .filter((m) => m.status === "active").map((m) => ({ id: m.user_id, name: m.display_name || m.email || "Team member", role: m.role }));
  let seats = seatsRes.error ? null : parsePmSeats(seatsRes.data);
  if (!seats) {
    const active = new Set(members.map((m) => m.id));
    const { data: eds } = await supabase.from("pm_editors").select("user_id, assigned_at, assigned_by").order("assigned_at");
    const paid = pm.source === "stripe";
    seats = {
      limit: pm.editorLimit, source: pm.source, paid, extraPaid, schedules: {},
      seats: ((eds ?? []) as { user_id: string; assigned_at: string; assigned_by: string | null }[]).filter((e) => active.has(e.user_id)).map((e, i) => {
        const rank = i + 1;
        const covered = rank <= pm.editorLimit;
        return { userId: e.user_id, rank, covered, assignedAt: e.assigned_at, changedAt: e.assigned_at, changedBy: e.assigned_by,
          seatType: !covered ? "uncovered" : paid && rank === 1 ? "included" : paid && rank <= 1 + extraPaid ? "paid" : "complimentary" } satisfies PmSeat;
      }),
    };
  }
  return { seats, members };
}
