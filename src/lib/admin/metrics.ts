/**
 * Owner/admin command-center metrics. Pure functions over raw platform rows so they are easy to test;
 * src/lib/admin/platform.ts loads the rows (admin only, service role). Nothing here reads or returns
 * bid prices, line items, customer names or addresses: the address is used only to derive a state.
 */
import { bidState, type StateSource } from "@/lib/geo/address";
import { enterpriseMonthlyCents, ENTERPRISE_INCLUDED_USERS } from "@/lib/enterprise/pricing";

export interface EstimateRow { id: string; user_id: string; company_id: string | null; trades: string[] | null; template_trade: string | null; status: string | null; created_at: string; location_state: string | null; location_zip: string | null; project_address: string | null }
export interface VersionRow { estimate_id: string; user_id: string; created_at: string; version_number: number }
export interface SignatureRow { estimate_id: string; user_id: string; signed_at: string }
export interface SubscriptionRow { user_id: string; status: string; plan: string; cancel_at_period_end: boolean | null; canceled_at: string | null; ended_at: string | null; updated_at: string | null; seat_quantity: number | null; current_period_end: string | null }
export interface ProfileRow { id: string; created_at: string }
export interface BusinessRow { user_id: string; created_at: string; has_name: boolean }
export interface CompanyRow { id: string; created_at: string }
export interface GrantRow { user_id: string | null; status: string; plan: string; starts_at: string | null; expires_at: string | null }
export interface ConsentRow { user_id: string; share_prices: boolean }

export interface PlatformData {
  estimates: EstimateRow[]; versions: VersionRow[]; signatures: SignatureRow[]; subscriptions: SubscriptionRow[];
  profiles: ProfileRow[]; businesses: BusinessRow[]; companies: CompanyRow[]; grants: GrantRow[]; consents: ConsentRow[];
  /** From admin_metrics(): auth accounts and verified accounts. */
  accounts: number; verifiedAccounts: number;
}

export const ACTIVE_SUB = new Set(["active", "trialing", "past_due"]);
const DAY = 86_400_000;

export const tradeOf = (e: Pick<EstimateRow, "trades" | "template_trade">) => e.trades?.[0] ?? e.template_trade ?? "other";
/** A "business" is the company for Enterprise members, otherwise the account itself. */
export const businessKey = (e: { company_id: string | null; user_id: string }) => e.company_id ?? `u:${e.user_id}`;

function startOfDayUTC(d: Date) { return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
function startOfWeekUTC(d: Date) { const s = startOfDayUTC(d); const dow = (new Date(s).getUTCDay() + 6) % 7; return s - dow * DAY; }
function startOfMonthUTC(d: Date) { return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); }
const t = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);

export interface Point { label: string; start: number; value: number }

