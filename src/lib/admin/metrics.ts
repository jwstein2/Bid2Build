/**
 * Shared report helpers (time buckets, Bids by state, location coverage). Pure functions over raw platform rows so they are easy to test;
 * src/lib/admin/platform.ts loads the rows (admin only, service role). Nothing here reads or returns
 * bid prices, line items, customer names or addresses: the address is used only to derive a state.
 */
import { bidState, type StateSource } from "@/lib/geo/address";

export interface EstimateRow { id: string; user_id: string; company_id: string | null; trades: string[] | null; template_trade: string | null; status: string | null; created_at: string; location_state: string | null; location_zip: string | null; project_address: string | null }
/** The rows the Bids-by-state report needs (a subset of the owner snapshot). */
export interface StateData {
  estimates: EstimateRow[];
  versions: { estimate_id: string }[];
  signatures: { estimate_id: string }[];
  subscriptions: { user_id: string; status: string }[];
  grants: { user_id: string | null; status: string; expires_at: string | null }[];
}

export const ACTIVE_SUB = new Set(["active", "trialing", "past_due"]);
const DAY = 86_400_000;

export const tradeOf = (e: Pick<EstimateRow, "trades" | "template_trade">) => e.trades?.[0] ?? e.template_trade ?? "other";
/** A "business" is the company for Enterprise members, otherwise the account itself. */
export const businessKey = (e: { company_id: string | null; user_id: string }) => e.company_id ?? `u:${e.user_id}`;

function startOfDayUTC(d: Date) { return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
function startOfWeekUTC(d: Date) { const s = startOfDayUTC(d); const dow = (new Date(s).getUTCDay() + 6) % 7; return s - dow * DAY; }
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


/** Change vs the previous window of the same length, as a whole percent (null when no baseline). */
export function delta(dates: (string | null | undefined)[], now: Date, days: number): { current: number; previous: number; pct: number | null } {
  const end = now.getTime(); const a = end - days * DAY; const b = a - days * DAY;
  let current = 0; let previous = 0;
  for (const d of dates) { const v = t(d); if (v >= a && v <= end) current++; else if (v >= b && v < a) previous++; }
  return { current, previous, pct: previous ? Math.round(((current - previous) / previous) * 100) : null };
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

export function stateReport(d: StateData, f: StateFilters, now: Date): StateReport {
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
