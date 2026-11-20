import { loadDashboard } from "@/lib/affiliates/server";
import { addYears, canStillEarn, kindLabel, reasonLabel, usd } from "@/lib/affiliates/portfolio";
import { cn } from "@/lib/cn";

export const metadata = { title: "Referral portfolio" };

const STATUS: Record<string, string> = { free: "Signed up, not paying yet", active: "Paying", trialing: "Trial", past_due: "Payment past due", canceled: "Canceled", ended: "No longer attributed", unknown: "Unknown" };

/**
 * Referral portfolio: each referred customer's 10-year timeline. Privacy-safe: customers appear as anonymous labels
 * (with the business's first initial), never names or emails, so affiliates can track performance without
 * exposing customer data.
 */
export default async function Portfolio() {
  const { dash } = await loadDashboard("/affiliate-hub/customers");
  const today = dash.today;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-extrabold">Referral portfolio</h1>
        <p className="mt-1 text-sm text-ink-soft">Customers are shown anonymously to protect their privacy. Each can earn you up to 10 annual commissions, starting with their first payment.</p>
      </div>
      {dash.referrals.length === 0 ? <p className="rounded-xl border border-line bg-surface p-5 text-ink-soft">No referred customers yet. Share your link from the dashboard to get started.</p> : (
        <ul className="space-y-3">
          {dash.referrals.map((r) => {
            const years = r.term_years ?? 10;
            const left = r.eligibility_end_date ? Math.max(0, Math.ceil((Date.parse(r.eligibility_end_date) - Date.parse(today)) / (365.25 * 864e5))) : null;
            return (
              <li key={r.key} className="rounded-xl border border-line bg-surface p-4 shadow-card">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-bold"><span aria-hidden className="mr-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand-tint text-sm text-brand">{r.business_initial}</span>{r.label}</p>
                    <p className="text-sm text-ink-soft">Referred {new Date(r.referred_at).toLocaleDateString()}{r.campaign ? ` · campaign ${r.campaign}` : ""}{r.plan ? ` · ${r.plan} plan` : ""}</p>
                  </div>
                  <div className="text-right text-sm">
                    <p className={cn("font-semibold", canStillEarn(r) ? "text-ok" : "text-ink-soft")}>{r.cancel_requested ? "Set to cancel" : STATUS[r.status] ?? r.status}</p>
                    {r.anniversary_date && <p className="text-xs text-muted">Anniversary {new Date(`${r.anniversary_date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {left} yr{left === 1 ? "" : "s"} left in term</p>}
                  </div>
                </div>
                {r.anniversary_date ? (
                  <ol className="mt-3 grid grid-cols-5 gap-1 sm:grid-cols-10" aria-label={`${r.label} 10-year timeline`}>
                    {Array.from({ length: years }, (_, i) => {
                      const date = addYears(r.anniversary_date!, i);
                      const l = r.lines.find((x) => x.year_no === i + 1);
                      const future = !l && date >= today;
                      const kind = l ? (l.status === "paid" ? "paid" : ["payable", "pending", "held"].includes(l.status) ? "pending" : "not_paid") : future && canStillEarn(r) ? "forecast" : future ? "none" : "not_paid";
                      return (
                        <li key={i} title={l ? `${kindLabel(l.status === "paid" ? "paid" : l.status === "payable" ? "payable" : l.status === "pending" ? "pending" : l.status === "held" ? "held" : "not_paid")}${l.reason ? `: ${reasonLabel(l.reason)}` : ""}` : undefined}
                          className={cn("rounded-md border p-1.5 text-center text-xs", kind === "paid" && "border-ok/30 bg-ok-tint", kind === "pending" && "border-warn/30 bg-warn-tint", kind === "forecast" && "border-dashed border-line-strong", (kind === "not_paid" || kind === "none") && "border-line bg-paper text-muted")}>
                          <span className="block font-semibold">Y{i + 1}</span>
                          <span className="block tabular-nums">{l ? usd(l.amount_cents) : kind === "forecast" ? `~${usd(r.expected_cents ?? 0)}` : "—"}</span>
                          <span className="sr-only">{date}, {kind === "forecast" ? "forecast" : kind === "paid" ? "paid" : kind === "pending" ? "earned, not yet paid" : "not earned"}</span>
                        </li>
                      );
                    })}
                  </ol>
                ) : <p className="mt-2 text-sm text-ink-soft">The 10-year term starts when this customer pays their first subscription invoice.</p>}
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-muted">~ means forecast at today&apos;s value if the customer keeps paying. Not guaranteed.</p>
    </div>
  );
}
