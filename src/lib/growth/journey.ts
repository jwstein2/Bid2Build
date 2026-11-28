/**
 * Unified customer journey measurement (Growth OS Phase 3). Pure functions: the loader
 * (journey-server.ts) reads the tables, the dashboard and the tests call these.
 *
 * Journey: touch (click/landing) → free signup → first bid → proposal sent → activated → paid → retained,
 * plus scheduled cancellation and cancellation.
 *
 * Attribution rules (docs/growth-os/phase3/ATTRIBUTION_RULES.md):
 * - First touch: the earliest recorded touch (marketing_touches), else the first-touch lead record.
 * - Last touch: the latest touch at or before the conversion (signup, or first payment).
 * - Revenue owner: exactly one per account. The commission owner (sales rep or affiliate, as recorded by the
 *   Sales Hub / Affiliate Hub) if there is one, else the last marketing touch before first payment (else
 *   before signup, else first touch). Revenue is summed only by owner, so every dollar is counted once.
 *   First and last touch are "influence" views and are never added together.
 * - Revenue = net Stripe revenue per paid invoice (mkt_revenue_facts: pre-tax, minus refunds, zero after a lost
 *   chargeback), each invoice id once. Complimentary access is never revenue.
 * - Commissions and referral rewards are costs: the sale-month (year 1) commission and the referral reward
 *   count toward CAC; later-year commissions reduce contribution. They are never revenue.
 */
import { classifyChannel, type LeadAttribution } from "../admin/channels";

export const DAY = 86_400_000;
const SIGNUP_GRACE_MS = 60_000;

// ------------------------------------------------------------------------------------------------
// Inputs (rows as the loader reads them; ids, tags, timestamps and cents only)
// ------------------------------------------------------------------------------------------------
export interface JLead extends LeadAttribution { utm_term?: string | null; landing_path?: string | null; first_touch_at?: string | null }
export interface JAccount { id: string; createdAt: string; trade?: string | null; segment?: string | null; lead?: JLead | null }
export interface JTouch {
  user_id: string | null; touch_at: string; channel: string;
  utm_source?: string | null; utm_medium?: string | null; utm_campaign?: string | null; utm_content?: string | null; utm_term?: string | null;
  campaign_id?: string | null; landing_path?: string | null; referrer_host?: string | null; click_id_type?: string | null;
}
export interface JEvent { user_id: string | null; event: string; created_at: string; event_id?: string | null }
export interface JRevenue { invoice_id: string; user_id: string | null; subscription_id?: string | null; billing_reason?: string | null; paid_at: string; gross_cents: number; refund_cents: number; net_cents: number; disputed_lost?: boolean }
export interface JSub { stripe_subscription_id: string; user_id: string; status: string; cancel_at_period_end?: boolean | null; canceled_at?: string | null; ended_at?: string | null }
export interface JOwner { user_id: string; program: "sales_rep" | "affiliate"; partner_id: string; attributed_at?: string | null }
export interface JReferral { referee_id: string | null; referrer_id: string | null; reward_cents: number | null; status: string }
export interface JCommission { user_id: string | null; program: "sales_rep" | "affiliate"; year_no: number; amount_cents: number; status: string }
export interface JCost { period_start: string; channel: string; campaign_id?: string | null; amount_usd: number | string }

export interface JourneyInput {
  accounts: JAccount[]; touches: JTouch[]; events: JEvent[]; revenue: JRevenue[]; subs: JSub[];
  owners: JOwner[]; referrals: JReferral[]; commissions: JCommission[]; costs: JCost[];
}

// ------------------------------------------------------------------------------------------------
// Per-account journey
// ------------------------------------------------------------------------------------------------
export interface TouchView { channel: string; source: string | null; medium: string | null; campaign: string | null; content: string | null; landing: string | null; at: string | null; from: "touch" | "lead" | "none" }
export interface RevenueOwner { kind: "sales_rep" | "affiliate" | "marketing"; key: string; partnerId: string | null }
export interface Journey {
  id: string; trade: string | null; segment: string | null;
  signupAt: string; firstBidAt: string | null; proposalSentAt: string | null; activatedAt: string | null;
  paidAt: string | null; renewals: number; cancelScheduledAt: string | null; canceledAt: string | null; paying: boolean;
  firstTouch: TouchView; lastTouchSignup: TouchView; lastTouchPaid: TouchView | null;
  owner: RevenueOwner; referredBy: string | null;
  grossCents: number; refundCents: number; netCents: number; invoices: number; paidMonths: number;
  year1CommissionCents: number; laterCommissionCents: number; referralRewardCents: number; feeCents: number;
}

