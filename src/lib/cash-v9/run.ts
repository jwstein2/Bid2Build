import "server-only";
/**
 * V9 server steps shared by the Cash flow page and the daily job: evaluate early warnings from a forecast that was
 * computed with the viewer's own (RLS-scoped) data, store them with the service role (fin_cash_alerts_sync is
 * server-only), and keep one forecast snapshot per day for delayed-milestone warnings and accuracy tracking.
 * Only the company's standard view (expected scenario, saved cost mode, no filters, no what-ifs) is ever stored.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateAlerts, type CashAlert } from "./alerts";
import { diffDays } from "./dates";
import type { V9Data, V9Result } from "./engine";

type Row = Record<string, unknown>;

export async function previousSnapshot(db: SupabaseClient, bookId: string, today: string): Promise<Record<string, string>> {
  const { data } = await db.from("fin_forecast_snapshots").select("items, taken_on").eq("book_id", bookId).eq("kind", "daily").lt("taken_on", today).order("taken_on", { ascending: false }).limit(1).maybeSingle();
  const items = ((data as Row | null)?.items ?? []) as { key: string; date: string }[];
  return Object.fromEntries(items.filter((i) => i.key?.startsWith("ms:")).map((i) => [i.key, i.date]));
}

export function alertsFor(v9: V9Result, data: V9Data, base: { invoices: { id: string; number: string; balance: string; dueDate: string | null; customerId: string | null; customerName?: string | null }[] }, today: string, previous: Record<string, string>): CashAlert[] {
  const jobName = new Map(data.jobs.map((j) => [j.jobId, j.jobName]));
  return evaluateAlerts({
    v9, settings: data.settings, today, previous,
    jobs: data.jobs.filter((j) => j.status === "open").map((j) => ({ jobId: j.jobId, jobName: j.jobName, contract: j.contract })),
    commitments: data.commitments.map((c) => ({ id: c.id, jobId: c.jobId, jobName: jobName.get(c.jobId) ?? "Job", title: c.title, vendorName: c.vendorName, original: c.original, current: c.current })),
    openInvoices: base.invoices.filter((i) => Number(i.balance) > 0).map((i) => {
      const h = i.customerId ? data.history[i.customerId] : undefined;
      const o = i.customerId ? data.collectionOverrides[i.customerId] : undefined;
      const usual = o ? (o.basis === "due" ? o.days : 0) : h && h.n >= data.settings.historyMinSample ? h.afterDue : data.settings.collectionBasis === "due" ? data.settings.collectionDays : 0;
      return { id: i.id, number: i.number, customerName: i.customerName ?? null, balance: Number(i.balance), dueDate: i.dueDate, usualDays: usual };
    }),
  });
}

/** Store alerts + today's snapshot with the service role. Returns ids of alerts that are newly open (to notify). */
export async function persist(admin: SupabaseClient, bookId: string, v9: V9Result, alerts: CashAlert[], today: string, assumptions: Row): Promise<string[]> {
  const { data: ids } = await admin.rpc("fin_cash_alerts_sync", { p_book_id: bookId, p_alerts: alerts });
  const f = v9.forecast;
  const items = f.events.slice(0, 2000).map((e) => ({ key: e.key, date: e.date, amount: e.amount, category: e.category, jobId: e.jobId ?? null }));
  await admin.rpc("fin_forecast_snapshot_save", { p_book_id: bookId, p: { takenOn: today, kind: "daily", assumptions,
    summary: { opening: f.opening, end: f.end, totals: f.totals, lowPoint: f.lowPoint, runway: v9.runway, profit: v9.profit }, items } });
  return (ids ?? []) as string[];
}

/** Forecast accuracy: predicted vs actual payment dates for invoices/milestones that have since been paid. */
export function accuracy(snapItems: { key: string; date: string }[], paid: Record<string, string>): { n: number; meanAbsDays: number | null; late: number; early: number } {
  const diffs: number[] = [];
  for (const it of snapItems) {
    const actual = paid[it.key];
    if (actual) diffs.push(diffDays(actual, it.date));
  }
  if (!diffs.length) return { n: 0, meanAbsDays: null, late: 0, early: 0 };
  return { n: diffs.length, meanAbsDays: Math.round((diffs.reduce((a, d) => a + Math.abs(d), 0) / diffs.length) * 10) / 10, late: diffs.filter((d) => d > 0).length, early: diffs.filter((d) => d < 0).length };
}

/** The first predicted date for each invoice across snapshots (oldest snapshot wins), so accuracy measures the early guess. */
export function firstPredictions(snaps: { taken_on: string; items: { key: string; date: string }[] }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of [...snaps].sort((a, b) => a.taken_on.localeCompare(b.taken_on))) {
    for (const it of s.items ?? []) if (it?.key?.startsWith("inv:") && !out[it.key]) out[it.key] = it.date;
  }
  return out;
}

/** Forecast accuracy for the last 120 days: predicted vs actual payment dates of invoices that have since been paid in full. */
export async function loadAccuracy(db: SupabaseClient, bookId: string, today: string) {
  const from = new Date(Date.parse(`${today}T12:00:00Z`) - 120 * 864e5).toISOString().slice(0, 10);
  const { data } = await db.from("fin_forecast_snapshots").select("taken_on, items").eq("book_id", bookId).eq("kind", "daily").gte("taken_on", from).lt("taken_on", today).order("taken_on").limit(120);
  const snaps = ((data ?? []) as Row[]).map((r) => ({ taken_on: String(r.taken_on), items: (r.items ?? []) as { key: string; date: string }[] }));
  if (!snaps.length) return null;
  const pred = firstPredictions(snaps);
  const ids = Object.keys(pred).map((k) => k.slice(4)).slice(0, 500);
  if (!ids.length) return { ...accuracy([], {}), since: snaps[0].taken_on };
  const { data: paidInv } = await db.from("fin_invoice_balances_v").select("invoice_id").in("invoice_id", ids).lte("balance", 0);
  const paidIds = ((paidInv ?? []) as Row[]).map((r) => String(r.invoice_id));
  const { data: allocs } = paidIds.length ? await db.from("fin_payment_allocations").select("invoice_id, created_at").in("invoice_id", paidIds).is("reversed_at", null) : { data: [] };
  const paid: Record<string, string> = {};
  for (const a of (allocs ?? []) as Row[]) { const k = `inv:${a.invoice_id}`; const d = String(a.created_at).slice(0, 10); if (!paid[k] || paid[k] < d) paid[k] = d; }
  return { ...accuracy(Object.entries(pred).map(([key, date]) => ({ key, date })), paid), since: snaps[0].taken_on };
}
