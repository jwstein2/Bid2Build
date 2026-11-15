import Link from "next/link";
import { Chip, PageHead, Panel, Row, Table, ago, fmt, type Tone } from "@/components/admin/cc";
import { ReportUnavailable, ScopeNote, SectionTitle } from "@/components/admin/report";
import { TOOLS } from "@/components/admin/nav";
import { integrationStatus, type IntegrationState } from "@/lib/admin/integrations";
import { locationQuality } from "@/lib/admin/metrics";
import { loadReport } from "@/lib/admin/load";
import { href } from "@/lib/admin/view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Operations" };

const STATE: Record<IntegrationState, { tone: Tone; label: string }> = { ok: { tone: "green", label: "OK" }, warn: { tone: "amber", label: "Check" }, missing: { tone: "red", label: "Missing" }, not_connected: { tone: "muted", label: "Not connected" } };

export default async function Operations({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { r, error, view } = await loadReport(await searchParams);
  if (!r) return <ReportUnavailable error={error} />;
  const { facts, sc, snap, now } = r;
  const nowMs = now.getTime();
  const d = sc.d;
  const integrations = integrationStatus(snap);
  const hookErrors = snap.stripeEvents.filter((e) => e.error);
  const unprocessed = snap.stripeEvents.filter((e) => !e.processed_at && !e.error && Date.parse(e.received_at) < nowMs - 3_600_000);
  const sigPdfFailed = d.signatures.filter((s) => s.pdf_status === "failed").length;
  const outboxFailed = d.outbox.filter((o) => o.status === "failed");
  const outboxPending = d.outbox.filter((o) => o.status === "pending").length;
  const unverified = facts.filter((f) => !f.confirmed && Date.parse(f.createdAt) < nowMs - 86_400_000);
  const loc = locationQuality(d.estimates);
  const coverage = loc.total ? Math.round((loc.withState / loc.total) * 100) : null;
  const unknown = facts.filter((f) => f.channel === "unknown").length;
  const paidNoStart = facts.filter((f) => f.everPaid && !f.paidStartedAt).length;
  const noLead = snap.leadsInstalled ? facts.filter((f) => !d.leads.some((l) => l.user_id === f.id)).length : null;
  const sharing = d.consents.filter((c) => c.share_prices).length;
  const ref = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
  const authLogs = ref ? `https://supabase.com/dashboard/project/${ref}/logs/auth-logs` : "https://supabase.com/dashboard";

  return (
    <div className="space-y-6">
      <PageHead kicker="Operations" title="Exceptions, reliability and diagnostics" intro="Technical health and data-quality checks. Only real failures are flagged; low volume is not an error." />
      <ScopeNote sc={sc} />

      <SectionTitle id="health" kicker="System health" title="Failures in the last 7 days" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Application">
          <dl>
            <Row k="PDF export errors">{snap.pdfErrors7d ? <span className="text-[var(--cc-amber)]">{fmt(snap.pdfErrors7d)}</span> : "0"}</Row>
            <Row k="Price-import failures">{fmt(snap.importFailures7d)}</Row>
            <Row k="Signed-PDF generation failures">{sigPdfFailed ? <span className="text-[var(--cc-amber)]">{fmt(sigPdfFailed)}</span> : "0"}</Row>
          </dl>
          <p className="mt-2 text-xs text-muted">Details in <Link href="/admin/logs" className="underline">Import &amp; PDF errors</Link>. Uncaught errors go to Sentry.</p>
        </Panel>
        <Panel title="Stripe webhooks">
          <dl>
            <Row k="Events received">{fmt(snap.stripeEvents.length)}</Row>
            <Row k="Errors">{hookErrors.length ? <span className="text-[var(--cc-red)]">{fmt(hookErrors.length)}</span> : "0"}</Row>
            <Row k="Unprocessed (over 1 h)">{unprocessed.length ? <span className="text-[var(--cc-amber)]">{fmt(unprocessed.length)}</span> : "0"}</Row>
            <Row k="Last event">{snap.stripeEvents[0] ? ago(snap.stripeEvents[0].received_at, nowMs) : "None in 7 days"}</Row>
          </dl>
          {hookErrors.slice(0, 3).map((e) => <p key={e.id} className="cc-mono mt-2 truncate text-[11px] text-[var(--cc-red)]" title={e.error ?? ""}>{e.type}: {e.error}</p>)}
        </Panel>
        <Panel title="Background email" >
          <dl>
            <Row k="Failed (gave up)">{outboxFailed.length ? <span className="text-[var(--cc-red)]">{fmt(outboxFailed.length)}</span> : "0"}</Row>
            <Row k="Waiting to send">{fmt(outboxPending)}</Row>
          </dl>
          {outboxFailed[0]?.last_error && <p className="cc-mono mt-2 truncate text-[11px] text-[var(--cc-red)]" title={outboxFailed[0].last_error}>{outboxFailed[0].last_error}</p>}
          <p className="mt-2 text-xs text-muted">Founder welcome emails (Resend). Sign-in emails are sent by Supabase and are not in this queue.</p>
        </Panel>
      </div>

      <SectionTitle id="auth" kicker="Authentication" title="Sign-in and email delivery" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title={`Never verified their email (${unverified.length})`} className="lg:col-span-2">
          {unverified.length === 0 ? <p className="text-sm text-ink-soft">Every account older than a day has verified its email.</p> : (
            <Table head={["Account", "Signed up"]} minWidth={360}>
              {unverified.slice(0, 10).map((f) => <tr key={f.id}><td className="font-sans"><Link href={`/admin/customers/${f.id}`} className="text-white underline">{f.email ?? f.id}</Link></td><td className="text-ink-soft">{ago(f.createdAt, nowMs)}</td></tr>)}
            </Table>
          )}
          <p className="mt-2 text-xs text-muted">Several unverified signups in a row can mean the 6-digit code email is not arriving. Compare with the Supabase Auth logs.</p>
        </Panel>
        <Panel title="OTP and SMTP diagnostics">
          <p className="text-sm text-ink-soft">Sign-in codes are sent by Supabase Auth through its SMTP settings. The app cannot read those delivery logs, so failures are not counted here.</p>
          <a href={authLogs} target="_blank" rel="noreferrer" className="cc-mono mt-3 inline-block text-xs text-[var(--cc-blue)] underline">Open Supabase Auth logs →</a>
        </Panel>
      </div>

      <SectionTitle id="integrations" kicker="Integrations" title="Connection status" />
      <Panel>
        <Table head={["Integration", "Status", "Detail"]} minWidth={640}>
          {integrations.map((i) => <tr key={i.key}><td className="font-sans text-white">{i.name}</td><td><Chip tone={STATE[i.state].tone}>{STATE[i.state].label}</Chip></td><td className="font-sans text-xs text-ink-soft">{i.detail}</td></tr>)}
        </Table>
        <p className="mt-3 text-xs text-muted">Status is read from this deploy&apos;s configuration. No secret value is ever shown. Setup steps for the optional Google and ad connections: docs/admin/INTEGRATIONS.md.</p>
      </Panel>

      <SectionTitle id="data" kicker="Data diagnostics" title="Reporting quality" />
      <Panel>
        <ul className="space-y-2.5 text-sm">
          <li className="flex flex-wrap justify-between gap-2"><span className="text-ink-soft">Location coverage</span><span className="cc-mono text-white">{coverage === null ? "No bids yet" : `${coverage}% · ${fmt(loc.missing)} bid${loc.missing === 1 ? "" : "s"} missing a state`} · <Link href={href("/admin/states", view)} className="text-[var(--cc-blue)] underline">Bids by state</Link></span></li>
          <li className="flex flex-wrap justify-between gap-2"><span className="text-ink-soft">Accounts with unknown acquisition source</span><span className="cc-mono text-white">{fmt(unknown)} of {fmt(facts.length)}</span></li>
          <li className="flex flex-wrap justify-between gap-2"><span className="text-ink-soft">Accounts without a lead/attribution record</span><span className="cc-mono text-white">{noLead === null ? "Lead table not installed" : fmt(noLead)}</span></li>
          <li className="flex flex-wrap justify-between gap-2"><span className="text-ink-soft">Paid subscriptions with no recorded start event</span><span className="cc-mono text-white">{fmt(paidNoStart)}</span></li>
          <li className="flex flex-wrap justify-between gap-2"><span className="text-ink-soft">Referrer / click id / device capture</span><span className="cc-mono">{snap.attributionV2 ? <span className="text-[var(--cc-green)]">Installed</span> : <span className="text-[var(--cc-amber)]">Needs migration 20261115002000</span>}</span></li>
          <li className="flex flex-wrap justify-between gap-2"><span className="text-ink-soft">Owner account labels</span><span className="cc-mono">{snap.labelsInstalled ? <span className="text-[var(--cc-green)]">Installed · {fmt(snap.labels.length)} labeled</span> : <span className="text-[var(--cc-amber)]">Needs migration 20261115002000</span>}</span></li>
          <li className="flex flex-wrap justify-between gap-2"><span className="text-ink-soft">Market Intelligence sharing</span><span className="cc-mono text-white">{fmt(sharing)} of 20 businesses opted in <span className="text-muted">(pricing views stay hidden below 20 by design)</span></span></li>
        </ul>
      </Panel>

      <SectionTitle id="reports" kicker="Reports and tools" title="Everything else" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Exports (CSV, owner only)">
          <ul className="space-y-2 text-sm">
            <li><a className="text-[var(--cc-blue)] underline" href={href("/admin/export/customers", view)}>Account summary</a> <span className="text-muted">· plan, dates, counts. No bid contents or prices.</span></li>
            <li><a className="text-[var(--cc-blue)] underline" href={href("/admin/export/states", view)}>Bids by state</a> <span className="text-muted">· counts only</span></li>
            <li><a className="text-[var(--cc-blue)] underline" href={href("/admin/export/channels", view)}>Channel performance</a> <span className="text-muted">· selected range</span></li>
            <li><a className="text-[var(--cc-blue)] underline" href={href("/admin/export/trades", view)}>Bids by trade</a> <span className="text-muted">· selected range</span></li>
          </ul>
        </Panel>
        <Panel title="Owner tools">
          <ul className="grid gap-1.5 text-sm sm:grid-cols-2">{TOOLS.map((t) => <li key={t.href}><Link href={t.href} className="text-ink-soft underline hover:text-white">{t.label}</Link></li>)}</ul>
        </Panel>
      </div>
    </div>
  );
}