/** Stripe processing fee estimate (2.9% + 30¢ per paid invoice, US cards). Labeled an estimate in the UI. */
export const STRIPE_FEE = { pct: 0.029, fixedCents: 30 };
const COUNTED_COMMISSION = new Set(["pending", "earned", "approved", "paid", "payable", "held"]);
const PAYING = new Set(["active", "trialing", "past_due"]);

const tms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
const minIso = (a: string | null, b: string | null | undefined) => (!b ? a : !a || tms(b) < tms(a) ? b : a);

function viewOfTouch(t: JTouch): TouchView {
  return { channel: t.channel, source: t.utm_source ?? null, medium: t.utm_medium ?? null, campaign: t.utm_campaign ?? t.campaign_id ?? null, content: t.utm_content ?? null, landing: t.landing_path ?? null, at: t.touch_at, from: "touch" };
}
function viewOfLead(l: JLead | null | undefined): TouchView {
  if (!l) return { channel: "unknown", source: null, medium: null, campaign: null, content: null, landing: null, at: null, from: "none" };
  return { channel: classifyChannel(l), source: l.utm_source ?? null, medium: l.utm_medium ?? null, campaign: l.first_campaign_name ?? l.first_campaign_id ?? l.utm_campaign ?? null, content: l.utm_content ?? null, landing: l.landing_path ?? null, at: l.first_touch_at ?? null, from: "lead" };
}

/** Months (30.4375 days) between two times, at least 1 for a paid account. */
const monthsBetween = (a: number, b: number) => Math.max(1, Math.ceil((b - a) / (30.4375 * DAY)));

