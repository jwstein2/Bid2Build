/**
 * Drilldown helpers for clickable owner KPI cards: turn the raw events behind a count into a short,
 * per-account list (who, how many) for the card's side drawer. Pure functions over already-scoped data,
 * so a drawer can never show an account the report itself excluded (test/internal accounts).
 */
import type { AccountFact } from "./model";

export interface DrillRow { key: string; label: string; detail: string; value: string; href: string }

const inW = (iso: string | null | undefined, w: { start: number; end: number }) => { if (!iso) return false; const t = Date.parse(iso); return t >= w.start && t <= w.end; };

/**
 * Group dated events by account, newest activity first by count. `w` null = all time.
 * Accounts not in `facts` (out of scope) are dropped.
 */
export function byAccount(events: { user_id: string | null | undefined; at: string | null | undefined }[], facts: AccountFact[], w: { start: number; end: number } | null, opts: { unit?: string; includeTest?: boolean; limit?: number } = {}): { rows: DrillRow[]; accounts: number; total: number } {
  const known = new Map(facts.map((f) => [f.id, f]));
  const agg = new Map<string, { n: number; last: string }>();
  let total = 0;
  for (const e of events) {
    if (!e.user_id || !known.has(e.user_id) || !e.at || (w && !inW(e.at, w))) continue;
    total++;
    const a = agg.get(e.user_id);
    if (a) { a.n++; if (e.at > a.last) a.last = e.at; } else agg.set(e.user_id, { n: 1, last: e.at });
  }
  const unit = opts.unit ?? "";
  const rows = [...agg.entries()]
    .sort((a, b) => b[1].n - a[1].n || b[1].last.localeCompare(a[1].last))
    .slice(0, opts.limit ?? 12)
    .map(([id, a]) => {
      const f = known.get(id)!;
      return { key: id, label: f.business ?? f.email ?? "Account", detail: `${f.business && f.email ? `${f.email} · ` : ""}last ${a.last.slice(0, 10)}`, value: `${a.n}${unit ? ` ${unit}` : ""}`, href: `/admin/customers/${id}${opts.includeTest ? "?data=all" : ""}` };
    });
  return { rows, accounts: agg.size, total };
}

/** First occurrence per key (e.g. first finalized version per estimate), keeping its owner. */
export function firstPer<T>(rows: T[], key: (r: T) => string, at: (r: T) => string, user: (r: T) => string | null): { user_id: string | null; at: string }[] {
  const m = new Map<string, { user_id: string | null; at: string }>();
  for (const r of rows) { const k = key(r); const a = at(r); const cur = m.get(k); if (!cur || a < cur.at) m.set(k, { user_id: user(r), at: a }); }
  return [...m.values()];
}
