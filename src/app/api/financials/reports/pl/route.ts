import { fail } from "@/lib/http/api";
import { finGuard } from "@/lib/financials/api";
import { csvCell } from "@/lib/financials/csv";
import { loadPl } from "@/lib/financials/reports-load";
import { BASIS_LABELS, bucketsBetween, byJob, byTrade, grainFor, statement, bucketLabel, type ReportBasis } from "@/lib/financials/reports";

export const runtime = "nodejs";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Company Profit & Loss (CSV): the statement by period, then profit by project and by trade, for the same
 * basis and dates as the Reports page. Needs view_company_financials (in the SQL) and export_financials.
 */
export async function GET(req: Request) {
  const g = await finGuard({ write: false, limitKey: "fin-report-pl", limit: 60 });
  if ("error" in g) return g.error;
  const u = new URL(req.url);
  const basis: ReportBasis = u.searchParams.get("basis") === "billed" ? "billed" : "cash";
  const from = u.searchParams.get("from") ?? "", to = u.searchParams.get("to") ?? "";
  if (!DAY.test(from) || !DAY.test(to) || to < from) return fail(400, "bad_range", "Pick a valid date range.");
  const { db, bookId } = g;
  const { data: allowed } = await db.rpc("fin_has_permission", { p_book_id: bookId, p_key: "export_financials", p_write: false });
  if (!allowed) return fail(403, "forbidden", "Your financial role can't export reports.");
  // Audited when the Accountant Mode SQL (20261213001000) is installed; before that the export still works.
  await db.rpc("fin_export_log", { p_book_id: bookId, p_kind: "profit_loss", p_filters: { basis, from, to } });
  const res = await loadPl(db, bookId, basis, from, to);
  if (!res.ok) return res.reason === "forbidden" ? fail(403, "forbidden", "Company reports need a company financial role.") : fail(503, res.reason, "Reports aren't available yet.");
  const { rows, jobs, trades } = res.data;
  const grain = grainFor(from, to);
  const buckets = bucketsBetween(from, to, grain);
  const out: unknown[][] = [
    ["Profit & Loss", `${from} to ${to}`, BASIS_LABELS[basis]], ["Management report from recorded records; not a CPA accrual statement"], [],
    ["Line", ...buckets.map((b) => bucketLabel(b, grain)), "Total"],
    ...statement(rows, buckets, grain).map((l) => [l.indent ? `  ${l.label}` : l.label, ...buckets.map((b) => l.cells[b] ?? "0.00"), l.total]), [],
    ["Project", "Number / customer", "Revenue", "Costs", "Profit", "Margin %"],
    ...byJob(rows, jobs).map((r) => [r.label, r.sub ?? "", r.revenue, r.costs, r.profit, r.marginPct ?? ""]), [],
    ["Trade (revenue split by estimated cost per trade; overhead excluded)", "", "Revenue", "Costs", "Profit", "Margin %"],
    ...byTrade(rows, trades).map((r) => [r.label, "", r.revenue, r.costs, r.profit, r.marginPct ?? ""]),
  ];
  const csv = out.map((r) => r.map(csvCell).join(",")).join("\r\n");
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="Profit_and_Loss_${basis}_${from}_${to}.csv"`, "cache-control": "private, no-store" } });
}