export function buildJourneys(input: JourneyInput, now: Date = new Date()): Journey[] {
  const by = <T, K>(rows: T[], key: (r: T) => K | null | undefined) => {
    const m = new Map<K, T[]>();
    for (const r of rows) { const k = key(r); if (k == null) continue; const l = m.get(k); if (l) l.push(r); else m.set(k, [r]); }
    return m;
  };
  const touches = by(input.touches, (t) => t.user_id);
  const events = by(input.events, (e) => e.user_id);
  // One row per invoice id, whatever the input holds (the view is keyed by invoice id; this is a second guard).
  const uniqueRevenue = [...new Map(input.revenue.map((r) => [r.invoice_id, r])).values()];
  const revenue = by(uniqueRevenue, (r) => r.user_id);
  const subs = by(input.subs, (s) => s.user_id);
  const owners = new Map<string, JOwner>();
  for (const o of [...input.owners].sort((a, b) => tms(a.attributed_at) - tms(b.attributed_at))) if (!owners.has(o.user_id)) owners.set(o.user_id, o);
  const referrals = new Map(input.referrals.filter((r) => r.referee_id).map((r) => [r.referee_id!, r]));
  const commissions = by(input.commissions.filter((c) => COUNTED_COMMISSION.has(c.status)), (c) => c.user_id);

  return input.accounts.map((a) => {
    const ev = events.get(a.id) ?? [];
    const firstOf = (name: string) => ev.filter((e) => e.event === name).reduce<string | null>((m, e) => minIso(m, e.created_at), null);
    const inv = (revenue.get(a.id) ?? []).sort((x, y) => tms(x.paid_at) - tms(y.paid_at));
    const sb = subs.get(a.id) ?? [];
    const paidAt = inv[0]?.paid_at ?? null;
    const paying = sb.some((s) => PAYING.has(s.status));
    const ended = sb.filter((s) => s.ended_at).map((s) => s.ended_at!) ;
    const canceledEvent = firstOf("subscription_canceled");
    const canceledAt = paying ? null : (ended.sort((x, y) => tms(y) - tms(x))[0] ?? canceledEvent);
    const cancelScheduledAt = firstOf("subscription_cancel_scheduled") ?? (sb.some((s) => s.cancel_at_period_end && PAYING.has(s.status)) ? (sb.find((s) => s.cancel_at_period_end)?.canceled_at ?? null) : null);
    const renewals = inv.filter((r) => r.billing_reason === "subscription_cycle" && r.net_cents > 0).length;

    const ts = (touches.get(a.id) ?? []).slice().sort((x, y) => tms(x.touch_at) - tms(y.touch_at));
    const upTo = (iso: string | null, grace = 0) => (iso ? ts.filter((t) => tms(t.touch_at) <= tms(iso) + grace) : ts);
    const leadView = viewOfLead(a.lead);
    const firstTouch = ts.length ? viewOfTouch(ts[0]) : leadView;
    const beforeSignup = upTo(a.createdAt, SIGNUP_GRACE_MS);
    const lastTouchSignup = beforeSignup.length ? viewOfTouch(beforeSignup[beforeSignup.length - 1]) : leadView;
    const beforePaid = paidAt ? upTo(paidAt) : [];
    const lastTouchPaid = paidAt ? (beforePaid.length ? viewOfTouch(beforePaid[beforePaid.length - 1]) : lastTouchSignup) : null;

    const o = owners.get(a.id);
    const marketingKey = (lastTouchPaid ?? lastTouchSignup).channel;
    const owner: RevenueOwner = o ? { kind: o.program, key: o.program, partnerId: o.partner_id } : { kind: "marketing", key: marketingKey, partnerId: null };

    const com = commissions.get(a.id) ?? [];
    const gross = inv.reduce((n, r) => n + r.gross_cents, 0), refund = inv.reduce((n, r) => n + r.refund_cents, 0), net = inv.reduce((n, r) => n + r.net_cents, 0);
    const endMs = canceledAt ? tms(canceledAt) : now.getTime();
    const ref = referrals.get(a.id);
    return {
      id: a.id, trade: a.trade ?? null, segment: a.segment ?? null,
      signupAt: a.createdAt, firstBidAt: firstOf("first_bid_started") ?? firstOf("bid_created"), proposalSentAt: firstOf("proposal_sent"),
      activatedAt: firstOf("bid_activated"), paidAt, renewals, cancelScheduledAt, canceledAt, paying,
      firstTouch, lastTouchSignup, lastTouchPaid, owner,
      referredBy: ref?.referrer_id ?? null,
      grossCents: gross, refundCents: refund, netCents: net, invoices: inv.length,
      paidMonths: paidAt ? monthsBetween(tms(paidAt), endMs) : 0,
      year1CommissionCents: com.filter((c) => c.year_no === 1).reduce((n, c) => n + c.amount_cents, 0),
      laterCommissionCents: com.filter((c) => c.year_no > 1).reduce((n, c) => n + c.amount_cents, 0),
      referralRewardCents: ref && (ref.status === "rewarded" || ref.status === "rewarding") ? (ref.reward_cents ?? 0) : 0,
      feeCents: inv.reduce((n, r) => n + (r.gross_cents > 0 ? Math.round(r.gross_cents * STRIPE_FEE.pct) + STRIPE_FEE.fixedCents : 0), 0),
    };
  });
}

