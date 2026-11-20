import Link from "next/link";
import { Badge } from "@/components/ui/misc";
import { Flash, btn, btnSecondary, fmtDate, input } from "@/components/creator/flash";
import { requireAdmin } from "@/lib/admin/server";
import { cn } from "@/lib/cn";
import { usd } from "@/lib/affiliates/portfolio";
import { projectExposure, unitEconomics, type PortfolioRow } from "@/lib/affiliates/analytics";
import { transactionalOn } from "@/lib/affiliates/emails";
import { youtubeConfigured } from "@/lib/affiliates/youtube";
import { agreementLegal, channelVerify, commissionSet, complianceSave, correctionReview, decide, disputeOpen, disputeResolve, invite, prospectEvent, prospectSave, runDaily, setStatus, settingsSave } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Affiliates" };

const TABS = [
  { k: "overview", l: "Overview" }, { k: "affiliates", l: "Affiliates" }, { k: "prospects", l: "Prospects & outreach" }, { k: "corrections", l: "Channel corrections" },
  { k: "commissions", l: "Commissions" }, { k: "payouts", l: "Payouts" }, { k: "disputes", l: "Disputes" }, { k: "compliance", l: "Compliance" }, { k: "settings", l: "Settings" },
];

/* eslint-disable @typescript-eslint/no-explicit-any -- owner report rows are untyped JSON from admin_affiliates_overview() */
type J = Record<string, any>;

const STATUS_TONE: Record<string, "ok" | "warn" | "danger" | "neutral" | "brand"> = { active: "ok", pending_review: "warn", applied: "warn", onboarding: "brand", invited: "brand", suspended: "danger", terminated: "danger", rejected: "neutral" };

function Stat({ k, v, hint }: { k: string; v: string | number; hint?: string }) {
  return <div className="rounded-xl border border-line bg-surface p-4"><p className="text-xs font-semibold uppercase text-muted">{k}</p><p className="mt-1 text-xl font-extrabold tabular-nums">{v}</p>{hint && <p className="mt-1 text-xs text-muted">{hint}</p>}</div>;
}

/**
 * Owner Affiliate CRM (platform super-admin only, inside the existing owner admin). Separate from the Sales Hub lead CRM
 * and from Creator Partnerships. Reads go through admin_affiliates_overview / admin_affiliate_reports (is_admin checked).
 */