/** Count timestamps into equal day/week/month buckets ending at `now` (oldest first). */
export function series(dates: (string | null | undefined)[], now: Date, buckets: number, unit: "day" | "week" | "month"): Point[] {
  const starts: number[] = [];
  if (unit === "month") {
    for (let i = buckets - 1; i >= 0; i--) starts.push(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
  } else {
    const step = unit === "day" ? DAY : 7 * DAY;
    const cur = unit === "day" ? startOfDayUTC(now) : startOfWeekUTC(now);
    for (let i = buckets - 1; i >= 0; i--) starts.push(cur - i * step);
  }
  const counts = new Array(starts.length).fill(0);
  for (const d of dates) {
    const v = t(d);
    if (!Number.isFinite(v) || v < starts[0]) continue;
    let i = starts.length - 1;
    while (i > 0 && v < starts[i]) i--;
    counts[i]++;
  }
  const fmt = (s: number) => {
    const d = new Date(s);
    return unit === "month" ? d.toLocaleString("en-US", { month: "short", timeZone: "UTC" }) + (d.getUTCMonth() === 0 ? ` ${String(d.getUTCFullYear()).slice(2)}` : "") : `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  };
  return starts.map((s, i) => ({ label: fmt(s), start: s, value: counts[i] }));
}

const countSince = (dates: (string | null | undefined)[], since: number) => dates.reduce((n, d) => (t(d) >= since ? n + 1 : n), 0);

/** Change vs the previous window of the same length, as a whole percent (null when no baseline). */
export function delta(dates: (string | null | undefined)[], now: Date, days: number): { current: number; previous: number; pct: number | null } {
  const end = now.getTime(); const a = end - days * DAY; const b = a - days * DAY;
  let current = 0; let previous = 0;
  for (const d of dates) { const v = t(d); if (v >= a && v <= end) current++; else if (v >= b && v < a) previous++; }
  return { current, previous, pct: previous ? Math.round(((current - previous) / previous) * 100) : null };
}

export interface Revenue {
  monthly: number; annual: number; enterprise: number; paidAccounts: number; mrrCents: number; arrCents: number;
  cancelingAtPeriodEnd: number; canceled30d: number; pastDue: number; compActive: number; compByPlan: Record<string, number>;
}

export function revenue(d: PlatformData, now: Date): Revenue {
  // One row per account and plan: the newest active subscription wins.
  const active = d.subscriptions.filter((s) => ACTIVE_SUB.has(s.status));
  const byUser = new Map<string, SubscriptionRow>();
  for (const s of active) { const prev = byUser.get(s.user_id); if (!prev || t(s.updated_at) > t(prev.updated_at)) byUser.set(s.user_id, s); }
  let monthly = 0, annual = 0, enterprise = 0, mrr = 0;
  for (const s of byUser.values()) {
    if (s.plan === "monthly") { monthly++; mrr += 1999; }
    else if (s.plan === "annual") { annual++; mrr += Math.round(14900 / 12); }
    else if (s.plan === "enterprise") { enterprise++; mrr += enterpriseMonthlyCents(ENTERPRISE_INCLUDED_USERS + Math.max(0, s.seat_quantity ?? 0)); }
  }
  const since30 = now.getTime() - 30 * DAY;
  const compActive = d.grants.filter((g) => g.status === "active" && (!g.starts_at || t(g.starts_at) <= now.getTime()) && (!g.expires_at || t(g.expires_at) > now.getTime()));
  const compByPlan: Record<string, number> = {};
  for (const g of compActive) compByPlan[g.plan] = (compByPlan[g.plan] ?? 0) + 1;
  return {
    monthly, annual, enterprise, paidAccounts: byUser.size, mrrCents: mrr, arrCents: mrr * 12,
    cancelingAtPeriodEnd: [...byUser.values()].filter((s) => s.cancel_at_period_end).length,
    canceled30d: d.subscriptions.filter((s) => t(s.canceled_at) >= since30 || t(s.ended_at) >= since30).length,
    pastDue: [...byUser.values()].filter((s) => s.status === "past_due").length,
    compActive: compActive.length, compByPlan,
  };
}

export interface LocationQuality { total: number; withState: number; withZip: number; missing: number; bySource: Record<Exclude<StateSource, null> | "missing", number>; structured: number }

export function locationQuality(estimates: EstimateRow[]): LocationQuality {
  const bySource = { zip: 0, state_field: 0, address: 0, missing: 0 };
  let withZip = 0, structured = 0;
  for (const e of estimates) {
    const g = bidState(e);
    bySource[g.source ?? "missing"]++;
    if (g.zip) withZip++;
    if ((e.location_state ?? "").trim() || (e.location_zip ?? "").trim()) structured++;
  }
  return { total: estimates.length, withState: estimates.length - bySource.missing, withZip, missing: bySource.missing, bySource, structured };
}

export interface StateFilters { from?: string; to?: string; trade?: string; plan?: "all" | "paid" | "free"; status?: "all" | "finalized" | "draft"; sort?: "bids" | "businesses" | "signed" | "name" }

export interface StateRow { state: string; bids: number; businesses: number; accounts: number; finalized: number; signed: number; completeness: number; topTrades: { trade: string; n: number }[] }
export interface StateReport { rows: StateRow[]; totalBids: number; withState: number; missingState: number; businesses: number; states: number; top: StateRow | null; trades: string[] }

export function stateReport(d: PlatformData, f: StateFilters, now: Date): StateReport {
  const finalized = new Set(d.versions.map((v) => v.estimate_id));
  const signed = new Set(d.signatures.map((s) => s.estimate_id));
  const paidUsers = new Set(d.subscriptions.filter((s) => ACTIVE_SUB.has(s.status)).map((s) => s.user_id));
  for (const g of d.grants) if (g.status === "active" && g.user_id && (!g.expires_at || t(g.expires_at) > now.getTime())) paidUsers.add(g.user_id);
  const from = f.from ? Date.parse(`${f.from}T00:00:00Z`) : -Infinity;
  const to = f.to ? Date.parse(`${f.to}T23:59:59Z`) : Infinity;
  const trades = [...new Set(d.estimates.map(tradeOf))].sort();

  const rows = d.estimates.filter((e) => {
    const c = t(e.created_at);
    if (c < from || c > to) return false;
    if (f.trade && tradeOf(e) !== f.trade) return false;
    if (f.plan === "paid" && !paidUsers.has(e.user_id)) return false;
    if (f.plan === "free" && paidUsers.has(e.user_id)) return false;
    if (f.status === "finalized" && !finalized.has(e.id)) return false;
    if (f.status === "draft" && finalized.has(e.id)) return false;
    return true;
  });

  type Acc = { bids: number; biz: Set<string>; users: Set<string>; fin: number; sig: number; complete: number; trades: Map<string, number> };
  const by = new Map<string, Acc>();
  let missing = 0;
  const allBiz = new Set<string>();
  for (const e of rows) {
    allBiz.add(businessKey(e));
    const g = bidState(e);
    if (!g.state) { missing++; continue; }
    let a = by.get(g.state);
    if (!a) by.set(g.state, (a = { bids: 0, biz: new Set(), users: new Set(), fin: 0, sig: 0, complete: 0, trades: new Map() }));
    a.bids++; a.biz.add(businessKey(e)); a.users.add(e.user_id);
    if (finalized.has(e.id)) a.fin++;
    if (signed.has(e.id)) a.sig++;
    if (g.source === "zip") a.complete++;
    const tr = tradeOf(e); a.trades.set(tr, (a.trades.get(tr) ?? 0) + 1);
  }
  const out: StateRow[] = [...by.entries()].map(([state, a]) => ({
    state, bids: a.bids, businesses: a.biz.size, accounts: a.users.size, finalized: a.fin, signed: a.sig,
    completeness: Math.round((a.complete / a.bids) * 100),
    topTrades: [...a.trades.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([trade, n]) => ({ trade, n })),
  }));
  const sort = f.sort ?? "bids";
  out.sort((x, y) => sort === "name" ? x.state.localeCompare(y.state)
    : sort === "businesses" ? y.businesses - x.businesses || y.bids - x.bids
    : sort === "signed" ? y.signed - x.signed || y.bids - x.bids
    : y.bids - x.bids || y.businesses - x.businesses);
  const top = [...out].sort((x, y) => y.bids - x.bids)[0] ?? null;
  return { rows: out, totalBids: rows.length, withState: rows.length - missing, missingState: missing, businesses: allBiz.size, states: out.length, top, trades };
}

export interface Leader { key: string; label: string; bids: number; finalized: number; signed: number; lastActive: string }

/** Most active businesses by bids created in the window. Labels are pseudonymous unless a name is passed in. */
export function leaderboard(d: PlatformData, now: Date, days: number, names: Map<string, string>, limit = 8): Leader[] {
  const since = now.getTime() - days * DAY;
  const finalized = new Set(d.versions.map((v) => v.estimate_id));
  const signed = new Set(d.signatures.map((s) => s.estimate_id));
  const m = new Map<string, Leader>();
  for (const e of d.estimates) {
    if (t(e.created_at) < since) continue;
    const k = businessKey(e);
    const l = m.get(k) ?? { key: k, label: names.get(k) ?? `No business name · ${k.slice(-4)}`, bids: 0, finalized: 0, signed: 0, lastActive: e.created_at };
    l.bids++; if (finalized.has(e.id)) l.finalized++; if (signed.has(e.id)) l.signed++;
    if (t(e.created_at) > t(l.lastActive)) l.lastActive = e.created_at;
    m.set(k, l);
  }
  return [...m.values()].sort((a, b) => b.bids - a.bids || b.signed - a.signed).slice(0, limit);
}

export interface Overview {
  bidsTotal: number; finalizedBids: number; versions: number; signedBids: number; accounts: number; verifiedAccounts: number; businesses: number;
  freeAccounts: number; sharingAnalytics: number; statesRepresented: number;
  bidsToday: number; bidsWeek: number; bidsMonth: number; finalizedWeek: number; finalizedMonth: number; newAccounts7d: number; newBusinesses7d: number; signed30d: number;
  bidsDelta: ReturnType<typeof delta>; signupsDelta: ReturnType<typeof delta>; finalizedDelta: ReturnType<typeof delta>;
  revenue: Revenue; location: LocationQuality;
  bidsDaily: Point[]; finalizedDaily: Point[]; signedDaily: Point[]; signupsDaily: Point[];
  trades: { trade: string; n: number }[];
  conversion: { finalizedPct: number; signedPct: number; paidPct: number };
}

export function overview(d: PlatformData, now: Date): Overview {
  const firstVersion = new Map<string, string>();
  for (const v of d.versions) { const p = firstVersion.get(v.estimate_id); if (!p || t(v.created_at) < t(p)) firstVersion.set(v.estimate_id, v.created_at); }
  const finalizedDates = [...firstVersion.values()];
  const signedEstimates = new Map<string, string>();
  for (const s of d.signatures) if (!signedEstimates.has(s.estimate_id)) signedEstimates.set(s.estimate_id, s.signed_at);
  const created = d.estimates.map((e) => e.created_at);
  const day = startOfDayUTC(now), week = startOfWeekUTC(now), month = startOfMonthUTC(now);
  const rev = revenue(d, now);
  const loc = locationQuality(d.estimates);
  const businesses = new Set<string>([...d.businesses.filter((b) => b.has_name).map((b) => `u:${b.user_id}`), ...d.companies.map((c) => c.id)]);
  const states = new Set(d.estimates.map((e) => bidState(e).state).filter(Boolean));
  const tradeCounts = new Map<string, number>();
  for (const e of d.estimates) tradeCounts.set(tradeOf(e), (tradeCounts.get(tradeOf(e)) ?? 0) + 1);
  const accounts = Math.max(d.accounts, d.profiles.length);
  const paidOrComp = rev.paidAccounts + rev.compActive;
  return {
    bidsTotal: d.estimates.length, finalizedBids: firstVersion.size, versions: d.versions.length, signedBids: signedEstimates.size,
    accounts, verifiedAccounts: d.verifiedAccounts, businesses: businesses.size,
    freeAccounts: Math.max(0, accounts - paidOrComp), sharingAnalytics: d.consents.filter((c) => c.share_prices).length, statesRepresented: states.size,
    bidsToday: countSince(created, day), bidsWeek: countSince(created, week), bidsMonth: countSince(created, month),
    finalizedWeek: countSince(finalizedDates, week), finalizedMonth: countSince(finalizedDates, month),
    newAccounts7d: countSince(d.profiles.map((p) => p.created_at), now.getTime() - 7 * DAY),
    newBusinesses7d: countSince(d.businesses.filter((b) => b.has_name).map((b) => b.created_at), now.getTime() - 7 * DAY),
    signed30d: countSince([...signedEstimates.values()], now.getTime() - 30 * DAY),
    bidsDelta: delta(created, now, 7), signupsDelta: delta(d.profiles.map((p) => p.created_at), now, 7), finalizedDelta: delta(finalizedDates, now, 7),
    revenue: rev, location: loc,
    bidsDaily: series(created, now, 30, "day"), finalizedDaily: series(finalizedDates, now, 30, "day"),
    signedDaily: series([...signedEstimates.values()], now, 30, "day"), signupsDaily: series(d.profiles.map((p) => p.created_at), now, 30, "day"),
    trades: [...tradeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([trade, n]) => ({ trade, n })),
    conversion: {
      finalizedPct: d.estimates.length ? Math.round((firstVersion.size / d.estimates.length) * 100) : 0,
      signedPct: firstVersion.size ? Math.round((signedEstimates.size / firstVersion.size) * 100) : 0,
      paidPct: accounts ? Math.round((paidOrComp / accounts) * 100) : 0,
    },
  };
}

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Validate the Bids-by-state query string; anything unexpected falls back to the default. */
export function parseStateFilters(sp: SP): StateFilters {
  const pick = <T extends string>(v: string, allowed: readonly T[], d: T): T => ((allowed as readonly string[]).includes(v) ? (v as T) : d);
  return {
    from: DATE.test(one(sp.from)) ? one(sp.from) : undefined,
    to: DATE.test(one(sp.to)) ? one(sp.to) : undefined,
    trade: /^[a-z0-9-]{1,40}$/.test(one(sp.trade)) ? one(sp.trade) : undefined,
    plan: pick(one(sp.plan), ["all", "paid", "free"] as const, "all"),
    status: pick(one(sp.status), ["all", "finalized", "draft"] as const, "all"),
    sort: pick(one(sp.sort), ["bids", "businesses", "signed", "name"] as const, "bids"),
  };
}