// ------------------------------------------------------------------------------------------------
// Funnel and breakdowns
// ------------------------------------------------------------------------------------------------
export const STAGES = ["signup", "first_bid", "proposal_sent", "activated", "paid", "retained", "canceled"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = { signup: "Free signup", first_bid: "First bid", proposal_sent: "Proposal sent", activated: "Activated", paid: "Paid", retained: "Retained (renewed)", canceled: "Canceled" };

export function reached(j: Journey, s: Stage): boolean {
  switch (s) {
    case "signup": return true;
    case "first_bid": return Boolean(j.firstBidAt);
    case "proposal_sent": return Boolean(j.proposalSentAt);
    case "activated": return Boolean(j.activatedAt);
    case "paid": return Boolean(j.paidAt);
    case "retained": return j.renewals > 0;
    case "canceled": return Boolean(j.canceledAt) && Boolean(j.paidAt);
  }
}

export type Model = "first" | "last" | "owner";
export type Dimension = "channel" | "campaign" | "trade" | "landing" | "creative" | "segment";

function touchFor(j: Journey, model: Model): TouchView {
  return model === "first" ? j.firstTouch : (j.lastTouchPaid ?? j.lastTouchSignup);
}

export function dimensionValue(j: Journey, dim: Dimension, model: Model): string {
  if (dim === "trade") return j.trade ?? "(none)";
  if (dim === "segment") return j.segment ?? "(none)";
  if (model === "owner" && dim === "channel") return j.owner.key;
  const t = touchFor(j, model === "owner" ? "last" : model);
  const v = dim === "channel" ? t.channel : dim === "campaign" ? t.campaign : dim === "landing" ? t.landing : t.content;
  return (v ?? "(none)").toString().toLowerCase().slice(0, 120);
}

export interface BreakdownRow { key: string; counts: Record<Stage, number>; netCents: number; owners: number }

/**
 * Accounts that signed up in [start, end] grouped by a dimension. Stage counts are cohort counts (each account
 * once). Revenue (net, all time for the cohort) is shown only for model "owner", where the groups partition the
 * accounts, so the column always adds up to the total. First/last touch views show counts only.
 */
export function breakdown(journeys: Journey[], dim: Dimension, model: Model, start: number, end: number): BreakdownRow[] {
  const rows = new Map<string, BreakdownRow>();
  for (const j of journeys) {
    const t = tms(j.signupAt);
    if (t < start || t > end) continue;
    const key = dimensionValue(j, dim, model);
    const r = rows.get(key) ?? { key, counts: Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>, netCents: 0, owners: 0 };
    for (const s of STAGES) if (reached(j, s)) r.counts[s]++;
    if (model === "owner") { r.netCents += j.netCents; r.owners++; }
    rows.set(key, r);
  }
  return [...rows.values()].sort((a, b) => b.counts.signup - a.counts.signup || a.key.localeCompare(b.key));
}

/** Net revenue by revenue owner for invoices paid in [start, end]. Sum of rows = total, by construction. */
export function revenueByOwner(input: JourneyInput, journeys: Journey[], start: number, end: number): { rows: { key: string; netCents: number; invoices: number }[]; totalCents: number; invoiceIds: number } {
  const owner = new Map(journeys.map((j) => [j.id, j.owner.key]));
  const seen = new Set<string>();
  const rows = new Map<string, { key: string; netCents: number; invoices: number }>();
  let total = 0;
  for (const r of input.revenue) {
    if (seen.has(r.invoice_id)) continue;
    const t = tms(r.paid_at);
    if (t < start || t > end) continue;
    seen.add(r.invoice_id);
    const key = (r.user_id && owner.get(r.user_id)) || "unmatched";
    const row = rows.get(key) ?? { key, netCents: 0, invoices: 0 };
    row.netCents += r.net_cents; row.invoices++;
    rows.set(key, row);
    total += r.net_cents;
  }
  return { rows: [...rows.values()].sort((a, b) => b.netCents - a.netCents), totalCents: total, invoiceIds: seen.size };
}

// ------------------------------------------------------------------------------------------------
// Cohort retention (by first paid month)
// ------------------------------------------------------------------------------------------------
export interface CohortRow { month: string; size: number; retained: (number | null)[] }

const monthKey = (ms: number) => new Date(ms).toISOString().slice(0, 7);
const addMonths = (ms: number, k: number) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, 1); };

/** retained[k] = share (0-100) of the cohort still paying at the end of month k after the first payment month; null until that month has ended. */
export function cohortRetention(journeys: Journey[], now: Date, months = 12): CohortRow[] {
  const cohorts = new Map<string, Journey[]>();
  for (const j of journeys) if (j.paidAt) { const k = monthKey(tms(j.paidAt)); cohorts.set(k, [...(cohorts.get(k) ?? []), j]); }
  return [...cohorts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, js]) => {
    const start = Date.parse(`${month}-01T00:00:00Z`);
    const retained: (number | null)[] = [];
    for (let k = 0; k < months; k++) {
      const endK = addMonths(start, k + 1);
      if (endK > now.getTime()) { retained.push(null); continue; }
      const alive = js.filter((j) => !j.canceledAt || tms(j.canceledAt) >= endK).length;
      retained.push(Math.round((alive / js.length) * 100));
    }
    return { month, size: js.length, retained };
  });
}

