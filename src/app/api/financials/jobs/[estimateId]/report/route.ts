import { fail } from "@/lib/http/api";
import { finGuard } from "@/lib/financials/api";
import { csvCell } from "@/lib/financials/csv";

export const runtime = "nodejs";
type Row = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/**
 * Internal job financial report (CSV): the Project Financials summary, budget vs forecast vs actual by cost
 * code, invoices and payments. Contractor-only (RLS on every view) and never shared with the customer.
 * Downloading needs export_financials.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ estimateId: string }> }) {
  const g = await finGuard({ write: false, limitKey: "fin-job-report", limit: 60 });
  if ("error" in g) return g.error;
  const { estimateId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(estimateId)) return fail(404, "not_found", "Not found.");
  const { db, bookId } = g;
  const { data: allowed } = await db.rpc("fin_has_permission", { p_book_id: bookId, p_key: "export_financials", p_write: false });
  if (!allowed) return fail(403, "forbidden", "Your financial role can't export reports.");
  const { data: job } = await db.from("fin_jobs").select("id, job_number, name").eq("estimate_id", estimateId).eq("book_id", bookId).maybeSingle();
  if (!job) return fail(404, "not_found", "No job financials for this project.");
  const jid = s((job as Row).id);
  const [{ data: sm }, { data: budget }, { data: invoices }, { data: payments }] = await Promise.all([
    db.from("fin_job_summary_v").select("*").eq("job_id", jid).maybeSingle(),
    db.from("fin_job_budget_v").select("cost_code_name, estimated, committed, actual, forecast").eq("job_id", jid),
    db.from("fin_invoice_balances_v").select("number, kind, status, issue_date, due_date, total, paid, credited, balance, days_overdue").eq("job_id", jid).neq("status", "draft").order("issue_date"),
    db.from("fin_payment_balances_v").select("number, received_on, method, amount, applied, unapplied, verified, status").eq("job_id", jid).order("received_on"),
  ]);
  const S = (sm ?? {}) as Row;
  const out: unknown[][] = [
    [`Job ${s((job as Row).job_number)}`, s((job as Row).name)], ["Internal report: not for customers"], [],
    ["Summary", "Amount", "Basis"],
    ["Approved contract", S.contract_value, "Contracted"], ["Original contract", S.original_contract, "Contracted"], ["Approved changes", S.contract_changes, "Contracted"],
    ["Original estimated cost", S.original_estimated_cost, "Estimated"], ["Current forecast cost", S.forecast_cost, "Forecast"],
    ["Actual cost", S.actual_cost, "Actual"], ["Open committed cost", S.committed_cost, "Committed"],
    ["Invoiced to date", S.invoiced, "Invoiced"], ["Collected to date", S.collected, "Paid"], ["Outstanding AR", S.outstanding_ar, "Outstanding"],
    ["Approved but unbilled", S.unbilled, "Contracted"], ["Forecast gross profit", S.forecast_profit, "Forecast"], ["Forecast gross margin %", S.forecast_margin_pct, "Forecast"],
    ["Pending change orders (not in contract)", S.pending_changes, "Pending"], ["Unpaid vendor/sub bills", S.unpaid_bills, "Outstanding"], [],
    ["Cost code", "Estimated", "Committed", "Actual", "Forecast", "Variance (estimate - forecast)"],
    ...((budget ?? []) as Row[]).map((b) => [b.cost_code_name ?? "Uncoded", b.estimated, b.committed, b.actual, b.forecast, (Number(b.estimated) - Number(b.forecast)).toFixed(2)]), [],
    ["Invoice", "Type", "Status", "Issued", "Due", "Total", "Paid", "Credited", "Balance", "Days overdue"],
    ...((invoices ?? []) as Row[]).map((i) => [i.number, i.kind, i.status, i.issue_date, i.due_date, i.total, i.paid, i.credited, i.balance, i.days_overdue]), [],
    ["Payment", "Received", "Method", "Amount", "Applied", "Unapplied", "Verified", "Status"],
    ...((payments ?? []) as Row[]).map((p) => [p.number, p.received_on, p.method, p.amount, p.applied, p.unapplied, p.verified ? "yes" : "no", p.status]),
  ];
  const csv = out.map((r) => r.map(csvCell).join(",")).join("\r\n");
  const name = `Job_${s((job as Row).job_number).replace(/[^\w-]/g, "")}_financials.csv`;
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "private, no-store" } });
}
