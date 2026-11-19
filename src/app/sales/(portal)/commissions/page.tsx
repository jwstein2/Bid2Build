import { Badge, Card, Notice } from "@/components/ui/misc";
import { requireSalesRep } from "@/lib/sales/server";
import { COMMISSION_STATUS, dateLabel, METHOD_LABEL as METHOD, monthLabel, reasonLabel, usd, yearLabel } from "@/lib/sales/format";
import type { RepOverview } from "@/lib/sales/types";

export const metadata = { title: "Commissions" };


export default async function SalesCommissions() {
  const { db } = await requireSalesRep();
  const { data, error } = await db.rpc("sales_my_overview");
  if (error || !data) return <Notice title="Commissions are getting set up">Check back in a little while.</Notice>;
  const o = data as RepOverview;
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold">Commissions</h1>
        <p className="mt-1 text-ink-soft">Every commission line and monthly statement. Amounts are one month of the customer&apos;s subscription, before tax.</p>
      </div>

      <section aria-labelledby="st-h">
        <h2 id="st-h" className="mb-3 text-lg font-bold">Monthly statements</h2>
        {o.statements.length === 0 ? <Card className="p-5 text-ink-soft">Your first statement appears after the month closes on a month you earned a commission.</Card> : (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-line text-left text-muted"><tr><th className="p-3">Month</th><th className="p-3">Lines</th><th className="p-3">Total</th><th className="p-3">Status</th><th className="p-3">Paid</th></tr></thead>
              <tbody>
                {o.statements.map((s) => (
                  <tr key={s.id} className="border-b border-line last:border-0">
                    <td className="p-3 font-semibold">{monthLabel(s.period_month)}</td>
                    <td className="p-3">{s.line_count}</td>
                    <td className="p-3">{usd(s.total_cents)}</td>
                    <td className="p-3"><Badge tone={s.status === "paid" ? "ok" : "brand"}>{s.status === "open" ? "Waiting for approval" : s.status === "approved" ? "Approved" : "Paid"}</Badge></td>
                    <td className="p-3">{s.paid_on ? `${dateLabel(s.paid_on)}${s.method ? ` · ${METHOD[s.method] ?? s.method}` : ""}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      <section aria-labelledby="ln-h">
        <h2 id="ln-h" className="mb-3 text-lg font-bold">Commission lines</h2>
        {o.commissions.length === 0 ? <Card className="p-5 text-ink-soft">No commissions yet. They start when a customer from your link pays for a subscription.</Card> : (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-line text-left text-muted"><tr><th className="p-3">Month</th><th className="p-3">Customer</th><th className="p-3">Type</th><th className="p-3">Amount</th><th className="p-3">Status</th></tr></thead>
              <tbody>
                {o.commissions.map((c) => {
                  const st = COMMISSION_STATUS[c.status] ?? { label: c.status, tone: "neutral" as const, help: "" };
                  return (
                    <tr key={c.id} className="border-b border-line last:border-0">
                      <td className="p-3">{monthLabel(c.period_month)}</td>
                      <td className="p-3"><p className="font-semibold">{c.business ?? c.email ?? "—"}</p>{c.business && <p className="text-xs text-muted">{c.email}</p>}</td>
                      <td className="p-3">{yearLabel(c.year_no, c.kind)}</td>
                      <td className="p-3">{usd(c.amount_cents)}</td>
                      <td className="p-3"><Badge tone={st.tone}>{st.label}</Badge>{c.reason && <p className="mt-1 text-xs text-muted">{reasonLabel(c.reason)}</p>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
        <dl className="mt-3 grid gap-1 text-xs text-muted sm:grid-cols-2">
          {Object.entries(COMMISSION_STATUS).map(([k, s]) => <div key={k}><dt className="inline font-semibold">{s.label}:</dt> <dd className="inline">{s.help}</dd></div>)}
        </dl>
      </section>
    </div>
  );
}
