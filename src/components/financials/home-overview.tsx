/**
 * Financials home: the circle-chart overview (QuickBooks-dashboard style). Invoices paid / not due / overdue
 * for the last 365 days, and, for company financial roles, where the money went and the profit kept so far
 * this year (cash basis, from fin_report_pl). Every slice opens its records. Reads through the caller's RLS.
 */
import { createClient } from "@/lib/supabase/server";
import { loadPl } from "@/lib/financials/reports-load";
import { periodRange, totalsOf } from "@/lib/financials/reports";
import { costSlices, daysAgo, invoiceSlices, revenueSlices, type InvoiceRow } from "@/lib/financials/donuts";
import { formatCurrency } from "@/lib/estimate/money";
import { DonutCard } from "./donut";

export async function HomeOverview({ bookId, company }: { bookId: string; company: boolean }) {
  const db = await createClient();
  const since = daysAgo(365);
  const ytd = periodRange("ytd");
  const [{ data: inv }, pl] = await Promise.all([
    db.from("fin_ar_invoices_v").select("total, paid, credited, balance, days_overdue").eq("book_id", bookId).gte("issue_date", since),
    company ? loadPl(db, bookId, "cash", ytd.from, ytd.to) : Promise.resolve(null),
  ]);
  const invoices = invoiceSlices((inv ?? []) as InvoiceRow[], {
    paid: "/financials/receivables?bucket=paid", open: "/financials/receivables?bucket=current", overdue: "/financials/receivables?bucket=overdue",
  });
  const rep = (q: string) => `/financials/reports?period=ytd&${q}&show=records#records`;
  const rows = pl && pl.ok ? pl.data.rows : null;
  const t = rows ? totalsOf(rows) : null;
  const costs = rows ? costSlices(rows, (c) => rep(`dir=cost&cat=${c}`), rep("dir=cost")) : null;
  const rev = t ? revenueSlices(t, { jobCosts: rep("dir=cost&oh=0"), overhead: rep("dir=cost&oh=1"), profit: "/financials/reports?period=ytd&view=jobs" }) : null;
  const overdue = invoices.slices.find((s) => s.key === "overdue");

  return (
    <section aria-labelledby="fin-overview-h" data-guide="fin.overview" data-testid="fin-overview">
      <h2 id="fin-overview-h" className="mb-2 font-display text-lg font-extrabold">Overview</h2>
      <div className={`grid gap-3 ${t ? "lg:grid-cols-3 md:grid-cols-2" : "md:grid-cols-2"}`}>
        <DonutCard testId="fin-donut-invoices" title="Invoices · last 365 days" slices={invoices.slices} total={invoices.total} centerSub="invoiced"
          empty="No issued invoices in the last year." action={{ label: "Receivables", href: "/financials/receivables" }}
          footer={overdue ? <span className="font-semibold text-danger">{formatCurrency(overdue.amount)} is past due.</span> : "Paid includes credits applied."} />
        {t && costs && (
          <DonutCard testId="fin-donut-costs" title="Where the money goes · this year" slices={costs.slices} total={costs.total} centerSub="spent"
            empty="No bills paid or expenses yet this year." action={{ label: "Profit & Loss", href: "/financials/reports?period=ytd" }} footer="Cash paid out, by type." />
        )}
        {t && (
          <DonutCard testId="fin-donut-profit" title="Profit · this year" slices={rev?.slices ?? []} total={rev?.total ?? "0"}
            center={t.netMarginPct ? `${t.netMarginPct}%` : undefined} centerSub="net margin"
            empty="No payments received yet this year." action={{ label: "By project", href: "/financials/reports?period=ytd&view=jobs" }}
            footer={rev?.loss ? <span className="font-semibold text-danger">Net loss of {formatCurrency(rev.loss)} so far.</span> : `${formatCurrency(t.revenue)} received · ${formatCurrency(t.netProfit)} kept`} />
        )}
      </div>
    </section>
  );
}
