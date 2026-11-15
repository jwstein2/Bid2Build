/**
 * Canonical owner-reporting model. Every owner page computes its numbers here, from one scoped
 * snapshot, so "paying customer", "activated business", "MRR" and friends mean the same thing on
 * every page. Pure functions (no I/O): src/lib/admin/platform.ts loads the rows after requireAdmin().
 * Definitions are written out in docs/admin/METRICS.md and src/lib/admin/definitions.ts.
 *
 * Privacy: nothing here reads bid prices, line items or customer (homeowner) details. The project
 * address is only used to derive a state.
 */
import { enterpriseMonthlyCents, ENTERPRISE_INCLUDED_USERS } from "@/lib/enterprise/pricing";
import { classifyAccount, type AccountClass, type Classification } from "./classify";
import { campaignOf, classifyChannel, CHANNELS, isChannel, type Channel, type LeadAttribution } from "./channels";
import { businessKey, series, tradeOf, type EstimateRow, type Point } from "./metrics";
import type { Range } from "./view";

export const DAY = 86_400_000;
export const ACTIVE_WINDOW_DAYS = 30;
/** Below this denominator a percentage is flagged as a small sample. */
export const SMALL_SAMPLE = 20;
export const PAYING = new Set(["active", "trialing", "past_due"]);
const NEVER_PAID = new Set(["incomplete", "incomplete_expired"]);

// ---------------------------------------------------------------------------------------------
// Raw rows (selected columns only)
// ---------------------------------------------------------------------------------------------
export interface UserRow { id: string; email: string | null; created_at: string; email_confirmed_at: string | null; last_sign_in_at: string | null }
export interface LabelRow { user_id: string; label: string; note: string | null; updated_at: string | null }
export interface VersionRow { estimate_id: string; user_id: string; created_at: string; version_number: number }
export interface SignatureRow { estimate_id: string; user_id: string; signed_at: string; pdf_status?: string | null }
export interface SigningRequestRow { id: string; estimate_id: string; user_id: string; company_id?: string | null; status: string; created_at: string; signed_at: string | null; expires_at: string }
export interface SubscriptionRow { stripe_subscription_id: string; user_id: string; status: string; plan: string | null; cancel_at_period_end: boolean | null; canceled_at: string | null; ended_at: string | null; updated_at: string | null; seat_quantity: number | null; current_period_end: string | null; company_id?: string | null; stripe_customer_id?: string | null }
export interface BusinessRow { user_id: string; created_at: string; company_name: string | null }
export interface CompanyRow { id: string; created_at: string; name: string | null; owner_user_id: string | null }
export interface MemberRow { company_id: string; user_id: string; role: string; status: string }
export interface GrantRow { id: string; email: string; user_id: string | null; status: string; plan: string; starts_at: string | null; expires_at: string | null; created_at: string; company_id: string | null; granted_by: string | null; note: string | null; extra_seats: number | null; invite_expires_at: string | null; revoked_at: string | null }
export interface ConsentRow { user_id: string; share_prices: boolean }
export interface EventRow { event: string; user_id: string | null; created_at: string }
export interface LeadRow extends LeadAttribution { user_id: string | null; landing_path: string | null; first_touch_at: string | null; device_type?: string | null; created_at: string }
export interface CostRow { id: number; period_start: string; channel: string; campaign_id: string | null; amount_usd: number | string; note: string | null; created_at: string }
export interface OutboxRow { kind: string; user_id: string; status: string; last_error: string | null; attempts: number; created_at: string; updated_at: string | null }
export interface StripeEventRow { id: string; type: string; received_at: string; processed_at: string | null; error: string | null }

export interface Snapshot {
  users: UserRow[];
  /** "auth" when the account list (with emails) came from Supabase Auth; "profiles" when only profiles were readable. */
  usersSource: "auth" | "profiles";
  labels: LabelRow[]; labelsInstalled: boolean;
  adminIds: Set<string>;
  estimates: EstimateRow[]; versions: VersionRow[]; signatures: SignatureRow[]; signingRequests: SigningRequestRow[];
  subscriptions: SubscriptionRow[]; businesses: BusinessRow[]; companies: CompanyRow[]; members: MemberRow[];
  grants: GrantRow[]; consents: ConsentRow[]; events: EventRow[];
  leads: LeadRow[]; leadsInstalled: boolean; attributionV2: boolean;
  costs: CostRow[]; outbox: OutboxRow[]; stripeEvents: StripeEventRow[];
  pdfErrors7d: number; importFailures7d: number;
  loadedAt: string;
}

const t = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
const minIso = (a: string | null, b: string | null | undefined) => (!b ? a : !a || t(b) < t(a) ? b : a);
const maxIso = (a: string | null, b: string | null | undefined) => (!b ? a : !a || t(b) > t(a) ? b : a);
export const inWindow = (iso: string | null | undefined, start: number, end: number) => { const v = t(iso); return v >= start && v <= end; };
export function windowOf(range: Range, now: Date) { const end = now.getTime(); return { start: end - range.days * DAY, end, prevStart: end - 2 * range.days * DAY }; }

// ---------------------------------------------------------------------------------------------
// Scope: genuine accounts only (default) or everything (owner diagnostic toggle)
// ---------------------------------------------------------------------------------------------
export interface Scoped { d: Snapshot; classes: Map<string, Classification>; excluded: Record<AccountClass, number>; includeTest: boolean }

