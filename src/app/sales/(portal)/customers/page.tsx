import { Badge, Card, Notice } from "@/components/ui/misc";
import { requireSalesRep } from "@/lib/sales/server";
import { dateLabel, monthLabel, TIER_LABEL, usd } from "@/lib/sales/format";
import type { RepOverview } from "@/lib/sales/types";

export const metadata = { title: "Customers" };

const STATUS: Record<string, string> = { active: "Active", trialing: "Trial", past_due: "Payment due", canceled: "Canceled", unpaid: "Unpaid", paused: "Paused", incomplete: "Checkout started", incomplete_expired: "Checkout expired" };

/**
 * Customers attributed to this rep. Limited on purpose: business name, contact email, plan and key
 * dates. Never bids, customers, financials or anything else inside the contractor's account.
 */
export default async function SalesCustomers() {
  const { db } = await requireSalesRep();
  const { data, error } = await db.rpc("sales_my_overview");
  if (error || !data) return <Notice title="Customers are getting set up">Check back in a little while.</Notice>;
  const rows = (data as RepOverview).customers;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold">Customers</h1>
        <p className="mt-1 text-ink-soft">Everyone who created an account through your link (or that the owner assigned to you). {rows.length} total.</p>
      </div>
      {rows.length === 0 ? (
        <Card className="p-6 text-ink-soft">No customers yet. Share your link from the Overview page; anyone who signs up through it shows up here.</Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="border-b border-line text-left text-muted">
              <tr><th className="p-3">Business</th><th className="p-3">Plan</th><th className="p-3">Billing</th><th className="p-3">Signed up</th><th className="p-3">First paid</th><th className="p-3">Monthly value</th><th className="p-3">Next anniversary</th></tr>
            </thead>
            <tbody>
              {rows.map((c, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="p-3"><p className="font-semibold">{c.business ?? "—"}</p><p className="text-xs text-muted">{c.email ?? ""}</p>{!c.has_estimate && !c.first_paid_at && <p className="text-xs text-muted">No bid started yet</p>}</td>
                  <td className="p-3"><Badge tone={c.tier === "free" ? "neutral" : c.tier === "trial" ? "accent" : "ok"}>{TIER_LABEL[c.tier] ?? c.tier}</Badge>{c.plan && <span className="ml-1 text-xs text-muted">{c.plan}</span>}</td>
                  <td className="p-3">{c.ended ? "Ended" : c.sub_status ? STATUS[c.sub_status] ?? c.sub_status : "—"}</td>
                  <td className="p-3">{dateLabel(c.signed_up_at)}</td>
                  <td className="p-3">{dateLabel(c.first_paid_at)}</td>
                  <td className="p-3">{c.basis_cents ? usd(c.basis_cents) : "—"}</td>
                  <td className="p-3">{monthLabel(c.next_anniversary)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
