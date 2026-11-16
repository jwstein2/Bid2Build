import Link from "next/link";
import { notFound } from "next/navigation";
import { Chip, PageHead, Panel, Row, Table, ago, day, fmt, usd } from "@/components/admin/cc";
import { ReportUnavailable } from "@/components/admin/report";
import { CHANNEL_LABEL } from "@/lib/admin/channels";
import { CLASS_LABEL } from "@/lib/admin/classify";
import { planText } from "@/lib/admin/customers";
import { SEGMENTS, grantState, monthlyCents } from "@/lib/admin/model";
import { loadReport } from "@/lib/admin/load";
import { tradeName } from "@/lib/trades/catalog";
import { tradeOf } from "@/lib/admin/metrics";
import { bidState } from "@/lib/geo/address";
import { str } from "@/lib/admin/view";
import { setAccountLabel } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account" };

const ts = (s: string | null | undefined) => (s ? Date.parse(s) : 0);

export default async function Account({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sp = await searchParams;
  // The account page always loads every account type so internal/test accounts can be reviewed and relabeled.
  const { r, error } = await loadReport({ ...sp, data: "all" });
  if (!r) return <ReportUnavailable error={error} />;
  const f = r.facts.find((x) => x.id === id);
  if (!f) notFound();
  const d = r.snap; const nowMs = r.now.getTime();
  const est = d.estimates.filter((e) => e.user_id === id);
  const finalizedIds = new Set(d.versions.filter((v) => v.user_id === id).map((v) => v.estimate_id));
  const signedIds = new Set(d.signatures.filter((s) => s.user_id === id).map((s) => s.estimate_id));
  const requests = d.signingRequests.filter((x) => x.user_id === id);
  const subs = d.subscriptions.filter((s) => s.user_id === id).sort((a, b) => ts(b.updated_at) - ts(a.updated_at));
  const grants = d.grants.filter((g) => g.user_id === id || (f.email && g.email === f.email.toLowerCase())).sort((a, b) => ts(b.created_at) - ts(a.created_at));
  const outbox = d.outbox.filter((o) => o.user_id === id);
  const lead = d.leads.find((l) => l.user_id === id);
  const label = d.labels.find((l) => l.user_id === id);
  const seg = SEGMENTS.find((s) => s.key === f.segment)!;
  const overlap = f.paying && f.comp;
  const timeline = [
    { at: f.createdAt, what: "Account created" },
    ...(f.confirmed ? [] : [{ at: f.createdAt, what: "Email not verified yet" }]),
    ...est.map((e) => ({ at: e.created_at, what: `Bid started · ${tradeName(tradeOf(e))}${bidState(e).state ? ` · ${bidState(e).state}` : ""}` })),
    ...d.versions.filter((v) => v.user_id === id).map((v) => ({ at: v.created_at, what: `Bid finalized (version ${v.version_number})` })),
    ...requests.map((x) => ({ at: x.created_at, what: `Sent for signature · ${x.status}` })),
    ...d.signatures.filter((s) => s.user_id === id).map((s) => ({ at: s.signed_at, what: "Proposal signed by the homeowner" })),
    ...(f.paidStartedAt ? [{ at: f.paidStartedAt, what: "Paid subscription started" }] : []),
    ...(f.paidEndedAt ? [{ at: f.paidEndedAt, what: "Paid subscription ended" }] : []),
    ...grants.map((g) => ({ at: g.created_at, what: `Complimentary ${g.plan} granted (${g.status})` })),
  ].sort((a, b) => ts(b.at) - ts(a.at)).slice(0, 25);

  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/admin/customers" className="text-ink-soft underline">Customers</Link> <span className="text-muted">/ account</span></p>
      <PageHead kicker={`${CLASS_LABEL[f.cls]} · ${seg.label}`} title={f.business ?? f.email ?? "Account"} intro={f.business ? f.email ?? undefined : undefined}
        right={<div className="flex flex-wrap gap-2"><Chip tone={f.cls === "genuine" ? "green" : "amber"}>{f.cls}</Chip><Chip tone={f.paying ? (f.pastDue ? "red" : "green") : f.comp ? "violet" : "muted"}>{planText(f)}</Chip></div>} />

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel kicker="Account" title="Sign-in and company">
          <dl>
            <Row k="Email">{f.email ?? "–"}</Row>
            <Row k="Email verified">{f.confirmed ? "Yes" : <span className="text-[var(--cc-amber)]">No</span>}</Row>
            <Row k="Signed up">{day(f.createdAt)}</Row>
            <Row k="Last sign-in">{f.lastSignIn ? ago(f.lastSignIn, nowMs) : "–"}</Row>
            <Row k="Company">{f.business ?? "–"}{f.companyRole ? ` · ${f.companyRole}` : ""}</Row>
            <Row k="Account id"><span className="text-[11px] text-muted">{f.id}</span></Row>
          </dl>
          {!f.confirmed && <p className="mt-2 text-xs text-[var(--cc-amber)]">Never verified: they may not have received the sign-in email. Check Supabase → Logs → Auth for this address.</p>}
        </Panel>

        <Panel kicker="Entitlement" title="Plan and access">
          <dl>
            <Row k="Paid subscription">{f.sub ? `${f.sub.plan ?? "–"} · ${f.sub.status}` : "None"}</Row>
            {f.sub && <Row k="List-price MRR">{f.paying ? usd(monthlyCents(f.sub)) : "–"}</Row>}
            {f.sub?.current_period_end && <Row k="Current period ends">{day(f.sub.current_period_end)}</Row>}
            {f.sub?.cancel_at_period_end && <Row k="Scheduled to cancel"><span className="text-[var(--cc-amber)]">At period end</span></Row>}
            {f.sub?.plan === "enterprise" && <Row k="Licensed seats">{fmt(Math.max(3, f.sub.seat_quantity ?? 3))}</Row>}
            <Row k="Complimentary">{f.comp ? `${f.comp.plan} until ${day(f.comp.expires_at)}` : "None active"}</Row>
            {f.comp?.plan === "enterprise" && <Row k="Comp seats">{3 + (f.comp.extra_seats ?? 0)} (3 included{f.comp.extra_seats ? ` + ${f.comp.extra_seats} owner-approved` : ""})</Row>}
          </dl>
          {overlap && <p className="mt-2 text-xs text-ink-soft">Both a paid plan and a complimentary grant: the paid subscription stays in force and keeps billing; the grant never cancels or replaces it. Reports count this account as paying, not complimentary.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={`/admin/complimentary?email=${encodeURIComponent(f.email ?? "")}#grant`} className="cc-mono rounded-md bg-[var(--cc-green)] px-2.5 py-1.5 text-xs font-bold text-[#03140c]">Grant access</Link>
            {grants.length > 0 && <Link href={`/admin/complimentary?q=${encodeURIComponent(f.email ?? "")}`} className="cc-mono rounded-md border border-[var(--cc-line-strong)] px-2.5 py-1.5 text-xs text-ink-soft hover:text-white">Extend / revoke</Link>}
          </div>
        </Panel>

        <Panel kicker="Usage" title="Adoption">
          <dl>
            <Row k="Bids started">{fmt(f.estimates)}</Row>
            <Row k="Finalized">{fmt(f.finalized)}</Row>
            <Row k="Sent for signature">{fmt(f.signingRequests)}</Row>
            <Row k="Signed by homeowner">{fmt(f.signed)}</Row>
            <Row k="First bid">{day(f.firstEstimateAt)}</Row>
            <Row k="Activated (first finalized)">{day(f.firstFinalizedAt)}</Row>
            <Row k="Last bid action">{f.lastActivityAt ? ago(f.lastActivityAt, nowMs) : "–"}</Row>
          </dl>
          <p className="mt-2 text-xs text-muted">{seg.def}.</p>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel kicker="Acquisition" title="First touch">
          <dl>
            <Row k="Channel">{CHANNEL_LABEL[f.channel]}</Row>
            <Row k="Campaign">{f.campaign ?? "–"}</Row>
            <Row k="Landing page">{lead?.landing_path ?? "–"}</Row>
            <Row k="Referrer">{lead?.referrer_host && lead.referrer_host !== "(none)" ? lead.referrer_host : "–"}</Row>
            <Row k="UTM source / medium">{lead?.utm_source || lead?.utm_medium ? `${lead?.utm_source ?? "–"} / ${lead?.utm_medium ?? "–"}` : "–"}</Row>
            <Row k="Device">{f.device ?? "–"}</Row>
          </dl>
        </Panel>

        <Panel kicker="Support" title="Delivery and billing records">
          <dl>
            {subs.length === 0 && <Row k="Subscriptions">None</Row>}
            {subs.map((s) => <Row key={s.stripe_subscription_id} k={`Stripe ${s.plan ?? "sub"}`}>{s.status}{s.ended_at ? ` · ended ${day(s.ended_at)}` : ""}</Row>)}
            {outbox.map((o) => <Row key={o.kind} k={o.kind.replace("_", " ")}><span className={o.status === "failed" ? "text-[var(--cc-red)]" : ""}>{o.status}{o.attempts ? ` · ${o.attempts} attempt${o.attempts === 1 ? "" : "s"}` : ""}</span></Row>)}
          </dl>
          {outbox.some((o) => o.last_error && o.status === "failed") && <p className="mt-2 text-xs text-[var(--cc-red)]">Last email error: {outbox.find((o) => o.status === "failed")?.last_error}</p>}
        </Panel>

        <Panel kicker="Reporting" title="Account type">
          {str(sp.label_saved) && <p role="status" className="mb-2 text-xs text-[var(--cc-green)]">Saved. Reports now use this type.</p>}
          {str(sp.label_error) && <p role="alert" className="mb-2 text-xs text-[var(--cc-red)]">{str(sp.label_error)}</p>}
          <p className="text-sm text-ink-soft">Currently <span className="font-semibold text-white">{CLASS_LABEL[f.cls]}</span> · {f.clsReason}.</p>
          <form action={setAccountLabel} className="mt-3 grid gap-2">
            <input type="hidden" name="id" value={f.id} />
            <label className="text-xs"><span className="cc-kicker mb-1 block">Classify as</span>
              <select name="label" defaultValue={label?.label ?? "auto"} className="field field-sm">
                <option value="auto">Automatic (rules)</option><option value="genuine">Genuine customer</option><option value="internal">Internal (owner/staff)</option><option value="test">Test</option><option value="demo">Demo</option>
              </select></label>
            <label className="text-xs"><span className="cc-kicker mb-1 block">Note (optional)</span><input name="note" maxLength={300} defaultValue={label?.note ?? ""} className="field field-sm" /></label>
            <button type="submit" className="cc-mono justify-self-start rounded-md border border-[var(--cc-line-strong)] px-3 py-1.5 text-xs text-white hover:border-[var(--cc-green)]">Save type</button>
          </form>
          <p className="mt-2 text-xs text-muted">Only changes which reports count this account. It never touches their login, plan, grants, billing or bids. Audited.</p>
        </Panel>
      </div>

      <Panel kicker="Timeline" title="Recent account events">
        {timeline.length === 0 ? <p className="text-sm text-ink-soft">No events.</p> : (
          <Table head={["When", "Event"]} minWidth={420}>
            {timeline.map((e, i) => <tr key={i}><td className="whitespace-nowrap text-ink-soft">{day(e.at)} <span className="text-muted">({ago(e.at, nowMs)})</span></td><td className="font-sans text-white">{e.what}</td></tr>)}
          </Table>
        )}
        <p className="mt-2 text-xs text-muted">Bid titles, homeowner details and prices are intentionally not shown. {est.length ? `${finalizedIds.size} of ${est.length} bids finalized, ${signedIds.size} signed.` : ""}</p>
      </Panel>

      {grants.length > 0 && (
        <Panel kicker="Complimentary access" title="Grant history">
          <Table head={["Granted", "Plan", "Status", "Starts", "Expires", "Note"]} minWidth={640}>
            {grants.map((g) => <tr key={g.id}><td>{day(g.created_at)}</td><td className="font-sans">{g.plan}</td><td><Chip tone={grantState(g, nowMs) === "active" ? "green" : grantState(g, nowMs) === "revoked" ? "red" : "amber"}>{grantState(g, nowMs)}</Chip></td><td>{day(g.starts_at)}</td><td>{day(g.expires_at)}</td><td className="max-w-[16rem] truncate font-sans text-ink-soft">{g.note ?? "–"}</td></tr>)}
          </Table>
        </Panel>
      )}
    </div>
  );
}
