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
