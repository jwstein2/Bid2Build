import Link from "next/link";
import { Card, Notice } from "@/components/ui/misc";
import { ShareLink } from "@/components/sales/share-link";
import { requireSalesRep } from "@/lib/sales/server";
import { repLink } from "@/lib/sales/link";
import { qrFor } from "@/lib/sales/qr";
import { projectedCommissions } from "@/lib/sales/basis";
import { currentMonthChicago, monthLabel, usd } from "@/lib/sales/format";
import type { RepOverview } from "@/lib/sales/types";

export const metadata = { title: "Overview" };

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");

export default async function SalesOverview() {
  const { db } = await requireSalesRep();
  const { data, error } = await db.rpc("sales_my_overview");
  if (error || !data) {
    return <Notice title="Your dashboard is getting set up">Check back in a little while.</Notice>;
  }
  const o = data as RepOverview;
  const link = repLink(o.rep.code);
  const qr = await qrFor(link);
  const sum = (s: string[]) => o.commissions.filter((c) => s.includes(c.status)).reduce((t, c) => t + c.amount_cents, 0);
  const month = currentMonthChicago();
  const projected = o.customers
    .filter((c) => !c.ended && c.first_paid_at && ["active", "trialing", "past_due"].includes(c.sub_status ?? ""))
    .flatMap((c) => projectedCommissions(c.first_paid_at ? `${c.first_paid_at.slice(0, 7)}-01` : null, c.basis_cents, o.policy.commission_years, month));
  const projectedCents = projected.reduce((t, p) => t + p.cents, 0);
  const f = o.funnel;
  const funnel: [string, number, string?][] = [
    ["Link visits", f.visits, `${f.visits_30d} in the last 30 days`],
    ["Free accounts", f.signups, `${pct(f.signups, f.visits)} of visits`],
    ["Started a bid", f.activated, `${pct(f.activated, f.signups)} of accounts`],
    ["Became paying", f.purchased, `${pct(f.purchased, f.signups)} of accounts`],
    ["Paying now", f.paying, f.canceled ? `${f.canceled} canceled` : undefined],
  ];
  const money: [string, number, string][] = [
    ["Pending", sum(["pending"]), "Paid this month; earned when the month closes"],
    ["Earned", sum(["earned", "approved"]), "On a statement, waiting for payout"],
    ["Paid to you", sum(["paid"]), "All time"],
    ["Projected", projectedCents, "Future anniversaries of active customers"],
  ];
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold">Welcome, {o.rep.full_name.split(" ")[0]}</h1>
        <p className="mt-1 text-ink-soft">Share your link. Anyone who signs up through it stays connected to you, even if they buy months later.</p>
      </div>

      <Card className="p-5">
        <h2 className="text-lg font-bold">Your referral link</h2>
        <p className="mb-3 mt-1 text-sm text-ink-soft">This link is permanent. A visit or free signup doesn&apos;t earn a commission by itself; the customer&apos;s paid subscription does.</p>
        <ShareLink link={link} qrSvg={qr.svg} qrDataUrl={qr.png} />
      </Card>

      <section aria-labelledby="funnel-h">
        <h2 id="funnel-h" className="mb-3 text-lg font-bold">Your funnel</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {funnel.map(([k, v, sub]) => (
            <Card key={k} className="p-4"><p className="text-sm text-muted">{k}</p><p className="text-2xl font-extrabold">{v}</p>{sub && <p className="text-xs text-muted">{sub}</p>}</Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="money-h">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 id="money-h" className="text-lg font-bold">Commissions</h2>
          <Link href="/sales/commissions" className="text-sm font-semibold text-brand underline">See every line</Link>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {money.map(([k, v, sub]) => (
            <Card key={k} className="p-4"><p className="text-sm text-muted">{k}</p><p className="text-2xl font-extrabold">{usd(v)}</p><p className="text-xs text-muted">{sub}</p></Card>
          ))}
        </div>
        {projected.length > 0 && (
          <p className="mt-2 text-xs text-muted">Next projected: {monthLabel(projected.map((p) => p.month).sort()[0])}. Projections assume each customer stays on their current plan.</p>
        )}
      </section>

      <Card className="p-5 text-sm text-ink-soft">
        <h2 className="text-base font-bold text-ink">How you&apos;re paid</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>One month of the customer&apos;s subscription (before tax) at the end of the month they first pay.</li>
          <li>The same again in their anniversary month in years 2 and 3, at whatever plan they&apos;re on then (upgrades count).</li>
          <li>Statements are prepared at month end and paid after the owner approves them.</li>
        </ul>
        {!o.policy.confirmed && <p className="mt-3 text-xs">Some payout rules (annual plans and refunds) are being finalized; your commissions are tracked in the meantime.</p>}
      </Card>
    </div>
  );
}