export default async function AdminAffiliates({ searchParams }: { searchParams: Promise<{ tab?: string; msg?: string; err?: string; q?: string; status?: string }> }) {
  const { user, db } = await requireAdmin();
  const sp = await searchParams;
  const tab = TABS.some((t) => t.k === sp.tab) ? sp.tab! : "overview";
  const year = new Date().getFullYear();
  const [ov, rep, pros] = await Promise.all([
    db.rpc("admin_affiliates_overview", { p_caller: user.id }),
    db.rpc("admin_affiliate_reports", { p_caller: user.id, p_year: year }),
    tab === "prospects" ? db.rpc("admin_affiliate_prospects", { p_caller: user.id }) : Promise.resolve({ data: [], error: null }),
  ]);
  if (ov.error) {
    return (
      <div className="space-y-3">
        <h1 className="text-3xl font-extrabold">Affiliates</h1>
        <p className="text-ink-soft">The Affiliate Hub tables aren&apos;t installed yet. Run <code className="break-all">supabase/migrations/20270210001000_affiliate_hub.sql</code> in the Supabase SQL Editor, then reload.</p>
      </div>
    );
  }
  const o = ov.data as J, r = (rep.data ?? {}) as J;
  const st = o.settings as J;
  const affiliates = (o.affiliates ?? []) as J[];
  const q = (sp.q ?? "").toLowerCase().slice(0, 80);
  const today = new Date().toISOString().slice(0, 10);
  const exposure = projectExposure((r.portfolio ?? []) as PortfolioRow[], { monthlyChurnBps: st.forecast_monthly_churn_bps ?? 0, annualUpgradeBps: st.forecast_annual_upgrade_bps ?? 0, today });
  const econ = unitEconomics({ revenueYearCents: Number(r.revenue_year_cents ?? 0), paidYearCents: Number(r.paid_year_cents ?? 0), payoutFeesCents: Number(r.payout_fees_cents ?? 0) });
  const pendingReview = affiliates.filter((a) => a.status === "applied" || a.status === "pending_review").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold">Affiliates</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-soft">Affiliate Hub CRM. Public page: <Link className="underline" href="/affiliates">/affiliates</Link>. Affiliates sign in at /affiliate-hub. Separate from the Sales Hub (staff) and Creator Partnerships.</p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <Badge tone={st.payouts_enabled ? "warn" : "neutral"}>Affiliate payouts {st.payouts_enabled ? "ON" : "OFF"}</Badge>
          <Badge tone={st.recruitment_emails ? "warn" : "neutral"}>Recruitment emails {st.recruitment_emails ? "ON" : "OFF"}</Badge>
          <Badge tone={transactionalOn() ? "ok" : "neutral"}>Program emails {transactionalOn() ? "ON" : "OFF (AFFILIATE_EMAILS)"}</Badge>
          <Badge tone={youtubeConfigured() ? "ok" : "neutral"}>YouTube import {youtubeConfigured() ? "ON" : "OFF (YOUTUBE_API_KEY)"}</Badge>
          <Badge tone={o.agreement?.legal_status === "counsel_approved" ? "ok" : "warn"}>Agreement v{o.agreement?.version}: {o.agreement?.legal_status === "counsel_approved" ? "counsel approved" : "draft, pending counsel"}</Badge>
          <Badge tone={st.annual_basis_approved_at ? "ok" : "warn"}>Annual basis: {st.annual_basis}{st.annual_basis_approved_at ? "" : " (awaiting your approval)"}</Badge>
        </div>
      </div>
      <nav aria-label="Affiliate sections" className="flex flex-wrap gap-1 border-b border-line pb-2">
        {TABS.map((t) => (
          <Link key={t.k} href={`?tab=${t.k}`} aria-current={t.k === tab ? "page" : undefined}
            className={cn("inline-flex min-h-10 items-center rounded-md px-3 text-sm font-semibold", t.k === tab ? "bg-ink text-white" : "text-ink-soft hover:bg-black/5")}>
            {t.l}{t.k === "affiliates" && pendingReview > 0 ? ` (${pendingReview})` : t.k === "corrections" && o.corrections.length ? ` (${o.corrections.length})` : t.k === "disputes" && o.disputes.filter((d: J) => d.status === "open").length ? ` (${o.disputes.filter((d: J) => d.status === "open").length})` : ""}
          </Link>
        ))}
      </nav>
      <Flash msg={sp.msg} err={sp.err} />

      {tab === "overview" && (
        <div className="space-y-6">
          <section aria-label="Program" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat k="Active affiliates" v={r.affiliates_total ?? 0} hint={`${r.affiliates_producing ?? 0} with paying referrals`} />
            <Stat k="Referred sign-ups" v={r.referred ?? 0} hint={`${r.referred_paid_ever ?? 0} ever paid · ${r.referred_active ?? 0} active`} />
            <Stat k="Referred MRR (eligible)" v={usd(Number(r.referred_mrr_cents ?? 0))} />
            <Stat k={`Referred revenue ${year}`} v={usd(Number(r.revenue_year_cents ?? 0))} hint="Pre-tax, net of refunds" />
          </section>
          <section aria-label="Cash and liabilities" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat k="Paid (cash, all time)" v={usd(Number(r.paid_cents ?? 0))} hint={`${usd(Number(r.paid_year_cents ?? 0))} in ${year}`} />
            <Stat k="Payable now (liability)" v={usd(Number(r.payable_cents ?? 0))} />
            <Stat k="In 30-day hold" v={usd(Number(r.pending_cents ?? 0))} />
            <Stat k="Held for review" v={usd(Number(r.held_cents ?? 0))} hint={`${r.review_flags ?? 0} flagged after payout`} />
          </section>
          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="text-lg font-bold">10-year commission exposure (forecast, not booked)</h2>
            <p className="mt-1 text-sm text-ink-soft">Active referred customers at today&apos;s eligible value. Worst case assumes every customer pays every remaining year. Expected applies your assumptions: {(st.forecast_monthly_churn_bps / 100).toFixed(1)}% monthly churn, {(st.forecast_annual_upgrade_bps / 100).toFixed(1)}% yearly upgrades (Settings).</p>
            <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat k="Worst case, remaining terms" v={usd(exposure.maxCents)} />
              <Stat k="Expected, remaining terms" v={usd(exposure.expectedCents)} />
              <Stat k={`Commission / revenue ${year}`} v={`${(econ.commissionToRevenueBps / 100).toFixed(1)}%`} />
              <Stat k={`Contribution after commissions ${year}`} v={usd(econ.contributionCents)} hint={`${(econ.contributionMarginBps / 100).toFixed(1)}% margin, incl. ${usd(Number(r.payout_fees_cents ?? 0))} payout fees`} />
            </div>
            {exposure.byYear.length > 0 && (
              <table className="mt-4 w-full text-sm"><caption className="sr-only">Exposure by year</caption>
                <thead><tr className="text-left text-xs text-muted"><th scope="col">Year</th><th scope="col" className="text-right">Worst case</th><th scope="col" className="text-right">Expected</th></tr></thead>
                <tbody>{exposure.byYear.map((y) => <tr key={y.year} className="border-t border-line"><th scope="row" className="py-1 text-left">{y.year}</th><td className="text-right tabular-nums">{usd(y.maxCents)}</td><td className="text-right tabular-nums">{usd(y.expectedCents)}</td></tr>)}</tbody>
              </table>
            )}
          </section>
          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="text-lg font-bold">Cohorts (by first payment month)</h2>
            {(r.cohorts ?? []).length === 0 ? <p className="mt-1 text-sm text-ink-soft">No paying referred customers yet.</p> : (
              <table className="mt-2 w-full text-sm"><thead><tr className="text-left text-xs text-muted"><th scope="col">Cohort</th><th scope="col" className="text-right">Customers</th><th scope="col" className="text-right">Still active</th><th scope="col" className="text-right">Retention</th></tr></thead>
                <tbody>{(r.cohorts as J[]).map((c) => <tr key={c.cohort} className="border-t border-line"><th scope="row" className="py-1 text-left">{c.cohort}</th><td className="text-right">{c.customers}</td><td className="text-right">{c.still_active}</td><td className="text-right">{Math.round((c.still_active / Math.max(1, c.customers)) * 100)}%</td></tr>)}</tbody></table>
            )}
          </section>
          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="text-lg font-bold">Tax reporting ({year})</h2>
            <p className="mt-1 text-sm text-ink-soft">Live affiliate payouts by affiliate, for 1099 preparation with your accountant. Threshold: {r.tax?.threshold ? usd(Number(r.tax.threshold.threshold_cents ?? 0)) : "not set for this year"}.</p>
            <table className="mt-2 w-full text-sm"><thead><tr className="text-left text-xs text-muted"><th scope="col">Affiliate</th><th scope="col">W-9</th><th scope="col">TIN</th><th scope="col" className="text-right">Paid {year}</th></tr></thead>
              <tbody>{((r.tax?.affiliates ?? []) as J[]).map((t) => <tr key={t.affiliate_id} className="border-t border-line"><td className="py-1">{t.name}{t.likely_exempt && <span className="text-xs text-muted"> (corp, likely exempt)</span>}</td><td>{t.w9_status}</td><td>{t.tin_on_file ? "on file" : "missing"}</td><td className="text-right tabular-nums">{usd(Number(t.paid_cents))}</td></tr>)}</tbody></table>
          </section>
        </div>
      )}

      {tab === "affiliates" && (
        <div className="space-y-6">
          <details className="rounded-xl border border-line bg-surface p-4">
            <summary className="cursor-pointer font-bold">Invite an affiliate</summary>
            <form action={invite} className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="text-sm font-semibold">Email<input name="email" type="email" required className={input} /></label>
              <label className="text-sm font-semibold">Name<input name="name" className={input} /></label>
              <label className="text-sm font-semibold sm:col-span-3">Personal note (shown on the invitation)<textarea name="note" rows={2} className={input} /></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="send" />Email the invitation (only if recruitment emails are on)</label>
              <div><button type="submit" className={btn}>Create invitation link</button></div>
            </form>
          </details>
          <form className="flex flex-wrap gap-2"><input type="hidden" name="tab" value="affiliates" /><input name="q" defaultValue={sp.q ?? ""} placeholder="Search name, email, code" className={`${input} max-w-xs`} />
            <select name="status" defaultValue={sp.status ?? ""} className={`${input} max-w-[12rem]`}><option value="">All statuses</option>{["applied", "invited", "onboarding", "pending_review", "active", "suspended", "terminated", "rejected"].map((x) => <option key={x}>{x}</option>)}</select>
            <button className={btnSecondary}>Filter</button></form>
          <ul className="space-y-3">
            {affiliates.filter((a) => (!sp.status || a.status === sp.status) && (!q || `${a.name ?? ""} ${a.email} ${a.code}`.toLowerCase().includes(q))).map((a) => (
              <li key={a.id} className="rounded-xl border border-line bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold">{a.name ?? a.email} <Badge tone={STATUS_TONE[a.status] ?? "neutral"}>{a.status.replace("_", " ")}</Badge> <span className="font-mono text-xs text-muted">{a.code}</span></p>
                    <p className="break-all text-sm text-ink-soft">{a.email} · {a.source} · since {fmtDate(a.created_at)}{a.country && a.country !== "US" ? ` · ${a.country}` : ""}</p>
                    {a.channel && <p className="text-sm">{a.channel.platform}: {a.channel.url ? <a className="underline" href={a.channel.url} target="_blank" rel="noopener noreferrer">{a.channel.title ?? a.channel.url}</a> : a.channel.title} · {a.channel.subscriber_count != null ? `${Number(a.channel.subscriber_count).toLocaleString()} subs (${a.channel.data_source})` : a.channel.self_reported_audience != null ? `${Number(a.channel.self_reported_audience).toLocaleString()} audience (self-reported)` : "no audience data"} · {a.channel.verified ? <span className="text-ok">verified</span> : "unverified"}</p>}
                    <p className="text-xs text-muted">Onboarding: {(a.onboarding.steps as J[]).filter((x) => x.done).length}/7 · W-9 {a.onboarding.w9_status} · bank {a.onboarding.destination ? `••${a.onboarding.destination.last4}` : "none"} · agreement {a.agreement_version ? `v${a.agreement_version}` : "not signed"}</p>
                  </div>
                  <div className="text-right text-sm tabular-nums">
                    <p>{a.clicks} clicks · {a.signups} sign-ups · {a.paying} paying</p>
                    <p>Earned {usd(Number(a.earned_cents))} · pending {usd(Number(a.pending_cents))} · paid {usd(Number(a.paid_cents))}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {["applied", "pending_review", "onboarding", "invited"].includes(a.status) && (
                    <form action={decide} className="flex flex-wrap gap-2"><input type="hidden" name="id" value={a.id} />
                      <input name="reason" placeholder="Note / reason (required to reject)" className={`${input} w-64`} />
                      <button name="decision" value="approve" className={btn}>{a.submitted_at ? "Activate" : "Approve to onboard"}</button>
                      <button name="decision" value="reject" className={btnSecondary}>Reject</button>
                    </form>
                  )}
                  {a.channel && !a.channel.verified && <form action={channelVerify}><input type="hidden" name="id" value={a.id} /><button className={btnSecondary}>Mark channel verified</button></form>}
                  {["active", "suspended"].includes(a.status) && (
                    <details className="w-full"><summary className="cursor-pointer text-sm underline">Suspend, resume or terminate</summary>
                      <form action={setStatus} className="mt-2 flex flex-wrap gap-2"><input type="hidden" name="id" value={a.id} />
                        <select name="status" className={`${input} w-40`}>{a.status === "suspended" ? <option value="active">Resume</option> : <option value="suspended">Suspend</option>}<option value="terminated">Terminate</option></select>
                        <select name="kind" className={`${input} w-56`}><option value="">(termination type)</option><option value="without_cause">Without cause</option><option value="affiliate_resigned">Affiliate resigned</option><option value="material_misconduct">Material misconduct</option></select>
                        <input name="reason" required placeholder="Reason (recorded and sent)" className={`${input} w-64`} />
                        <button className={btnSecondary}>Apply</button>
                      </form>
                      <p className="mt-1 text-xs text-muted">Misconduct holds unpaid commissions for review. Without cause keeps future anniversaries under the current policy ({st.termination_future}), pending counsel.</p>
                    </details>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === "prospects" && (
        <div className="space-y-6">
          <p className="text-sm text-ink-soft">Research creators by hand from public pages (no scraping). Record where any business email came from. Suppressed and do-not-contact prospects can&apos;t be emailed.</p>
          <details className="rounded-xl border border-line bg-surface p-4">
            <summary className="cursor-pointer font-bold">Add a prospect</summary>
            <ProspectForm />
          </details>
          <ul className="space-y-3">
            {((pros.data ?? []) as J[]).map((p) => (
              <li key={p.id} className="rounded-xl border border-line bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-bold">{p.channel_name} <Badge tone={p.status === "do_not_contact" || p.suppressed ? "danger" : p.status === "active" ? "ok" : "neutral"}>{p.suppressed ? "suppressed" : p.status.replace(/_/g, " ")}</Badge></p>
                    <p className="text-sm text-ink-soft">{p.platform}{p.channel_url ? <> · <a className="underline" href={p.channel_url} target="_blank" rel="noopener noreferrer">channel</a></> : null}{p.subscriber_count != null ? ` · ${Number(p.subscriber_count).toLocaleString()} subs` : ""}{p.relevance_score != null ? ` · relevance ${p.relevance_score}` : ""}{p.categories?.length ? ` · ${p.categories.join(", ")}` : ""}</p>
                    <p className="text-sm">{p.contact_name ?? ""} {p.email ? <span className="break-all">{p.email} <span className="text-xs text-muted">(source: {p.email_source})</span></span> : <span className="text-muted">no email</span>}</p>
                    {p.next_action && <p className="text-sm">Next: {p.next_action}{p.next_action_at ? ` by ${p.next_action_at}` : ""}</p>}
                  </div>
                </div>
                <details className="mt-2"><summary className="cursor-pointer text-sm underline">Edit, log activity, invite</summary>
                  <ProspectForm p={p} />
                  <form action={prospectEvent} className="mt-3 flex flex-wrap gap-2"><input type="hidden" name="id" value={p.id} />
                    <select name="kind" className={`${input} w-40`}><option value="note">Note</option><option value="email_sent">Email sent (by hand)</option><option value="reply">Reply received</option><option value="call">Call</option><option value="follow_up">Follow-up</option></select>
                    <input name="body" placeholder="What happened" className={`${input} w-80`} /><button className={btnSecondary}>Log</button></form>
                  {p.email && !p.suppressed && p.status !== "do_not_contact" && (
                    <form action={invite} className="mt-3 flex flex-wrap gap-2"><input type="hidden" name="prospect" value={p.id} /><input type="hidden" name="email" value={p.email} /><input type="hidden" name="name" value={p.contact_name ?? p.channel_name} />
                      <input name="note" placeholder="Personal note" className={`${input} w-80`} /><label className="flex items-center gap-1 text-sm"><input type="checkbox" name="send" />Email it</label><button className={btn}>Create invitation</button></form>
                  )}
                  {(p.events as J[]).length > 0 && <ul className="mt-3 space-y-1 text-xs text-ink-soft">{(p.events as J[]).slice(0, 10).map((e, i) => <li key={i}>{fmtDate(e.created_at, true)} · {e.kind}: {e.body}</li>)}</ul>}
                </details>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === "corrections" && (
        <ul className="space-y-3">
          {o.corrections.length === 0 && <p className="text-sm text-ink-soft">No pending correction requests.</p>}
          {(o.corrections as J[]).map((c) => (
            <li key={c.id} className="rounded-xl border border-line bg-surface p-4">
              <p className="font-bold">{c.affiliate}: {c.field}</p>
              <p className="text-sm">Imported: <span className="font-mono">{c.current_value ?? "—"}</span> → Requested: <span className="font-mono">{c.proposed_value}</span></p>
              {c.note && <p className="text-sm text-ink-soft">“{c.note}”</p>}
              <form action={correctionReview} className="mt-2 flex flex-wrap gap-2"><input type="hidden" name="id" value={c.id} /><input name="note" placeholder="Review note" className={`${input} w-72`} />
                <button name="approve" value="yes" className={btn}>Approve</button><button name="approve" value="no" className={btnSecondary}>Reject</button></form>
            </li>
          ))}
        </ul>
      )}

      {tab === "commissions" && (
        <div className="space-y-3">
          <form action={runDaily}><button className={btnSecondary}>Run the daily ledger job now</button></form>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead><tr className="text-left text-xs text-muted"><th scope="col">Anniversary</th><th scope="col">Affiliate</th><th scope="col">Customer</th><th scope="col">Year</th><th scope="col">Status</th><th scope="col" className="text-right">Amount</th><th scope="col">Basis</th><th scope="col">Action</th></tr></thead>
              <tbody>{(o.commissions as J[]).slice(0, 500).map((c) => (
                <tr key={c.id} className="border-t border-line align-top">
                  <td className="py-1 whitespace-nowrap">{c.anniversary_date}</td><td>{c.affiliate}</td><td className="break-all">{c.email}</td><td>{c.year_no}</td>
                  <td>{c.status}{c.reason ? <span className="block text-xs text-muted">{c.reason}</span> : null}{c.review_flag ? <span className="block text-xs text-warn">{c.review_flag}</span> : null}{c.status === "pending" && c.hold_until ? <span className="block text-xs text-muted">hold until {fmtDate(c.hold_until)}</span> : null}</td>
                  <td className="text-right tabular-nums">{usd(c.amount_cents)}</td>
                  <td className="text-xs text-muted">{c.basis ? `${c.basis.invoice} · pre-tax ${usd(c.basis.pretax_cents)}${c.basis.refunded_cents ? ` − refund ${usd(c.basis.refunded_cents)}` : ""} · ${c.basis.period_months} mo · list ${usd(c.basis.list_divide_cents)}/mo · v${c.policy_version}` : "—"}</td>
                  <td>{c.status !== "paid" && !c.payout_id && (
                    <form action={commissionSet} className="flex gap-1"><input type="hidden" name="id" value={c.id} />
                      <select name="status" className="rounded border border-line px-1 text-xs"><option value="held">Hold</option><option value="pending">Release to pending</option><option value="canceled">Cancel</option></select>
                      <input name="reason" required placeholder="reason" className="w-24 rounded border border-line px-1 text-xs" /><button className="text-xs underline">Save</button></form>
                  )}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "payouts" && (
        <div className="space-y-3">
          <p className="text-sm text-ink-soft">Affiliate payouts use the same ledger, provider, limits and approvals as staff payouts. Approve, pause and reconcile them on <Link className="underline" href="/admin/payouts">Payments</Link>. Affiliate payouts are {st.payouts_enabled ? "ON" : "OFF"}; nothing is sent while payout automation is off or in practice mode.</p>
          <table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted"><th scope="col">Ref</th><th scope="col">Affiliate</th><th scope="col">Status</th><th scope="col">Scheduled</th><th scope="col" className="text-right">Amount</th></tr></thead>
            <tbody>{(o.payouts as J[]).map((p) => <tr key={p.id} className="border-t border-line"><td className="py-1 font-mono text-xs">{p.ref}</td><td>{p.staff_name}</td><td>{p.status}{p.hold_reasons?.length ? <span className="block text-xs text-muted">{p.hold_reasons.join(", ")}</span> : null}</td><td>{p.scheduled_for}</td><td className="text-right tabular-nums">{usd(p.net_cents)}</td></tr>)}</tbody></table>
        </div>
      )}

      {tab === "disputes" && (
        <div className="space-y-4">
          <details className="rounded-xl border border-line bg-surface p-4"><summary className="cursor-pointer font-bold">Open a review for a customer</summary>
            <form action={disputeOpen} className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="text-sm font-semibold">Customer email<input name="email" type="email" required className={input} /></label>
              <label className="text-sm font-semibold">Type<select name="kind" className={input}><option value="attribution">Attribution</option><option value="commission">Commission</option><option value="payout">Payout</option><option value="other">Other</option></select></label>
              <label className="text-sm font-semibold">Raised by<select name="raised_by" className={input}><option value="admin">Owner</option><option value="sales">Sales team</option></select></label>
              <label className="text-sm font-semibold sm:col-span-3">Description<textarea name="description" required rows={2} className={input} /></label>
              <div><button className={btn}>Open review</button></div>
            </form>
          </details>
          <p className="text-xs text-muted">Rule: the verified source recorded first at account creation keeps the customer (sales rep or affiliate). Reassigning never moves commissions already paid; unpaid lines are canceled when a customer moves to Sales or is removed.</p>
          <ul className="space-y-3">{(o.disputes as J[]).map((x) => (
            <li key={x.id} className="rounded-xl border border-line bg-surface p-4">
              <p className="font-bold">{x.kind} · {x.affiliate ?? "no affiliate"} <Badge tone={x.status === "open" ? "warn" : "neutral"}>{x.status}</Badge></p>
              <p className="text-sm text-ink-soft">Raised by {x.raised_by} on {fmtDate(x.created_at)}{x.customer_email ? ` · customer ${x.customer_email}` : x.customer_hint ? ` · ${x.customer_hint}` : ""}</p>
              <p className="text-sm">{x.description}</p>
              {x.resolution && <p className="text-sm text-ok">{x.outcome}: {x.resolution}</p>}
              {x.status === "open" && (
                <form action={disputeResolve} className="mt-2 flex flex-wrap gap-2"><input type="hidden" name="id" value={x.id} />
                  <select name="outcome" className={`${input} w-56`}><option value="kept">Keep as is</option><option value="reassigned_affiliate">Reassign to another affiliate</option><option value="moved_to_sales">Move to a sales rep</option><option value="removed">Remove attribution</option><option value="commission_restored">Restore commission</option><option value="commission_canceled">Cancel commission</option><option value="no_change">No change needed</option></select>
                  <select name="target_affiliate" className={`${input} w-56`}><option value="">(target affiliate)</option>{affiliates.filter((a) => a.status === "active").map((a) => <option key={a.id} value={a.id}>{a.name ?? a.email}</option>)}</select>
                  <input name="target_rep" placeholder="Target sales rep id (for Move to Sales)" className={`${input} w-64`} />
                  <input name="resolution" required placeholder="Decision and reason (recorded)" className={`${input} w-80`} />
                  <button className={btn}>Record decision</button>
                </form>
              )}
            </li>
          ))}</ul>
        </div>
      )}

      {tab === "compliance" && (
        <div className="space-y-4">
          <details className="rounded-xl border border-line bg-surface p-4"><summary className="cursor-pointer font-bold">Record a complaint or violation</summary>
            <form action={complianceSave} className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="text-sm font-semibold">Affiliate<select name="affiliate_id" required className={input}>{affiliates.map((a) => <option key={a.id} value={a.id}>{a.name ?? a.email}</option>)}</select></label>
              <label className="text-sm font-semibold">Type<select name="kind" className={input}>{["undisclosed_relationship", "false_earnings_claim", "misleading_demo", "fabricated_experience", "spam", "trademark", "fraudulent_review", "cookie_stuffing", "self_referral", "other"].map((k) => <option key={k} value={k}>{k.replace(/_/g, " ")}</option>)}</select></label>
              <label className="text-sm font-semibold">Evidence URL<input name="evidence_url" type="url" placeholder="https://" className={input} /></label>
              <label className="text-sm font-semibold">Reported by<input name="reported_by" className={input} /></label>
              <label className="text-sm font-semibold sm:col-span-2">Description<textarea name="description" required rows={2} className={input} /></label>
              <div><button className={btn}>Open case</button></div>
            </form>
          </details>
          <p className="text-xs text-muted">Enforcement path: warning → suspension (commissions held, not forfeited) → termination. Material misconduct holds unpaid commissions for review under the agreement.</p>
          <ul className="space-y-3">{(o.compliance as J[]).map((c) => (
            <li key={c.id} className="rounded-xl border border-line bg-surface p-4">
              <p className="font-bold">{c.affiliate}: {c.kind.replace(/_/g, " ")} <Badge tone={c.status === "open" || c.status === "escalated" ? "warn" : "neutral"}>{c.status.replace("_", " ")}</Badge></p>
              <p className="text-sm">{c.description}{c.evidence_url ? <> · <a className="underline" href={c.evidence_url} target="_blank" rel="noopener noreferrer">evidence</a></> : null}</p>
              {c.action_taken && <p className="text-sm text-ink-soft">Action: {c.action_taken}</p>}
              <form action={complianceSave} className="mt-2 flex flex-wrap gap-2"><input type="hidden" name="id" value={c.id} />
                <select name="status" defaultValue={c.status} className={`${input} w-40`}><option value="open">Open</option><option value="warning_sent">Warning sent</option><option value="escalated">Escalated</option><option value="resolved">Resolved</option></select>
                <input name="action_taken" placeholder="Action taken" className={`${input} w-80`} /><button className={btnSecondary}>Update</button></form>
            </li>
          ))}</ul>
        </div>
      )}

      {tab === "settings" && (
        <div className="space-y-6">
          <form action={settingsSave} className="space-y-4 rounded-xl border border-line bg-surface p-5">
            <h2 className="text-lg font-bold">Program policy</h2>
            <p className="text-sm text-ink-soft">Fixed by the approved spec: one month of eligible paid value, once per eligible year, up to {st.commission_years} years, term never restarts. Changing these settings creates a new policy version; existing commissions keep the version they were created under.</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-sm font-semibold">Annual plan basis<select name="annual_basis" defaultValue={st.annual_basis} className={input}><option value="divide_12">Annual price ÷ 12 (spec default)</option><option value="monthly_list">Monthly list price (Sales Hub rule)</option></select></label>
              <label className="flex items-end gap-2 text-sm"><input type="checkbox" name="approve_annual_basis" />I approve this annual basis{st.annual_basis_approved_at ? ` (approved ${fmtDate(st.annual_basis_approved_at)})` : ""}</label>
              <label className="text-sm font-semibold">Hold days<input name="hold_days" type="number" min={0} max={120} defaultValue={st.hold_days} className={input} /></label>
              <label className="text-sm font-semibold">Anniversary grace days<input name="grace_days" type="number" min={0} max={90} defaultValue={st.grace_days} className={input} /></label>
              <label className="text-sm font-semibold">Attribution window (days)<input name="attribution_window_days" type="number" min={1} max={365} defaultValue={st.attribution_window_days} className={input} /></label>
              <label className="text-sm font-semibold">Minimum payout (USD)<input name="min_payout_dollars" type="number" min={0} step="0.01" defaultValue={(st.min_payout_cents / 100).toFixed(2)} className={input} /></label>
              <label className="text-sm font-semibold">Sign-ups per IP per day before flag<input name="max_signups_per_ip_day" type="number" min={1} max={100} defaultValue={st.max_signups_per_ip_day} className={input} /></label>
              <label className="text-sm font-semibold">Forecast monthly churn %<input name="churn_pct" type="number" min={0} max={100} step="0.1" defaultValue={(st.forecast_monthly_churn_bps / 100).toFixed(1)} className={input} /></label>
              <label className="text-sm font-semibold">Forecast yearly upgrades %<input name="upgrade_pct" type="number" min={0} max={100} step="0.1" defaultValue={(st.forecast_annual_upgrade_bps / 100).toFixed(1)} className={input} /></label>
            </div>
            <div className="space-y-2 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" name="applications_open" defaultChecked={st.applications_open} />Public applications open</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="recruitment_emails" defaultChecked={st.recruitment_emails} />Recruitment emails ON (invitations and follow-ups to prospects; suppressions always respected)</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="confirm" />I confirm this policy{st.policy_confirmed_at ? ` (last confirmed ${fmtDate(st.policy_confirmed_at)})` : ""}</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="payouts_enabled" defaultChecked={st.payouts_enabled} />Affiliate payouts ON (needs confirmed policy; payout automation and live activation on Payments still apply)</label>
            </div>
            <label className="block text-sm font-semibold">Change note<input name="note" placeholder="Why this changed" className={input} /></label>
            <button className={btn}>Save settings</button>
          </form>
          {o.agreement && (
            <section className="rounded-xl border border-line bg-surface p-5">
              <h2 className="text-lg font-bold">Affiliate agreement</h2>
              <p className="text-sm">{o.agreement.title} v{o.agreement.version} · {o.agreement.accepted} accepted · {o.agreement.legal_status === "counsel_approved" ? "counsel approved" : "draft pending counsel"}</p>
              <p className="mt-1 text-xs text-muted">Full text: docs/affiliates/AFFILIATE_AGREEMENT_DRAFT.md. A text change needs a new version (affiliates re-accept).</p>
              <form action={agreementLegal} className="mt-2 flex gap-2"><input type="hidden" name="id" value={o.agreement.id} />
                <select name="status" defaultValue={o.agreement.legal_status} className={`${input} w-64`}><option value="draft_pending_counsel">Draft, pending counsel</option><option value="counsel_approved">Counsel approved</option></select><button className={btnSecondary}>Update</button></form>
            </section>
          )}
          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="text-lg font-bold">Policy versions</h2>
            <ul className="mt-2 space-y-1 text-sm">{(o.policy_versions as J[]).map((v) => <li key={v.version}>v{v.version} · {fmtDate(v.created_at)} · {v.note ?? ""}</li>)}</ul>
          </section>
        </div>
      )}
    </div>
  );
}

function ProspectForm({ p }: { p?: J }) {
  return (
    <form action={prospectSave} className="mt-3 grid gap-3 sm:grid-cols-3">
      {p && <input type="hidden" name="id" value={p.id} />}
      <label className="text-sm font-semibold">Channel name<input name="channel_name" required defaultValue={p?.channel_name ?? ""} className={input} /></label>
      <label className="text-sm font-semibold">Channel URL<input name="channel_url" type="url" defaultValue={p?.channel_url ?? ""} className={input} /></label>
      <label className="text-sm font-semibold">Platform<select name="platform" defaultValue={p?.platform ?? "youtube"} className={input}>{["youtube", "instagram", "tiktok", "facebook", "podcast", "blog", "newsletter", "other"].map((x) => <option key={x}>{x}</option>)}</select></label>
      <label className="text-sm font-semibold">Subscribers<input name="subscriber_count" inputMode="numeric" defaultValue={p?.subscriber_count ?? ""} className={input} /></label>
      <label className="text-sm font-semibold">Categories (comma separated)<input name="categories" defaultValue={(p?.categories ?? []).join(", ")} className={input} /></label>
      <label className="text-sm font-semibold">Primary audience<input name="primary_audience" defaultValue={p?.primary_audience ?? ""} className={input} /></label>
      <label className="text-sm font-semibold">Contact name<input name="contact_name" defaultValue={p?.contact_name ?? ""} className={input} /></label>
      <label className="text-sm font-semibold">Public business email<input name="email" type="email" defaultValue={p?.email ?? ""} className={input} /></label>
      <label className="text-sm font-semibold">Where the email was found<input name="email_source" defaultValue={p?.email_source ?? ""} placeholder="e.g. YouTube About page" className={input} /></label>
      <label className="text-sm font-semibold">Status<select name="status" defaultValue={p?.status ?? "researching"} className={input}>{["researching", "qualified", "contacted", "follow_up", "interested", "invited", "onboarding", "active", "declined", "do_not_contact"].map((x) => <option key={x} value={x}>{x.replace(/_/g, " ")}</option>)}</select></label>
      <label className="text-sm font-semibold">Relevance (0-100)<input name="relevance_score" type="number" min={0} max={100} defaultValue={p?.relevance_score ?? ""} className={input} /></label>
      <label className="text-sm font-semibold">Next action date<input name="next_action_at" type="date" defaultValue={p?.next_action_at ?? ""} className={input} /></label>
      <label className="text-sm font-semibold sm:col-span-3">Next action<input name="next_action" defaultValue={p?.next_action ?? ""} className={input} /></label>
      <label className="text-sm font-semibold sm:col-span-3">Notes<textarea name="notes" rows={2} defaultValue={p?.notes ?? ""} className={input} /></label>
      <div><button className={btn}>{p ? "Save prospect" : "Add prospect"}</button></div>
    </form>
  );
}