export function scope(snap: Snapshot, includeTest: boolean): Scoped {
  const labels = new Map(snap.labels.map((l) => [l.user_id, l.label]));
  const classes = new Map<string, Classification>();
  for (const u of snap.users) classes.set(u.id, classifyAccount(u.email, { label: labels.get(u.id), isAdmin: snap.adminIds.has(u.id) }));
  const excluded: Record<AccountClass, number> = { genuine: 0, internal: 0, test: 0, demo: 0 };
  for (const c of classes.values()) if (c.cls !== "genuine") excluded[c.cls]++;
  if (includeTest) return { d: snap, classes, excluded, includeTest };
  // Unknown user ids (no auth row) are kept: we never drop data we cannot classify.
  const keep = (id: string | null | undefined) => !id || (classes.get(id)?.cls ?? "genuine") === "genuine";
  const ownerOk = new Map(snap.companies.map((c) => [c.id, keep(c.owner_user_id)]));
  return {
    classes, excluded, includeTest,
    d: {
      ...snap,
      users: snap.users.filter((u) => keep(u.id)),
      estimates: snap.estimates.filter((e) => keep(e.user_id)),
      versions: snap.versions.filter((v) => keep(v.user_id)),
      signatures: snap.signatures.filter((s) => keep(s.user_id)),
      signingRequests: snap.signingRequests.filter((s) => keep(s.user_id)),
      subscriptions: snap.subscriptions.filter((s) => keep(s.user_id)),
      businesses: snap.businesses.filter((b) => keep(b.user_id)),
      companies: snap.companies.filter((c) => ownerOk.get(c.id)),
      members: snap.members.filter((m) => keep(m.user_id)),
      grants: snap.grants.filter((g) => keep(g.user_id)),
      consents: snap.consents.filter((c) => keep(c.user_id)),
      events: snap.events.filter((e) => keep(e.user_id)),
      leads: snap.leads.filter((l) => keep(l.user_id)),
      outbox: snap.outbox.filter((o) => keep(o.user_id)),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Subscriptions and complimentary access
// ---------------------------------------------------------------------------------------------
/** List-price monthly equivalent of one subscription, in cents. Annual = $149 / 12 (never counted twice). */
export function monthlyCents(s: Pick<SubscriptionRow, "plan" | "seat_quantity">): number {
  if (s.plan === "monthly") return 1999;
  if (s.plan === "annual") return Math.round(14900 / 12);
  if (s.plan === "enterprise") return enterpriseMonthlyCents(Math.max(ENTERPRISE_INCLUDED_USERS, s.seat_quantity ?? ENTERPRISE_INCLUDED_USERS));
  return 0;
}

/** When a subscription stopped being paid for (null = still on). */
export function subEnd(s: SubscriptionRow): string | null {
  if (PAYING.has(s.status)) return null;
  return s.ended_at ?? s.canceled_at ?? s.updated_at ?? null;
}

export const isActiveGrant = (g: Pick<GrantRow, "status" | "starts_at" | "expires_at">, now: number) =>
  g.status === "active" && (!g.starts_at || t(g.starts_at) <= now) && (!g.expires_at || t(g.expires_at) > now);

export type GrantState = "pending" | "active" | "paused" | "expired" | "revoked";
export function grantState(g: GrantRow, now: number): GrantState {
  if (g.status === "revoked") return "revoked";
  if (g.status === "pending") return "pending";
  if (g.status === "paused") return "paused";
  return g.expires_at && t(g.expires_at) <= now ? "expired" : "active";
}

// ---------------------------------------------------------------------------------------------
// Account facts: one row per account, the base of every report
// ---------------------------------------------------------------------------------------------
export type Segment = "paying_active" | "paying_quiet" | "complimentary" | "canceled" | "never_bid" | "one_bid" | "repeat" | "quiet";
export const SEGMENTS: { key: Segment; label: string; def: string }[] = [
  { key: "paying_active", label: "Paying, active", def: `Paid subscription and a bid action in the last ${ACTIVE_WINDOW_DAYS} days` },
  { key: "paying_quiet", label: "Paying, not recently active", def: `Paid subscription, no bid action in ${ACTIVE_WINDOW_DAYS} days` },
  { key: "complimentary", label: "Complimentary", def: "Active complimentary grant and no paid subscription" },
  { key: "canceled", label: "Canceled subscriber", def: "Paid before; no paid subscription now" },
  { key: "never_bid", label: "Registered, no bid yet", def: "Account exists but has never started a bid" },
  { key: "one_bid", label: "Created one bid", def: "Exactly one bid started" },
  { key: "repeat", label: "Repeat active", def: `Two or more bids, and a bid action in the last ${ACTIVE_WINDOW_DAYS} days` },
  { key: "quiet", label: `Repeat, quiet ${ACTIVE_WINDOW_DAYS}+ days`, def: `Two or more bids, nothing in ${ACTIVE_WINDOW_DAYS} days (not churn: free accounts have no contract)` },
];
export const SEGMENT_LABEL = Object.fromEntries(SEGMENTS.map((s) => [s.key, s.label])) as Record<Segment, string>;

export interface AccountFact {
  id: string; email: string | null; createdAt: string; confirmed: boolean; lastSignIn: string | null;
  cls: AccountClass; clsReason: string; clsManual: boolean;
  business: string | null; companyId: string | null; companyRole: string | null;
  estimates: number; finalized: number; signed: number; signingRequests: number;
  firstEstimateAt: string | null; firstFinalizedAt: string | null; lastActivityAt: string | null;
  sub: SubscriptionRow | null; paying: boolean; pastDue: boolean; everPaid: boolean; paidStartedAt: string | null; paidEndedAt: string | null;
  comp: GrantRow | null; segment: Segment; channel: Channel; campaign: string | null; landing: string | null; device: string | null;
}

export function accountFacts(sc: Scoped, now: Date): AccountFact[] {
  const d = sc.d; const nowMs = now.getTime();
  const byUser = <T extends { user_id: string | null }>(rows: T[]) => { const m = new Map<string, T[]>(); for (const r of rows) if (r.user_id) { const a = m.get(r.user_id); if (a) a.push(r); else m.set(r.user_id, [r]); } return m; };
  const est = byUser(d.estimates), ver = byUser(d.versions), sig = byUser(d.signatures), req = byUser(d.signingRequests), subs = byUser(d.subscriptions), grants = byUser(d.grants);
  const leads = new Map(d.leads.filter((l) => l.user_id).map((l) => [l.user_id!, l]));
  const subscribedAt = new Map<string, string>();
  for (const e of d.events) if (e.event === "subscribed" && e.user_id) subscribedAt.set(e.user_id, minIso(subscribedAt.get(e.user_id) ?? null, e.created_at)!);
  const bizName = new Map(d.businesses.map((b) => [b.user_id, b.company_name?.trim() || null]));
  const companies = new Map(d.companies.map((c) => [c.id, c]));
  const membership = new Map<string, MemberRow>();
  for (const m of d.members) if (m.status === "active") membership.set(m.user_id, m);
  for (const c of d.companies) if (c.owner_user_id && !membership.has(c.owner_user_id)) membership.set(c.owner_user_id, { company_id: c.id, user_id: c.owner_user_id, role: "owner", status: "active" });

  return d.users.map((u): AccountFact => {
    const es = est.get(u.id) ?? [], vs = ver.get(u.id) ?? [], ss = sig.get(u.id) ?? [], rs = req.get(u.id) ?? [];
    let firstEstimateAt: string | null = null, firstFinalizedAt: string | null = null, last: string | null = null;
    for (const e of es) { firstEstimateAt = minIso(firstEstimateAt, e.created_at); last = maxIso(last, e.created_at); }
    for (const v of vs) { firstFinalizedAt = minIso(firstFinalizedAt, v.created_at); last = maxIso(last, v.created_at); }
    for (const r of rs) last = maxIso(last, r.created_at);
    for (const s of ss) last = maxIso(last, s.signed_at);
    const userSubs = (subs.get(u.id) ?? []).filter((s) => !NEVER_PAID.has(s.status));
    const current = userSubs.filter((s) => PAYING.has(s.status)).sort((a, b) => t(b.updated_at) - t(a.updated_at))[0] ?? null;
    const latest = current ?? userSubs.sort((a, b) => t(b.updated_at) - t(a.updated_at))[0] ?? null;
    const comp = (grants.get(u.id) ?? []).find((g) => isActiveGrant(g, nowMs)) ?? null;
    const member = membership.get(u.id);
    const company = member ? companies.get(member.company_id) : undefined;
    const lead = leads.get(u.id);
    const active = t(last) >= nowMs - ACTIVE_WINDOW_DAYS * DAY;
    const segment: Segment = current ? (active ? "paying_active" : "paying_quiet")
      : comp ? "complimentary"
      : userSubs.length ? "canceled"
      : es.length === 0 ? "never_bid" : es.length === 1 ? "one_bid" : active ? "repeat" : "quiet";
    const c = sc.classes.get(u.id) ?? { cls: "genuine" as const, reason: "No test signal", manual: false };
    return {
      id: u.id, email: u.email, createdAt: u.created_at, confirmed: Boolean(u.email_confirmed_at), lastSignIn: u.last_sign_in_at,
      cls: c.cls, clsReason: c.reason, clsManual: c.manual,
      business: company?.name?.trim() || bizName.get(u.id) || null, companyId: company?.id ?? null, companyRole: member?.role ?? null,
      estimates: es.length, finalized: new Set(vs.map((v) => v.estimate_id)).size, signed: new Set(ss.map((s) => s.estimate_id)).size, signingRequests: rs.length,
      firstEstimateAt, firstFinalizedAt, lastActivityAt: last,
      sub: latest, paying: Boolean(current), pastDue: current?.status === "past_due", everPaid: userSubs.length > 0,
      paidStartedAt: userSubs.length ? subscribedAt.get(u.id) ?? null : null, paidEndedAt: current ? null : latest ? subEnd(latest) : null,
      comp, segment, channel: classifyChannel(lead), campaign: campaignOf(lead), landing: lead?.landing_path ?? null, device: lead?.device_type ?? null,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Formatting helpers for honest percentages
// ---------------------------------------------------------------------------------------------
export interface Ratio { n: number; d: number; pct: number | null; small: boolean }
export const ratio = (n: number, d: number): Ratio => ({ n, d, pct: d > 0 ? Math.round((n / d) * 100) : null, small: d > 0 && d < SMALL_SAMPLE });

export interface Compare { current: number; previous: number; change: number; pctChange: number | null }
/** Change vs the previous window. No percentage from a zero (or tiny) baseline. */
export function compare(current: number, previous: number): Compare {
  return { current, previous, change: current - previous, pctChange: previous >= 5 ? Math.round(((current - previous) / previous) * 100) : null };
}
const countIn = (dates: (string | null | undefined)[], a: number, b: number) => dates.reduce((n, x) => (inWindow(x, a, b) ? n + 1 : n), 0);

// ---------------------------------------------------------------------------------------------
// Revenue
// ---------------------------------------------------------------------------------------------
export interface RevenueModel {
  paying: number; pastDue: number; trialing: number; monthly: number; annual: number; enterprise: number;
  mrrCents: number; arrCents: number;
  newPaid: Compare; ended: Compare; scheduledCancel: number;
  newMrrCents: number; lostMrrCents: number; netMrrCents: number;
  unknownStart: number;
  comp: { active: number; unlimited: number; enterprise: number };
  mrrSeries: Point[]; movement: { label: string; added: number; lost: number }[];
  pastDueRows: AccountFact[]; endedRows: AccountFact[]; cancelingRows: AccountFact[];
}

/** Was this subscription paid for at time T? Unknown start is treated as "before T" and counted in unknownStart. */
function payingAt(f: AccountFact, T: number) {
  if (!f.sub || !f.everPaid) return false;
  const start = f.paidStartedAt ? t(f.paidStartedAt) : -Infinity;
  const end = f.paidEndedAt ? t(f.paidEndedAt) : Infinity;
  return start <= T && end > T;
}

export function revenueModel(facts: AccountFact[], range: Range, now: Date, nowComp = facts.filter((f) => f.comp && !f.paying)): RevenueModel {
  const w = windowOf(range, now);
  const paying = facts.filter((f) => f.paying);
  const by = (p: string) => paying.filter((f) => f.sub?.plan === p).length;
  const mrr = paying.reduce((n, f) => n + monthlyCents(f.sub!), 0);
  const started = facts.filter((f) => f.everPaid && f.paidStartedAt).map((f) => f.paidStartedAt);
  const endedDates = facts.filter((f) => f.paidEndedAt).map((f) => f.paidEndedAt);
  const newMrr = facts.filter((f) => f.everPaid && inWindow(f.paidStartedAt, w.start, w.end)).reduce((n, f) => n + monthlyCents(f.sub!), 0);
  const lostMrr = facts.filter((f) => inWindow(f.paidEndedAt, w.start, w.end)).reduce((n, f) => n + monthlyCents(f.sub!), 0);
  const pts = series([], now, range.buckets, range.unit);
  const step = (i: number) => (i + 1 < pts.length ? pts[i + 1].start : w.end + 1);
  const mrrSeries = pts.map((p, i) => ({ ...p, value: Math.round(facts.filter((f) => payingAt(f, Math.min(step(i) - 1, w.end))).reduce((n, f) => n + monthlyCents(f.sub!), 0) / 100) }));
  const movement = pts.map((p, i) => ({
    label: p.label,
    added: Math.round(facts.filter((f) => f.everPaid && inWindow(f.paidStartedAt, p.start, step(i) - 1)).reduce((n, f) => n + monthlyCents(f.sub!), 0) / 100),
    lost: Math.round(facts.filter((f) => inWindow(f.paidEndedAt, p.start, step(i) - 1)).reduce((n, f) => n + monthlyCents(f.sub!), 0) / 100),
  }));
  return {
    paying: paying.length, pastDue: paying.filter((f) => f.pastDue).length, trialing: paying.filter((f) => f.sub?.status === "trialing").length,
    monthly: by("monthly"), annual: by("annual"), enterprise: by("enterprise"), mrrCents: mrr, arrCents: mrr * 12,
    newPaid: compare(countIn(started, w.start, w.end), countIn(started, w.prevStart, w.start - 1)),
    ended: compare(countIn(endedDates, w.start, w.end), countIn(endedDates, w.prevStart, w.start - 1)),
    scheduledCancel: paying.filter((f) => f.sub?.cancel_at_period_end).length,
    newMrrCents: newMrr, lostMrrCents: lostMrr, netMrrCents: newMrr - lostMrr,
    unknownStart: facts.filter((f) => f.everPaid && !f.paidStartedAt).length,
    comp: { active: nowComp.length, unlimited: nowComp.filter((f) => f.comp?.plan === "unlimited").length, enterprise: nowComp.filter((f) => f.comp?.plan === "enterprise").length },
    mrrSeries, movement,
    pastDueRows: paying.filter((f) => f.pastDue),
    endedRows: facts.filter((f) => inWindow(f.paidEndedAt, w.start, w.end)),
    cancelingRows: paying.filter((f) => f.sub?.cancel_at_period_end),
  };
}

// ---------------------------------------------------------------------------------------------
// Funnel (account-based cohort) and activation
// ---------------------------------------------------------------------------------------------
export interface Funnel { cohort: number; firstBid: number; finalized: number; paid: number; steps: { key: string; label: string; n: number; ofPrev: Ratio; ofCohort: Ratio }[] }

/** Accounts that signed up in the window, and how many of them reached each step by now. */
export function cohortFunnel(facts: AccountFact[], start: number, end: number): Funnel {
  const c = facts.filter((f) => inWindow(f.createdAt, start, end));
  const firstBid = c.filter((f) => f.firstEstimateAt).length, finalized = c.filter((f) => f.firstFinalizedAt).length, paid = c.filter((f) => f.everPaid).length;
  const raw = [["signup", "Signed up", c.length], ["first_bid", "Started a first bid", firstBid], ["finalized", "Finalized a bid", finalized], ["paid", "Became a paying customer", paid]] as const;
  return {
    cohort: c.length, firstBid, finalized, paid,
    steps: raw.map(([key, label, n], i) => ({ key, label, n, ofPrev: ratio(n, i ? raw[i - 1][2] : n), ofCohort: ratio(n, c.length) })),
  };
}

export interface Kpis {
  paying: { now: number; pastDue: number; net: number };
  mrrCents: number; netMrrCents: number;
  activated: Compare; signups: Compare;
  freeToPaid: Ratio;
}

export function kpis(facts: AccountFact[], range: Range, now: Date): Kpis {
  const w = windowOf(range, now);
  const rev = revenueModel(facts, range, now);
  const signups = facts.map((f) => f.createdAt), activated = facts.map((f) => f.firstFinalizedAt);
  return {
    paying: { now: rev.paying, pastDue: rev.pastDue, net: rev.newPaid.current - rev.ended.current },
    mrrCents: rev.mrrCents, netMrrCents: rev.netMrrCents,
    activated: compare(countIn(activated, w.start, w.end), countIn(activated, w.prevStart, w.start - 1)),
    signups: compare(countIn(signups, w.start, w.end), countIn(signups, w.prevStart, w.start - 1)),
    // All-time: registered genuine accounts that ever paid. Complimentary access does not count.
    freeToPaid: ratio(facts.filter((f) => f.everPaid).length, facts.length),
  };
}

export function momentum(facts: AccountFact[], range: Range, now: Date) {
  return {
    activated: series(facts.map((f) => f.firstFinalizedAt), now, range.buckets, range.unit),
    newPaid: series(facts.filter((f) => f.everPaid).map((f) => f.paidStartedAt), now, range.buckets, range.unit),
    signups: series(facts.map((f) => f.createdAt), now, range.buckets, range.unit),
  };
}

// ---------------------------------------------------------------------------------------------
// Needs attention (only real exceptions)
// ---------------------------------------------------------------------------------------------
export interface Issue { severity: "red" | "amber"; title: string; detail: string; href: string }

export function needsAttention(sc: Scoped, facts: AccountFact[], now: Date): Issue[] {
  const d = sc.d; const nowMs = now.getTime(); const out: Issue[] = [];
  const pastDue = facts.filter((f) => f.pastDue);
  if (pastDue.length) out.push({ severity: "red", title: `${pastDue.length} failed subscription payment${pastDue.length === 1 ? "" : "s"}`, detail: "Past due in Stripe. Stripe retries automatically; reach out if it keeps failing.", href: "/admin/revenue#at-risk" });
  const hookErrors = d.stripeEvents.filter((e) => e.error && t(e.received_at) >= nowMs - 7 * DAY);
  if (hookErrors.length) out.push({ severity: "red", title: `${hookErrors.length} Stripe webhook error${hookErrors.length === 1 ? "" : "s"} (7 days)`, detail: "Subscription state may be out of date until the event is reprocessed.", href: "/admin/operations#health" });
  const stuck = d.stripeEvents.filter((e) => !e.processed_at && !e.error && t(e.received_at) < nowMs - 3_600_000 && t(e.received_at) >= nowMs - 7 * DAY);
  if (stuck.length) out.push({ severity: "amber", title: `${stuck.length} Stripe event${stuck.length === 1 ? "" : "s"} not processed`, detail: "Received over an hour ago and never marked processed.", href: "/admin/operations#health" });
  const failedMail = d.outbox.filter((o) => o.status === "failed");
  if (failedMail.length) out.push({ severity: "amber", title: `${failedMail.length} email${failedMail.length === 1 ? "" : "s"} failed to send`, detail: "Founder welcome emails that gave up after retries.", href: "/admin/operations#auth" });
  const sigPdf = d.signatures.filter((s) => s.pdf_status === "failed");
  if (sigPdf.length) out.push({ severity: "amber", title: `${sigPdf.length} signed proposal PDF${sigPdf.length === 1 ? "" : "s"} failed`, detail: "The signature is recorded, but the signed PDF copy was not generated.", href: "/admin/operations#health" });
  if (d.pdfErrors7d) out.push({ severity: "amber", title: `${d.pdfErrors7d} PDF export error${d.pdfErrors7d === 1 ? "" : "s"} (7 days)`, detail: "Contractors hit an error exporting a proposal.", href: "/admin/logs" });
  const expiring = d.grants.filter((g) => g.status === "active" && g.expires_at && t(g.expires_at) > nowMs && t(g.expires_at) <= nowMs + 7 * DAY);
  if (expiring.length) out.push({ severity: "amber", title: `${expiring.length} complimentary grant${expiring.length === 1 ? "" : "s"} expiring within 7 days`, detail: "Extend, or follow up about converting to paid.", href: "/admin/complimentary?state=expiring_soon" });
  const payingIds = new Set(facts.filter((f) => f.paying).map((f) => f.id));
  const lapsed = d.grants.filter((g) => g.status === "active" && g.expires_at && t(g.expires_at) <= nowMs && t(g.expires_at) > nowMs - 14 * DAY && !(g.user_id && payingIds.has(g.user_id)));
  if (lapsed.length) out.push({ severity: "amber", title: `${lapsed.length} complimentary grant${lapsed.length === 1 ? "" : "s"} expired in the last 14 days`, detail: "Access ended and they are not paying. Review: extend or follow up.", href: "/admin/complimentary?state=expired" });
  const inviteExpired = d.grants.filter((g) => g.status === "pending" && g.invite_expires_at && t(g.invite_expires_at) <= nowMs);
  if (inviteExpired.length) out.push({ severity: "amber", title: `${inviteExpired.length} complimentary invitation${inviteExpired.length === 1 ? "" : "s"} expired unused`, detail: "Resend the invitation or revoke the grant.", href: "/admin/complimentary?state=pending" });
  const wk = nowMs - 7 * DAY;
  const started = d.events.filter((e) => e.event === "checkout_started" && t(e.created_at) >= wk).length;
  const subscribed = d.events.filter((e) => e.event === "subscribed" && t(e.created_at) >= wk).length;
  if (started >= 5 && subscribed === 0) out.push({ severity: "amber", title: "Checkouts started but none completed (7 days)", detail: `${started} checkouts started, 0 subscriptions. Check Stripe Checkout and the webhook.`, href: "/admin/revenue#checkout" });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Recent activity (deduplicated, owner-meaningful events only)
// ---------------------------------------------------------------------------------------------
export type FeedKind = "joined" | "first_bid" | "paid" | "canceled" | "signed" | "comp_granted" | "comp_expired";
export interface FeedItem { kind: FeedKind; at: string; title: string; who: string; href: string }

export function activityFeed(sc: Scoped, facts: AccountFact[], now: Date, limit = 10): FeedItem[] {
  const nowMs = now.getTime(); const items: FeedItem[] = [];
  const who = (f: AccountFact | undefined) => f?.business ?? (f?.email ? f.email.replace(/^(.).*(@.*)$/, "$1…$2") : "An account");
  const byId = new Map(facts.map((f) => [f.id, f]));
  const link = (id: string | null | undefined) => (id ? `/admin/customers/${id}` : "/admin/customers");
  for (const f of facts) {
    items.push({ kind: "joined", at: f.createdAt, title: "New account", who: who(f), href: link(f.id) });
    if (f.firstEstimateAt) items.push({ kind: "first_bid", at: f.firstEstimateAt, title: "First bid started", who: who(f), href: link(f.id) });
    if (f.paidStartedAt) items.push({ kind: "paid", at: f.paidStartedAt, title: `Subscription activated${f.sub?.plan ? ` · ${f.sub.plan}` : ""}`, who: who(f), href: link(f.id) });
    if (f.paidEndedAt) items.push({ kind: "canceled", at: f.paidEndedAt, title: "Subscription ended", who: who(f), href: link(f.id) });
  }
  const signedFirst = new Map<string, { at: string; user: string }>();
  for (const s of sc.d.signatures) if (!signedFirst.has(s.estimate_id) || t(s.signed_at) < t(signedFirst.get(s.estimate_id)!.at)) signedFirst.set(s.estimate_id, { at: s.signed_at, user: s.user_id });
  for (const s of signedFirst.values()) items.push({ kind: "signed", at: s.at, title: "Proposal signed by a customer", who: who(byId.get(s.user)), href: link(s.user) });
  for (const g of sc.d.grants) {
    items.push({ kind: "comp_granted", at: g.created_at, title: `Complimentary ${g.plan === "enterprise" ? "Enterprise" : "Unlimited"} granted`, who: byId.get(g.user_id ?? "")?.business ?? g.email.replace(/^(.).*(@.*)$/, "$1…$2"), href: "/admin/complimentary" });
    if (g.status === "active" && g.expires_at && t(g.expires_at) <= nowMs) items.push({ kind: "comp_expired", at: g.expires_at, title: "Complimentary access expired", who: byId.get(g.user_id ?? "")?.business ?? g.email.replace(/^(.).*(@.*)$/, "$1…$2"), href: "/admin/complimentary?state=expired" });
  }
  return items.filter((i) => t(i.at) <= nowMs).sort((a, b) => t(b.at) - t(a.at)).slice(0, limit);
}

// ---------------------------------------------------------------------------------------------
// Marketing
// ---------------------------------------------------------------------------------------------
export interface ChannelRow { key: Channel; label: string; signups: number; firstBid: number; activated: number; paid: number; mrrCents: number; spendUsd: number | null; cacUsd: number | null; costPerActivationUsd: number | null }
export interface CampaignRow { name: string; channel: Channel; signups: number; activated: number; paid: number; spendUsd: number | null; cacUsd: number | null; signal: string }

const usdOf = (c: CostRow) => Number(c.amount_usd) || 0;
export function costsInWindow(costs: CostRow[], start: number, end: number) {
  return costs.filter((c) => inMonthOverlap(Date.parse(`${c.period_start}T00:00:00Z`), start, end));
}
/** A cost row covers the month starting at period_start; include it if that month overlaps the window. */
function inMonthOverlap(v: number, start: number, end: number) { const d = new Date(v); const monthEnd = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - 1; return monthEnd >= start && v <= end; }
export const costChannel = (c: CostRow): Channel | "other" => (isChannel(c.channel) ? c.channel : "other");

export function channelReport(facts: AccountFact[], costs: CostRow[], start: number, end: number): ChannelRow[] {
  const cohort = facts.filter((f) => inWindow(f.createdAt, start, end));
  const spend = new Map<string, number>();
  for (const c of costsInWindow(costs, start, end)) spend.set(costChannel(c), (spend.get(costChannel(c)) ?? 0) + usdOf(c));
  return CHANNELS.map(({ key, label }) => {
    const c = cohort.filter((f) => f.channel === key);
    const paid = c.filter((f) => f.everPaid).length, activated = c.filter((f) => f.firstFinalizedAt).length;
    const s = spend.get(key) ?? null;
    return {
      key, label, signups: c.length, firstBid: c.filter((f) => f.firstEstimateAt).length, activated, paid,
      mrrCents: c.filter((f) => f.paying).reduce((n, f) => n + monthlyCents(f.sub!), 0),
      spendUsd: s, cacUsd: s != null && paid ? s / paid : null, costPerActivationUsd: s != null && activated ? s / activated : null,
    };
  }).filter((r) => r.signups > 0 || (r.spendUsd ?? 0) > 0);
}

export function campaignReport(facts: AccountFact[], costs: CostRow[], start: number, end: number, now: Date): CampaignRow[] {
  const cohort = facts.filter((f) => inWindow(f.createdAt, start, end) && f.campaign);
  const m = new Map<string, AccountFact[]>();
  for (const f of cohort) { const a = m.get(f.campaign!); if (a) a.push(f); else m.set(f.campaign!, [f]); }
  const spend = new Map<string, number>();
  for (const c of costsInWindow(costs, start, end)) if (c.campaign_id) spend.set(c.campaign_id, (spend.get(c.campaign_id) ?? 0) + usdOf(c));
  const names = new Set([...m.keys(), ...spend.keys()]);
  return [...names].map((name) => {
    const fs = m.get(name) ?? [];
    const paid = fs.filter((f) => f.everPaid).length, activated = fs.filter((f) => f.firstFinalizedAt).length;
    const s = spend.get(name) ?? null;
    const recent = fs.some((f) => t(f.createdAt) >= now.getTime() - 14 * DAY);
    const counts = new Map<Channel, number>(); for (const f of fs) counts.set(f.channel, (counts.get(f.channel) ?? 0) + 1);
    const channel = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? (costs.find((c) => c.campaign_id === name) ? costChannel(costs.find((c) => c.campaign_id === name)!) as Channel : "unknown");
    return {
      name, channel, signups: fs.length, activated, paid, spendUsd: s, cacUsd: s != null && paid ? s / paid : null,
      signal: s && !activated ? "Spend, no activation" : recent ? "Signups in last 14 days" : fs.length ? "No signups in 14 days" : "Spend only",
    };
  }).sort((a, b) => b.signups - a.signups || (b.spendUsd ?? 0) - (a.spendUsd ?? 0));
}

export interface Insight { tone: "green" | "amber"; title: string; evidence: string; rule: string }

export function insights(facts: AccountFact[], costs: CostRow[], events: EventRow[], start: number, end: number, now: Date, sessions: number | null): { items: Insight[]; checked: string[] } {
  const items: Insight[] = []; const checked: string[] = [];
  const f = cohortFunnel(facts, start, end);
  checked.push("Visitor → signup below 1% (needs GA4 sessions ≥ 500)");
  if (sessions != null && sessions >= 500 && f.cohort / sessions < 0.01) items.push({ tone: "amber", title: "High traffic, low signup conversion", evidence: `${f.cohort} signups from ${sessions.toLocaleString("en-US")} sessions (${((f.cohort / sessions) * 100).toFixed(1)}%)`, rule: "Sessions ≥ 500 and signup rate < 1%" });
  checked.push("Signup → first bid below 40% (needs ≥ 20 signups)");
  if (f.cohort >= 20 && f.firstBid / f.cohort < 0.4) items.push({ tone: "amber", title: "Signups are not starting bids", evidence: `${f.firstBid} of ${f.cohort} new accounts started a bid`, rule: "≥ 20 signups and < 40% start a bid" });
  checked.push("Campaign with ≥ $100 spend and no activated business");
  for (const c of campaignReport(facts, costs, start, end, now)) if ((c.spendUsd ?? 0) >= 100 && c.activated === 0) items.push({ tone: "amber", title: `“${c.name}” has spend and no activation`, evidence: `$${Math.round(c.spendUsd!)} spent, ${c.signups} signups, 0 finalized a bid`, rule: "Campaign spend ≥ $100 and 0 activated" });
  checked.push("Landing page with ≥ 10 signups and ≥ 60% activation");
  const byLanding = new Map<string, AccountFact[]>();
  for (const x of facts) if (x.landing && inWindow(x.createdAt, start, end)) { const a = byLanding.get(x.landing); if (a) a.push(x); else byLanding.set(x.landing, [x]); }
  for (const [path, fs] of byLanding) { const act = fs.filter((x) => x.firstFinalizedAt).length; if (fs.length >= 10 && act / fs.length >= 0.6) items.push({ tone: "green", title: `${path} converts well`, evidence: `${act} of ${fs.length} signups finalized a bid`, rule: "≥ 10 signups and ≥ 60% activated" }); }
  checked.push("Checkout completion below 30% (needs ≥ 10 checkouts)");
  const started = events.filter((e) => e.event === "checkout_started" && inWindow(e.created_at, start, end)).length;
  const done = events.filter((e) => e.event === "subscribed" && inWindow(e.created_at, start, end)).length;
  if (started >= 10 && done / started < 0.3) items.push({ tone: "amber", title: "Significant checkout drop-off", evidence: `${done} of ${started} checkouts completed`, rule: "≥ 10 checkouts and < 30% complete" });
  checked.push("Unknown source above 50% (needs ≥ 10 signups)");
  const unknown = facts.filter((x) => inWindow(x.createdAt, start, end) && x.channel === "unknown").length;
  if (f.cohort >= 10 && unknown / f.cohort > 0.5) items.push({ tone: "amber", title: "Most signups have no recorded source", evidence: `${unknown} of ${f.cohort} signups are Unknown`, rule: "≥ 10 signups and > 50% Unknown. Tag every ad and outreach link with UTM parameters." });
  return { items, checked };
}

// ---------------------------------------------------------------------------------------------
// Product usage
// ---------------------------------------------------------------------------------------------
export interface UsageModel {
  firstEstimates: Compare; repeatBusinesses: number; finalized: Compare; signed: Compare; requests: Compare; acceptance: Ratio; pendingRequests: number;
  medianHoursToFirstBid: number | null; medianSample: number; firstToFinal: Ratio;
  wab: number; mab: number; perActiveBusiness: number | null; esignAdoption: Ratio; retainedPaid: Ratio;
  activationSeries: { label: string; signups: number; firstBid: number }[]; wabSeries: Point[];
  trades: { trade: string; bids: number; prev: number; finalized: number; signed: number }[];
}

export function usageModel(sc: Scoped, facts: AccountFact[], range: Range, now: Date): UsageModel {
  const d = sc.d; const w = windowOf(range, now); const nowMs = now.getTime();
  const firstVersion = new Map<string, string>();
  for (const v of d.versions) firstVersion.set(v.estimate_id, minIso(firstVersion.get(v.estimate_id) ?? null, v.created_at)!);
  const signedFirst = new Map<string, string>();
  for (const s of d.signatures) signedFirst.set(s.estimate_id, minIso(signedFirst.get(s.estimate_id) ?? null, s.signed_at)!);
  const fin = [...firstVersion.values()], sig = [...signedFirst.values()];
  const reqIn = d.signingRequests.filter((r) => inWindow(r.created_at, w.start, w.end));
  const resolved = reqIn.filter((r) => r.status === "signed" || r.status === "revoked" || t(r.expires_at) <= nowMs);
  // Median signup -> first bid, for accounts that signed up in the window and started one.
  const gaps = facts.filter((f) => inWindow(f.createdAt, w.start, w.end) && f.firstEstimateAt).map((f) => Math.max(0, t(f.firstEstimateAt) - t(f.createdAt)) / 3_600_000).sort((a, b) => a - b);
  const median = gaps.length ? (gaps.length % 2 ? gaps[(gaps.length - 1) / 2] : (gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2) : null;
  // Active business = a bid created/finalized, signing request sent or proposal signed.
  const actions: { key: string; at: string }[] = [
    ...d.estimates.map((e) => ({ key: businessKey(e), at: e.created_at })),
    ...d.versions.map((v) => ({ key: `u:${v.user_id}`, at: v.created_at })),
    ...d.signingRequests.map((r) => ({ key: r.company_id ?? `u:${r.user_id}`, at: r.created_at })),
  ];
  const activeIn = (a: number, b: number) => new Set(actions.filter((x) => inWindow(x.at, a, b)).map((x) => x.key)).size;
  const bidsByBiz = new Map<string, number>(); for (const e of d.estimates) bidsByBiz.set(businessKey(e), (bidsByBiz.get(businessKey(e)) ?? 0) + 1);
  const bidsInRange = d.estimates.filter((e) => inWindow(e.created_at, w.start, w.end)).length;
  const activeRange = activeIn(w.start, w.end);
  const ESIGN_SINCE = Date.parse("2026-11-15T00:00:00Z");
  const eligible = facts.filter((f) => f.firstFinalizedAt && t(f.lastActivityAt) >= ESIGN_SINCE);
  const pts = series([], now, range.buckets, range.unit);
  const step = (i: number) => (i + 1 < pts.length ? pts[i + 1].start : w.end + 1);
  const trades = new Map<string, { bids: number; prev: number; finalized: number; signed: number }>();
  for (const e of d.estimates) {
    const k = tradeOf(e); const r = trades.get(k) ?? { bids: 0, prev: 0, finalized: 0, signed: 0 };
    if (inWindow(e.created_at, w.start, w.end)) { r.bids++; if (firstVersion.has(e.id)) r.finalized++; if (signedFirst.has(e.id)) r.signed++; }
    else if (inWindow(e.created_at, w.prevStart, w.start - 1)) r.prev++;
    trades.set(k, r);
  }
  const everPaid = facts.filter((f) => f.everPaid);
  const weeks = series([], now, 8, "week");
  return {
    firstEstimates: compare(countIn(facts.map((f) => f.firstEstimateAt), w.start, w.end), countIn(facts.map((f) => f.firstEstimateAt), w.prevStart, w.start - 1)),
    repeatBusinesses: [...bidsByBiz.values()].filter((n) => n > 1).length,
    finalized: compare(countIn(fin, w.start, w.end), countIn(fin, w.prevStart, w.start - 1)),
    signed: compare(countIn(sig, w.start, w.end), countIn(sig, w.prevStart, w.start - 1)),
    requests: compare(reqIn.length, d.signingRequests.filter((r) => inWindow(r.created_at, w.prevStart, w.start - 1)).length),
    acceptance: ratio(resolved.filter((r) => r.status === "signed").length, resolved.length), pendingRequests: reqIn.length - resolved.length,
    medianHoursToFirstBid: median, medianSample: gaps.length,
    firstToFinal: ratio(facts.filter((f) => inWindow(f.firstEstimateAt, w.start, w.end) && f.firstFinalizedAt).length, facts.filter((f) => inWindow(f.firstEstimateAt, w.start, w.end)).length),
    wab: activeIn(nowMs - 7 * DAY, nowMs), mab: activeIn(nowMs - 30 * DAY, nowMs),
    perActiveBusiness: activeRange ? Math.round((bidsInRange / activeRange) * 10) / 10 : null,
    esignAdoption: ratio(eligible.filter((f) => f.signingRequests > 0).length, eligible.length),
    retainedPaid: ratio(everPaid.filter((f) => f.paying).length, everPaid.length),
    activationSeries: pts.map((p, i) => { const c = facts.filter((f) => inWindow(f.createdAt, p.start, step(i) - 1)); return { label: p.label, signups: c.length, firstBid: c.filter((f) => f.firstEstimateAt).length }; }),
    wabSeries: weeks.map((p, i) => ({ ...p, value: activeIn(p.start, i + 1 < weeks.length ? weeks[i + 1].start - 1 : nowMs) })),
    trades: [...trades.entries()].map(([trade, r]) => ({ trade, ...r })).filter((r) => r.bids || r.prev).sort((a, b) => b.bids - a.bids || b.prev - a.prev),
  };
}

export type { Channel, AccountClass };