// ------------------------------------------------------------------------------------------------
// Unit economics: CAC (incl. commissions + referral rewards), contribution LTV, payback
// ------------------------------------------------------------------------------------------------
export interface UnitRow {
  key: string; newPaying: number; spendCents: number; year1CommissionCents: number; referralCents: number;
  cacCents: number | null; contributionCents: number; paidMonths: number; monthlyContributionCents: number | null; paybackMonths: number | null;
}
export interface UnitEconomics {
  rows: UnitRow[]; blended: UnitRow;
  monthlyChurnPct: number | null; contributionLtvCents: number | null; ltvReason: string; ltvToCac: number | null;
}
export const LTV_MIN_CUSTOMERS = 20;

/** Contribution to date = net revenue − Stripe fee estimate − later-year commissions (year-1 commission and referral rewards are acquisition cost). */
export const contribution = (j: Journey) => j.netCents - j.feeCents - j.laterCommissionCents;

/**
 * Accounts whose first payment falls in [start, end], grouped by revenue owner. Spend is marketing_costs for
 * that channel, prorated to the window by the caller (channel keys as on the Marketing page; partner programs
 * have no ad spend, their cost is the commission).
 */
export function unitEconomics(journeys: Journey[], spend: JCost[], start: number, end: number): UnitEconomics {
  const newPaying = journeys.filter((j) => j.paidAt && tms(j.paidAt) >= start && tms(j.paidAt) <= end);
  const spendBy = new Map<string, number>();
  for (const c of spend) spendBy.set(c.channel, (spendBy.get(c.channel) ?? 0) + Math.round((Number(c.amount_usd) || 0) * 100));
  const keys = new Set([...newPaying.map((j) => j.owner.key), ...spendBy.keys()]);
  const row = (key: string, js: Journey[], spendCents: number): UnitRow => {
    const y1 = js.reduce((n, j) => n + j.year1CommissionCents, 0), refc = js.reduce((n, j) => n + j.referralRewardCents, 0);
    const contrib = js.reduce((n, j) => n + contribution(j), 0), months = js.reduce((n, j) => n + j.paidMonths, 0);
    const cac = js.length ? Math.round((spendCents + y1 + refc) / js.length) : null;
    const monthly = months > 0 ? Math.round(contrib / months) : null;
    return { key, newPaying: js.length, spendCents, year1CommissionCents: y1, referralCents: refc, cacCents: cac, contributionCents: contrib, paidMonths: months, monthlyContributionCents: monthly,
      paybackMonths: cac != null && monthly && monthly > 0 ? Math.round((cac / monthly) * 10) / 10 : null };
  };
  const rows = [...keys].map((k) => row(k, newPaying.filter((j) => j.owner.key === k), spendBy.get(k) ?? 0)).sort((a, b) => b.newPaying - a.newPaying || b.spendCents - a.spendCents);
  const blended = row("all", newPaying, [...spendBy.values()].reduce((n, v) => n + v, 0));
  // Monthly churn over every account that has paid: cancellations ÷ paying months observed.
  const everPaid = journeys.filter((j) => j.paidAt);
  const exposure = everPaid.reduce((n, j) => n + j.paidMonths, 0), churned = everPaid.filter((j) => j.canceledAt).length;
  const churn = exposure > 0 ? churned / exposure : null;
  const allMonths = everPaid.reduce((n, j) => n + j.paidMonths, 0);
  const avgMonthly = allMonths > 0 ? everPaid.reduce((n, j) => n + contribution(j), 0) / allMonths : null;
  const ok = everPaid.length >= LTV_MIN_CUSTOMERS && churn != null && churn > 0 && avgMonthly != null;
  const ltv = ok ? Math.round(avgMonthly! / churn!) : null;
  return {
    rows, blended,
    monthlyChurnPct: churn != null ? Math.round(churn * 1000) / 10 : null,
    contributionLtvCents: ltv,
    ltvReason: ok ? "Average monthly contribution ÷ monthly customer churn" : `Not enough paid history (needs ≥ ${LTV_MIN_CUSTOMERS} paying customers and at least one cancellation).`,
    ltvToCac: ltv != null && blended.cacCents ? Math.round((ltv / blended.cacCents) * 10) / 10 : null,
  };
}

