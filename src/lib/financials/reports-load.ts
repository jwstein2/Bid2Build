import "server-only";
/**
 * Read side of company Reports (P&L). The roll-up comes from public.fin_report_pl (needs
 * view_company_financials); drill-down rows come from fin_report_entries_v through the caller's RLS.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissing } from "./loaders";
import { NO_JOB, NO_TRADE, typesOf, type Category, type PlData, type PlRow, type ReportBasis } from "./reports";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const money = (v: unknown) => (typeof v === "number" ? v.toFixed(2) : s(v) || "0.00");

export type PlResult = { ok: true; data: PlData } | { ok: false; reason: "not_installed" | "forbidden" | "error" };

export async function loadPl(db: SupabaseClient, bookId: string, basis: ReportBasis, from: string, to: string): Promise<PlResult> {
  const { data, error } = await db.rpc("fin_report_pl", { p_book_id: bookId, p_basis: basis, p_from: from, p_to: to });
  if (error) return { ok: false, reason: isMissing(error) ? "not_installed" : /forbidden/.test(error.message ?? "") ? "forbidden" : "error" };
  const r = (data ?? {}) as Row;
  const rows = ((r.rows ?? []) as Row[]).map((x): PlRow => ({
    m: s(x.m), job: (x.job as string | null) ?? null, trade: (x.trade as string | null) ?? null, type: (x.type as string | null) ?? null,
    dir: x.dir === "income" ? "income" : "cost", amount: money(x.amount),
  }));
  const jobs = ((r.jobs ?? []) as Row[]).map((j) => ({
    id: s(j.id), estimateId: s(j.estimateId), number: s(j.number), name: s(j.name) || "Project", status: s(j.status),
    customer: (j.customer as string | null) ?? null, trades: Array.isArray(j.trades) ? (j.trades as string[]) : [],
  }));
  const trades = ((r.trades ?? []) as Row[]).map((t) => ({ slug: s(t.slug), name: s(t.name) }));
  return { ok: true, data: { basis, from, to, rows, jobs, trades } };
}

export interface EntryRow { entry_date: string; direction: string; job_id: string | null; trade_slug: string | null; cost_type: string | null; amount: string; source: string; source_id: string; ref: string | null; party: string | null; description: string | null }
export interface EntryFilter { dir?: "income" | "cost"; job?: string; trade?: string; category?: Category; overhead?: boolean; from: string; to: string; jobsInTrade?: string[] }

export const ENTRY_LIMIT = 300;

/** The records behind a number, newest first (capped; the page says when it is). */
export async function loadEntries(db: SupabaseClient, bookId: string, basis: ReportBasis, f: EntryFilter): Promise<{ rows: EntryRow[]; capped: boolean } | null> {
  let q = db.from("fin_report_entries_v")
    .select("entry_date, direction, job_id, trade_slug, cost_type, amount, source, source_id, ref, party, description")
    .eq("book_id", bookId).eq("basis", basis).gte("entry_date", f.from).lte("entry_date", f.to)
    .order("entry_date", { ascending: false }).limit(ENTRY_LIMIT + 1);
  if (f.dir) q = q.eq("direction", f.dir);
  if (f.job) q = f.job === NO_JOB ? q.is("job_id", null) : q.eq("job_id", f.job);
  if (f.overhead === true) q = q.eq("direction", "cost").is("job_id", null);
  if (f.overhead === false) q = q.eq("direction", "cost").not("job_id", "is", null);
  if (f.category) {
    q = q.eq("direction", "cost");
    q = f.category === "uncategorized" ? q.is("cost_type", null) : q.in("cost_type", typesOf(f.category));
  }
  if (f.trade) {
    if (f.dir === "income") {
      // Revenue isn't coded to a trade; show the money in for the projects that include this trade.
      const ids = f.jobsInTrade ?? [];
      // "General" revenue = money in with no project, or for projects with no trade budget.
      if (f.trade === NO_TRADE) q = ids.length ? q.or(`job_id.is.null,job_id.in.(${ids.join(",")})`) : q.is("job_id", null);
      else q = ids.length ? q.in("job_id", ids) : q.eq("job_id", "00000000-0000-0000-0000-000000000000");
    } else {
      q = f.trade === NO_TRADE ? q.is("trade_slug", null) : q.eq("trade_slug", f.trade);
    }
  }
  const { data, error } = await q;
  if (error) return null;
  const rows = ((data ?? []) as Row[]).map((x) => ({ ...(x as unknown as EntryRow), entry_date: s(x.entry_date).slice(0, 10), amount: money(x.amount) }));
  return { rows: rows.slice(0, ENTRY_LIMIT), capped: rows.length > ENTRY_LIMIT };
}
