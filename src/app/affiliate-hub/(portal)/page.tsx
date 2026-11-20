import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/ui/misc";
import { loadAffiliate, loadDashboard } from "@/lib/affiliates/server";
import { kindLabel, summarize, usd } from "@/lib/affiliates/portfolio";
import { affiliateLink } from "@/lib/affiliates/link";
import { PROGRAM } from "@/lib/affiliates/content";
import { CopyLink } from "@/components/affiliates/copy-link";

export const metadata = { title: "Dashboard" };

function Stat({ k, v, hint }: { k: string; v: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
      <p className="text-xs font-semibold uppercase text-muted">{k}</p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums">{v}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export default async function AffiliateDashboard() {
  const access = await loadAffiliate("/affiliate-hub");
  if (access.kind === "affiliate" && access.me.status !== "active" && access.me.status !== "terminated") redirect("/affiliate-hub/onboarding");
  const { dash, me } = await loadDashboard("/affiliate-hub");
  const s = summarize(dash);
  const link = affiliateLink(dash.affiliate.code);
  const blockers = ((dash as { payout?: { blockers?: string[] } }).payout?.blockers ?? []).filter((b) => b !== "affiliate_payouts_off");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold">Hi {(me.display_name ?? me.legal_name ?? "there").split(" ")[0]}</h1>
        <p className="mt-1 text-sm text-ink-soft">{PROGRAM.annual} Forecasts assume each customer keeps paying at today&apos;s value; they&apos;re not guaranteed.</p>
      </div>
      {me.status === "terminated" && <Notice tone="warn">Your affiliate agreement has ended. Commissions already earned are handled as described in your agreement.</Notice>}
      {blockers.length > 0 && <Notice tone="warn" title="Before we can pay you">{blockers.includes("w9_missing") && "Submit your W-9. "}{blockers.includes("no_bank") && "Connect your payout bank account. "}{blockers.includes("bank_change_hold") && "Your new bank account is in its safety hold. "}<Link className="underline" href="/affiliate-hub/profile">Open Profile &amp; payouts</Link></Notice>}

      <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
        <h2 className="font-bold">Your affiliate link</h2>
        <CopyLink value={link} />
        <p className="mt-2 text-xs text-muted">Make campaign links and QR codes on <Link className="underline" href="/affiliate-hub/resources">Resources</Link>. Always disclose that you earn a commission.</p>
      </section>

      <section aria-label="Performance" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat k="Link clicks" v={s.clicks.toLocaleString()} hint={`${dash.clicks.last_30} in the last 30 days`} />
        <Stat k="Referred sign-ups" v={s.referred} hint={`${s.conversion}% of clicks`} />
        <Stat k="Paying customers" v={s.paying} hint={`${s.active} still active`} />
        <Stat k="Canceled" v={s.canceled} />
        <Stat k="Paid to you" v={usd(s.paidCents)} />
        <Stat k="Ready for payout" v={usd(s.payableCents)} />
        <Stat k="In 30-day hold" v={usd(s.pendingCents + s.heldCents)} />
        <Stat k="Forecast, next 12 months" v={usd(s.nextTwelveCents)} hint="If customers keep paying" />
      </section>

      <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-bold">Coming up</h2>
          <Link className="text-sm underline" href="/affiliate-hub/calendar">Open calendar</Link>
        </div>
        {s.upcoming.length === 0 ? <p className="mt-2 text-sm text-ink-soft">No upcoming annual commissions yet. They appear here once a referred customer pays.</p> : (
          <ul className="mt-2 divide-y divide-line">
            {s.upcoming.map((e) => (
              <li key={`${e.key}-${e.year_no}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span><strong>{new Date(`${e.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</strong> · {e.label} · year {e.year_no}</span>
                <span className="tabular-nums">{usd(e.cents)} <span className="text-xs text-muted">{kindLabel(e.kind)}</span></span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-xs text-muted">Total forecast for the rest of your customers&apos; terms: {usd(s.projectedCents)}. {PROGRAM.noGuarantee}</p>
    </div>
  );
}