// ------------------------------------------------------------------------------------------------
// Data quality
// ------------------------------------------------------------------------------------------------
export interface QualityCheck { key: string; severity: "red" | "amber" | "ok"; title: string; detail: string; count: number }

export function dataQuality(input: JourneyInput, journeys: Journey[], now: Date, opts: { touchesOn?: boolean; utmIssueCount?: number } = {}): QualityCheck[] {
  const out: QualityCheck[] = [];
  const add = (key: string, bad: number, sev: "red" | "amber", title: string, detail: string) => out.push({ key, severity: bad > 0 ? sev : "ok", title, detail, count: bad });
  const since7 = now.getTime() - 7 * DAY, since30 = now.getTime() - 30 * DAY;

  const ids = input.revenue.map((r) => r.invoice_id);
  add("duplicate_invoices", ids.length - new Set(ids).size, "red", "Duplicate invoice rows", "The same Stripe invoice id appears more than once in revenue facts (should be impossible).");
  const subscribed = new Set(input.events.filter((e) => e.event === "subscribed").map((e) => e.user_id));
  add("paid_without_subscribed", journeys.filter((j) => j.paidAt && !subscribed.has(j.id)).length, "amber", "Paid accounts with no 'subscribed' event", "A paid invoice exists but the conversion event wasn't recorded (subscription created outside Checkout, or before events existed).");
  add("unmatched_revenue", input.revenue.filter((r) => !r.user_id).length, "amber", "Revenue not matched to an account", "Paid invoices whose Stripe customer isn't linked to a Built2Bid account.");
  const canceledEv = new Set(input.events.filter((e) => e.event === "subscription_canceled").map((e) => e.user_id));
  add("ended_without_event", input.subs.filter((s) => s.ended_at && !canceledEv.has(s.user_id)).length, "amber", "Ended subscriptions with no cancel event", "subscriptions.ended_at is set but no subscription_canceled event exists.");
  const recent = journeys.filter((j) => tms(j.signupAt) >= since7);
  const unattributed = recent.filter((j) => j.firstTouch.from === "none").length;
  add("signups_without_attribution", recent.length >= 5 && unattributed / recent.length > 0.5 ? unattributed : 0, "amber", "Most new signups have no attribution record", `${unattributed} of ${recent.length} signups in 7 days have neither a touch nor a lead record.`);
  add("events_without_id", input.events.filter((e) => !e.event_id && tms(e.created_at) >= since30).length, "amber", "Events without an event id (30 days)", "Server events should always carry an event_id for deduplication.");
  const conflicts = new Map<string, Set<string>>();
  for (const o of input.owners) conflicts.set(o.user_id, (conflicts.get(o.user_id) ?? new Set()).add(o.program));
  add("owner_conflicts", [...conflicts.values()].filter((s) => s.size > 1).length, "red", "Accounts with two commission owners", "An account is attributed to both a sales rep and an affiliate (the database should prevent this).");
  const paidIds = new Set(journeys.filter((j) => j.paidAt).map((j) => j.id));
  add("commission_without_revenue", new Set(input.commissions.filter((c) => c.user_id && COUNTED_COMMISSION.has(c.status) && c.amount_cents > 0 && !paidIds.has(c.user_id)).map((c) => c.user_id)).size, "amber", "Commissions with no paid invoice in revenue facts", "Commission lines exist for accounts with no verified paid invoice.");
  if (opts.touchesOn) {
    const recentTouches = input.touches.filter((t) => tms(t.touch_at) >= since7).length;
    add("no_recent_touches", recent.length > 0 && recentTouches === 0 ? recent.length : 0, "amber", "No touches recorded in 7 days", "Touch tracking is on and accounts signed up, but no touches were stored.");
    add("unknown_channel_touches", input.touches.filter((t) => tms(t.touch_at) >= since30 && t.channel === "unknown").length, "amber", "Touches with an unknown channel (30 days)", "Tagged visits whose tags don't match a channel rule.");
  }
  if (opts.utmIssueCount != null) add("utm_convention", opts.utmIssueCount, "amber", "Touches breaking the UTM convention (30 days)", "Upper case, spaces, unknown utm_medium, or a paid campaign not named b2b-<platform>-<goal>-<yyyymm>.");
  return out;
}
