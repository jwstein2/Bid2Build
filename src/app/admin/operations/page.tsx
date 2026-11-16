import Link from "next/link";
import { LIFECYCLE_STEPS, stepOfKind, type LifecycleStep } from "@/lib/email/lifecycle";
import { Chip, Kpi, PageHead, Panel, Row, Table, ago, fmt, type Tone } from "@/components/admin/cc";
import { MetricRecords } from "@/components/ui/metric-card";
import { ReportUnavailable, ScopeNote, SectionTitle } from "@/components/admin/report";
import { TOOLS } from "@/components/admin/nav";
import { integrationStatus, type IntegrationState } from "@/lib/admin/integrations";
import { locationQuality } from "@/lib/admin/metrics";
import { loadReport } from "@/lib/admin/load";
import { carry, href } from "@/lib/admin/view";
import { previewLifecycle, sendLifecycleSamplesAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Operations" };

const STATE: Record<IntegrationState, { tone: Tone; label: string }> = { ok: { tone: "green", label: "OK" }, warn: { tone: "amber", label: "Check" }, missing: { tone: "red", label: "Missing" }, not_connected: { tone: "muted", label: "Not connected" } };

export default async function Operations({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const lifecycleNote = typeof sp.lifecycle === "string" ? sp.lifecycle.slice(0, 300) : null;
  const { r, error, view } = await loadReport(sp, { costs: true });
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
  const lifecycleByStep = Object.fromEntries(LIFECYCLE_STEPS.map((st) => [st, 0])) as Record<LifecycleStep, number>;
  for (const o of d.outbox) { const st = stepOfKind(o.kind); if (st && o.status === "sent" && Date.parse(o.updated_at ?? o.created_at) >= nowMs - 30 * 86_400_000) lifecycleByStep[st]++; }
  const lifecycleSent = Object.values(lifecycleByStep).reduce((a, b) => a + b, 0);
  const lifecycleMode = `sending ${process.env.LIFECYCLE_EMAIL_MODE === "live" ? "live" : process.env.LIFECYCLE_EMAIL_MODE === "test" ? "to test addresses only" : "off"}`;
  const unverified = facts.filter((f) => !f.confirmed && Date.parse(f.createdAt) < nowMs - 86_400_000);
  const loc = locationQuality(d.estimates);
  const coverage = loc.total ? Math.round((loc.withState / loc.total) * 100) : null;
  const unknown = facts.filter((f) => f.channel === "unknown").length;
  const paidNoStart = facts.filter((f) => f.everPaid && !f.paidStartedAt).length;
  const noLead = snap.leadsInstalled ? facts.filter((f) => !d.leads.some((l) => l.user_id === f.id)).length : null;
  const sharing = d.consents.filter((c) => c.share_prices).length;
  const ref = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
  const appFailures = snap.pdfErrors7d + snap.importFailures7d + sigPdfFailed;
  const authLogs = ref ? `https://supabase.com/dashboard/project/${ref}/logs/auth-logs` : "https://supabase.com/dashboard";

  return (
    <div className="space-y-6">
      <PageHead kicker="Operations" title="Exceptions, reliability and diagnostics" intro="Technical health and data-quality checks. Only real failures are flagged; low volume is not an error." />
      <ScopeNote sc={sc} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="ops-kpis">
        <Kpi label="App failures (7 days)" value={appFailures} tone={appFailures ? "amber" : "green"} sub={`${fmt(snap.pdfErrors7d)} PDF · ${fmt(snap.importFailures7d)} import · ${fmt(sigPdfFailed)} signed PDF`} href="/admin/logs" action="Import & PDF error log" />
        <Kpi label="Stripe webhook problems" value={hookErrors.length + unprocessed.length} tone={hookErrors.length ? "red" : unprocessed.length ? "amber" : "green"} sub={`${fmt(hookErrors.length)} errors · ${fmt(unprocessed.length)} unprocessed`}
          action="View failed events" drawer={{ id: "webhooks", title: "Stripe webhook problems (7 days)", body: <MetricRecords rows={[...hookErrors, ...unprocessed].slice(0, 20).map((e) => ({ key: String(e.id), label: e.type, detail: e.error ?? "Not processed after 1 hour", value: ago(e.received_at, nowMs) }))} empty="No webhook errors or stuck events in the last 7 days." more={{ href: "#health", label: "System health" }} /> }} />
        <Kpi label="Emails failed" value={outboxFailed.length} tone={outboxFailed.length ? "red" : "green"} sub={`${fmt(outboxPending)} waiting to send`}
          action="View failed emails" drawer={{ id: "outbox", title: "Background emails that gave up", body: <MetricRecords rows={outboxFailed.slice(0, 20).map((o, i) => ({ key: `${o.user_id}-${i}`, label: o.kind, detail: o.last_error ?? "No error recorded", value: `${o.attempts}×`, href: `/admin/customers/${o.user_id}${view.includeTest ? "?data=all" : ""}` }))} empty="No failed background emails." more={{ href: "#health", label: "Background email panel" }} /> }} />
        <Kpi label="Never verified email" value={unverified.length} tone={unverified.length ? "amber" : "green"} sub="Accounts older than a day" href={carry("/admin/customers", view, { cohort: "unverified" }, "accounts")} action="View these accounts" />
      </div>

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
        <Panel title="Background email">
          <dl>
            <Row k="Failed (gave up)">{outboxFailed.length ? <span className="text-[var(--cc-red)]">{fmt(outboxFailed.length)}</span> : "0"}</Row>
            <Row k="Waiting to send">{fmt(outboxPending)}</Row>
            <Row k="Lifecycle emails sent (30 days)">{lifecycleSent ? `${fmt(lifecycleSent)} (${LIFECYCLE_STEPS.map((st) => `${st.toUpperCase()} ${lifecycleByStep[st]}`).join(" · ")})` : `0 · ${lifecycleMode}`}</Row>
          </dl>
          {outboxFailed[0]?.last_error && <p className="cc-mono mt-2 truncate text-[11px] text-[var(--cc-red)]" title={outboxFailed[0].last_error}>{outboxFailed[0].last_error}</p>}
          <p className="mt-2 text-xs text-muted">Founder welcome and lifecycle emails A–E (Resend). Sign-in emails are sent by Supabase and are not in this queue.</p>
          {lifecycleNote && <p className="mt-2 text-xs" role="status">{lifecycleNote}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <form action={previewLifecycle}><button type="submit" className="cc-mono rounded-md border border-[var(--cc-line)] px-3 py-1.5 text-xs text-white hover:border-[var(--cc-blue)]">Preview lifecycle emails due now</button></form>
            <form action={sendLifecycleSamplesAction}><button type="submit" className="cc-mono rounded-md border border-[var(--cc-line)] px-3 py-1.5 text-xs text-white hover:border-[var(--cc-blue)]">Send me the 5 samples</button></form>
          </div>
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
          <li className="flex flex-wrap justify-between gap-2"><span className="text-ink-soft">Cost tracking and usage monitors</span><span className="cc-mono">{r.costs?.installed ? <span className="text-[var(--cc-green)]">Installed · {fmt(r.costs.services.length)} services recorded</span> : <span className="text-[var(--cc-amber)]">Needs migration 20261115003000</span>}</span></li>
          <li className="flex flex-wrap justify-between gap-2"><span className="text-ink-soft">Database size (Supabase Pro includes 8 GB)</span><span className="cc-mono text-white">{r.costs?.usage ? `${(r.costs.usage.db_bytes / 1024 ** 2).toFixed(1)} MB${r.costs.usage.db_bytes > 6.4 * 1024 ** 3 ? " · over 80%" : ""}` : "–"}</span></li>
          <li className="flex flex-wrap justify-between gap-2"><span className="text-ink-soft">Analytics instrumentation gaps</span><span className="cc-mono text-xs text-ink-soft">Verification failures and proposal views are not recorded (by design)</span></li>
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
