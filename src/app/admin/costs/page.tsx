import Link from "next/link";
import { Chip, Fresh, Kpi, NotConnected, PageHead, Panel, PanelLink, Row, Table, day, fmt, usd, type Tone } from "@/components/admin/cc";
import { ReportUnavailable, SectionTitle } from "@/components/admin/report";
import { CATALOG, CATEGORIES, COST_TYPES, INTERVALS, SOURCES, STATUSES, costTotals, renewals, serviceViews, type Category, type ServiceStatus, type ServiceView } from "@/lib/admin/costs";
import { envPresent } from "@/lib/admin/integrations";
import { loadReport } from "@/lib/admin/load";
import { adsSetup, anthropicCost, netlifyUsage, supabaseUsage, type Monitor } from "@/lib/admin/monitors";
import { str } from "@/lib/admin/view";
import { addExpense, deleteExpense, importExpenses, saveService } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tech Stack & Costs" };

const STATUS_TONE: Record<ServiceStatus, Tone> = { active: "green", connected_unused: "blue", development: "violet", proposed: "muted", discontinued: "muted", unknown: "amber" };
const GB = 1024 ** 3;
const gb = (b: number) => (b >= GB ? `${(b / GB).toFixed(2)} GB` : `${(b / 1024 ** 2).toFixed(1)} MB`);
const pctOf = (v: number, max: number) => Math.min(100, Math.round((v / max) * 1000) / 10);

function Meter({ label, value, max, text }: { label: string; value: number; max: number; text: string }) {
  const p = pctOf(value, max);
  return (
    <div>
      <div className="flex justify-between text-xs"><span className="text-ink-soft">{label}</span><span className="cc-mono text-white">{text}</span></div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[rgb(56_182_255/0.08)]" role="img" aria-label={`${label}: ${p}% of allowance`}><div className="h-full rounded-full" style={{ width: `${Math.max(1, p)}%`, background: p >= 80 ? "var(--cc-amber)" : "var(--cc-blue)" }} /></div>
    </div>
  );
}

function MonitorState<T>({ m, now }: { m: Monitor<T>; now: number }) {
  if (m.state === "not_connected") return <NotConnected>Not connected · add {m.env}</NotConnected>;
  if (m.state === "error") return <span className="cc-mono rounded border border-[var(--cc-amber)]/50 px-1.5 py-0.5 text-[11px] text-[var(--cc-amber)]">{m.message}</span>;
  return <Fresh at={m.fetchedAt} state="live" now={now} />;
}

const money = (c: number | null) => (c == null ? <span className="text-[var(--cc-amber)]">Unknown</span> : usd(c));

export default async function Costs({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { r, error } = await loadReport(sp, { costs: true });
  if (!r || !r.costs) return <ReportUnavailable error={error} />;
  const { now, costs } = r;
  const nowMs = now.getTime();
  const views = serviceViews(costs.services, costs.expenses, envPresent, now);
  const totals = costTotals(views, costs.expenses, now);
  const upcoming = renewals(views, now, 90);
  const over = views.filter((v) => v.overBudget);
  const q = str(sp.q).trim().toLowerCase().slice(0, 60);
  const cat = str(sp.category) in CATEGORIES ? (str(sp.category) as Category) : "";
  const list = views.filter((v) => (!q || `${v.name} ${v.purpose}`.toLowerCase().includes(q)) && (!cat || v.category === cat))
    .sort((a, b) => (a.status === "active" ? 0 : 1) - (b.status === "active" ? 0 : 1) || a.name.localeCompare(b.name));
  const editKey = str(sp.edit);
  const editing: ServiceView | null = editKey === "new" ? null : views.find((v) => v.key === editKey) ?? null;
  const showForm = editKey === "new" || Boolean(editing);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).getTime();
  const aiMonth = (costs.ai ?? []).filter((a) => Date.parse(a.created_at) >= monthStart);
  const aiCents = Math.round(aiMonth.reduce((n, a) => n + (Number(a.cost_usd) || 0), 0) * 100);
  const aiFailed = aiMonth.filter((a) => a.status === "failed").length;
  const usage = costs.usage;
  const storage = usage ? usage.buckets.reduce((n, b) => n + b.bytes, 0) : 0;
  const recent = [...costs.expenses].sort((a, b) => (a.incurred_on < b.incurred_on ? 1 : -1)).slice(0, 15);
  const nameOf = new Map(views.map((v) => [v.key, v.name]));
  const today = now.toISOString().slice(0, 10);
  const [netlify, supa, anth] = await Promise.all([netlifyUsage(), supabaseUsage(), anthropicCost(now)]);
  const ads = adsSetup();

  return (
    <div className="space-y-6">
      <PageHead kicker="Tools · Tech Stack & Costs" title="What it costs to run Built2Bid"
        intro="Every provider found in the codebase and configuration, what it does, what you pay, and how much of it belongs to Built2Bid. Unknown costs stay Unknown; they are never counted as $0."
        right={<PanelLink href="/admin/costs/forecast">Scaling forecast</PanelLink>} />

      {!costs.installed && <p role="alert" className="cc-mono rounded-md border border-[var(--cc-amber)]/50 px-3 py-2 text-xs text-[var(--cc-amber)]">Cost tracking needs migration 20261115003000_admin_costs.sql. Until it runs, the inventory below is read-only and costs show as Unknown.</p>}
      {str(sp.error) && <p role="alert" className="rounded-md border border-[var(--cc-red)]/50 px-3 py-2 text-xs text-[var(--cc-red)]">{str(sp.error)}</p>}
      {str(sp.saved) && <p role="status" className="rounded-md border border-[var(--cc-green)]/50 px-3 py-2 text-xs text-[var(--cc-green)]">Saved {str(sp.saved)}.</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Known monthly cost" value={usd(totals.totalMonthlyKnownCents)} tone="blue" sub="Recurring, monthly equivalent, Built2Bid share" def="Fixed subscriptions and plans (annual ÷ 12), multiplied by each service's Built2Bid allocation. Excludes usage-based charges and advertising." />
        <Kpi label="Variable, this month" value={usd(totals.variableMonthToDateCents)} sub="Dated usage charges recorded so far" def="Charges you entered or imported for usage-based services this calendar month (allocated)." />
        <Kpi label="Cash recorded, this month" value={usd(totals.cashThisMonthCents)} sub="Every dated charge, including yearly renewals paid now" def="Actual charges dated this month, allocated. A yearly renewal appears here in full in the month it is paid." />
        <Kpi label="Active services, cost unknown" value={totals.missing.length} tone={totals.missing.length ? "amber" : "green"} sub={totals.missing.length ? totals.missing.slice(0, 3).map((m) => m.name).join(", ") + (totals.missing.length > 3 ? "…" : "") : "Every active service has a cost"} />
        <Kpi label="Renewals next 30 days" value={upcoming.filter((u) => Date.parse(u.renewal!) <= nowMs + 30 * 86_400_000).length} tone={over.length ? "amber" : "green"} sub={over.length ? `${over.length} projected over budget` : "No service projected over budget"} />
      </div>

      <SectionTitle id="usage" kicker="Usage monitors" title="Resource use against plan allowances" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Supabase" action={<Fresh at={usage?.measured_at} state={usage ? "live" : costs.installed ? "error" : "not_connected"} now={nowMs} />}>
          {usage ? (
            <div className="space-y-3">
              <Meter label="Database size" value={usage.db_bytes} max={8 * GB} text={`${gb(usage.db_bytes)} of 8 GB`} />
              <Meter label="File storage" value={storage} max={100 * GB} text={`${gb(storage)} of 100 GB`} />
              <Meter label="Auth users" value={usage.auth_users} max={100_000} text={`${fmt(usage.auth_users)} of 100,000 MAU`} />
              <p className="text-xs text-muted">Measured from the database itself. Allowances are the Pro plan&apos;s published inclusions; confirm on the Supabase usage page. Request counts come from the Supabase Management API monitor below.</p>
            </div>
          ) : <p className="text-sm text-ink-soft">Database and storage size appear after migration 20261115003000 adds the read-only usage function.</p>}
        </Panel>
        <Panel title="Anthropic API (in-app AI)" action={<Fresh at={costs.ai ? now.toISOString() : null} state={costs.ai ? "live" : "error"} now={nowMs} />}>
          {costs.ai ? (
            <dl>
              <Row k="Requests this month">{fmt(aiMonth.length)}</Row>
              <Row k="Measured cost this month">{usd(aiCents)}</Row>
              <Row k="Failed requests">{aiFailed ? <span className="text-[var(--cc-amber)]">{fmt(aiFailed)}</span> : "0"}</Row>
            </dl>
          ) : <p className="text-sm text-ink-soft">The AI usage log could not be read.</p>}
          <p className="mt-2 text-xs text-muted">From Built2Bid&apos;s own request log (model, tokens, cost per request). It does not include the GitHub pricing-guide job or any Claude subscription; the account-wide figure is in the Anthropic monitor below.</p>
        </Panel>
        <Panel title="Other providers">
          <ul className="space-y-2.5 text-sm">
            <li className="flex flex-wrap items-center justify-between gap-2"><span className="text-ink-soft">Stripe fees and refunds</span><Link href="/admin/revenue/scorecard" className="cc-mono text-xs text-[var(--cc-blue)] underline">On the scorecard</Link></li>
            <li className="flex flex-wrap items-center justify-between gap-2"><span className="text-ink-soft">Google Cloud / Places quota</span><NotConnected>Not in use</NotConnected></li>
            <li className="flex flex-wrap items-center justify-between gap-2"><span className="text-ink-soft">Resend sending volume</span><NotConnected /></li>
            <li className="flex flex-wrap items-center justify-between gap-2"><span className="text-ink-soft">Apify, Apollo, Instantly</span><NotConnected>No Built2Bid account found</NotConnected></li>
          </ul>
          <p className="mt-3 text-xs text-muted">Enter their invoices below. Netlify, Supabase, Anthropic and advertising have their own monitors underneath.</p>
        </Panel>
      </div>

      <SectionTitle id="monitors" kicker="Provider API monitors" title="Read-only account usage from each provider" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Netlify" action={<MonitorState m={netlify} now={nowMs} />}>
          {netlify.state === "ok" ? (
            <div className="space-y-3">
              <dl>
                <Row k="Team">{netlify.data.team ?? "–"}</Row>
                <Row k="Plan">{netlify.data.plan ?? "–"}{netlify.data.billingPeriod ? ` · ${netlify.data.billingPeriod}` : ""}</Row>
              </dl>
              {netlify.data.buildMinutes?.used != null && netlify.data.buildMinutes.included ? (
                <Meter label="Build minutes this period" value={netlify.data.buildMinutes.used} max={netlify.data.buildMinutes.included} text={`${fmt(netlify.data.buildMinutes.used)} of ${fmt(netlify.data.buildMinutes.included)}`} />
              ) : <p className="text-xs text-muted">Build minutes: not reported for this token.</p>}
              {netlify.data.buildMinutes?.periodEnd && <p className="text-[11px] text-muted">Period ends {day(netlify.data.buildMinutes.periodEnd)}.</p>}
            </div>
          ) : <p className="text-sm text-ink-soft">Plan and build minutes from the Netlify API.</p>}
          <p className="mt-2 text-xs text-muted">Bandwidth, function and credit usage are not in Netlify&apos;s public API; check the Netlify usage page.</p>
        </Panel>
        <Panel title="Supabase (Management API)" action={<MonitorState m={supa} now={nowMs} />}>
          {supa.state === "ok" ? (
            <dl>
              <Row k="Project status">{supa.data.status ?? "–"}{supa.data.region ? ` · ${supa.data.region}` : ""}</Row>
              <Row k="API requests (recent window)">{supa.data.requestsTotal == null ? "Unavailable" : fmt(supa.data.requestsTotal)}</Row>
              {supa.data.requests.slice(0, 5).map((r) => <Row key={r.label} k={<span className="capitalize">{r.label}</span>}>{fmt(r.count)}</Row>)}
            </dl>
          ) : <p className="text-sm text-ink-soft">Project health and API request counts.</p>}
          <p className="mt-2 text-xs text-muted">Egress is not exposed by the Management API; check the Supabase usage page.</p>
        </Panel>
        <Panel title="Anthropic (whole account)" action={<MonitorState m={anth} now={nowMs} />}>
          {anth.state === "ok" ? (
            <dl>
              <Row k="API cost this month">{usd(anth.data.totalCents)}</Row>
              {anth.data.byModel.slice(0, 5).map((r) => <Row key={r.model} k={r.model}>{usd(r.cents)}</Row>)}
              <Row k="Complete through">{anth.data.refreshedAt ? day(anth.data.refreshedAt) : "No data yet"}</Row>
            </dl>
          ) : <p className="text-sm text-ink-soft">API spend for the whole organization, by model, including the pricing-guide job.</p>}
          <p className="mt-2 text-xs text-muted">API billing only, at list price before credits; data lags up to a day. A Claude or Claude Code subscription is billed separately and is not included.</p>
        </Panel>
      </div>
      <Panel kicker="Advertising" title="Ad platform connections">
        <div className="grid gap-4 md:grid-cols-2">
          {ads.map((a) => (
            <div key={a.key}>
              <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-white">{a.name}</p><NotConnected>{a.missing.length ? "Setup needed" : "Settings present · awaiting review"}</NotConnected></div>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-ink-soft">{a.needs.map((n) => <li key={n}>{n}</li>)}</ul>
              <p className="mt-2 text-[11px] text-muted">Settings: {[...a.present.map((n) => `${n} ✓`), ...a.missing].join(", ")}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">Read-only spend reporting only; nothing here can create, change or start a campaign. Until connected, enter ad spend on Marketing.</p>
      </Panel>

      <SectionTitle id="services" kicker="Service directory" title={`${list.length} provider${list.length === 1 ? "" : "s"}`} right={<Link href="/admin/costs?edit=new#edit" className="cc-mono rounded-md border border-[var(--cc-line)] px-2.5 py-1.5 text-xs text-[var(--cc-blue)] hover:border-[var(--cc-blue)]">+ Add a service</Link>} />
      <Panel>
        <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
          <label className="text-xs"><span className="cc-kicker mb-1 block">Search</span><input name="q" defaultValue={q} placeholder="Provider or purpose" className="field field-sm w-56" /></label>
          <label className="text-xs"><span className="cc-kicker mb-1 block">Category</span><select name="category" defaultValue={cat} className="field field-sm"><option value="">All</option>{Object.entries(CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <button className="cc-mono rounded-md border border-[var(--cc-line)] px-3 py-1.5 text-xs text-white hover:border-[var(--cc-blue)]">Filter</button>
        </form>
        <Table head={["Provider", "Category", "Status", "Plan", "Monthly equiv.", "Built2Bid share", "Usage this month", "Renews", "Source", ""]} align={["l", "l", "l", "l", "r", "r", "r", "l", "l", "r"]} minWidth={1080}>
          {list.map((v) => (
            <tr key={v.key}>
              <td className="font-sans">
                <a href={v.dashboard || undefined} target="_blank" rel="noreferrer" className="font-semibold text-white hover:underline">{v.name}</a>
                <p className="max-w-[18rem] text-xs text-muted">{v.purpose}</p>
                <p className="max-w-[18rem] text-[11px] text-muted">{v.evidence}{v.detected === true ? " · configured on this deploy" : v.detected === false ? " · not configured on this deploy" : ""}</p>
              </td>
              <td className="font-sans text-xs text-ink-soft">{CATEGORIES[v.category]}</td>
              <td><Chip tone={STATUS_TONE[v.status]}>{STATUSES[v.status]}</Chip></td>
              <td className="max-w-[10rem] font-sans text-xs text-ink-soft">{v.plan ?? "–"}<p className="text-muted">{INTERVALS[v.interval]}</p></td>
              <td className="text-right">{v.interval === "usage" ? <span className="text-muted">Usage</span> : money(v.monthlyTotalCents)}</td>
              <td className="text-right text-white">{v.interval === "usage" ? <span className="text-muted">–</span> : money(v.monthlyAllocatedCents)}{v.allocation !== 100 && <p className="text-[11px] text-muted">{v.allocation}%</p>}</td>
              <td className="text-right">{v.monthToDateCents ? usd(v.monthToDateCents) : <span className="text-muted">–</span>}{v.budgetCents != null && <p className={`text-[11px] ${v.overBudget ? "text-[var(--cc-amber)]" : "text-muted"}`}>budget {usd(v.budgetCents)}{v.projectedCents != null ? ` · proj. ${usd(v.projectedCents)}` : ""}</p>}</td>
              <td className="text-xs">{v.renewal ? day(v.renewal) : "–"}</td>
              <td><Chip tone={v.source === "unknown" ? "amber" : v.source === "estimated" ? "violet" : "muted"}>{SOURCES[v.source]}</Chip></td>
              <td className="text-right"><Link href={`/admin/costs?edit=${v.key}#edit`} className="text-xs text-[var(--cc-blue)] underline">Edit</Link></td>
            </tr>
          ))}
        </Table>
        <p className="mt-3 text-xs text-muted">Status is your call: “Confirmed active” only when Built2Bid actually uses and pays for it. Code mentioning a provider does not make it active. Advertising spend is entered on Marketing, not here, so it is never counted twice.</p>
      </Panel>

      {showForm && (
        <Panel kicker={editing ? "Edit service" : "Add a service"} title={editing?.name ?? "New provider"} className="scroll-mt-24">
          <form id="edit" action={saveService} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs"><span className="cc-kicker mb-1 block">Key</span><input name="provider_key" required defaultValue={editing?.key ?? ""} readOnly={Boolean(editing)} pattern="[a-z0-9][a-z0-9_\-]{1,39}" className="field field-sm" /></label>
            <label className="text-xs"><span className="cc-kicker mb-1 block">Name</span><input name="name" required maxLength={80} defaultValue={editing?.name ?? ""} className="field field-sm" /></label>
            <label className="text-xs"><span className="cc-kicker mb-1 block">Category</span><select name="category" defaultValue={editing?.category ?? "other"} className="field field-sm">{Object.entries(CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="text-xs"><span className="cc-kicker mb-1 block">Status</span><select name="status" defaultValue={editing?.status ?? "active"} className="field field-sm">{Object.entries(STATUSES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="text-xs sm:col-span-2"><span className="cc-kicker mb-1 block">Purpose</span><input name="purpose" maxLength={200} defaultValue={editing?.purpose ?? ""} className="field field-sm" /></label>
            <label className="text-xs"><span className="cc-kicker mb-1 block">Plan</span><input name="plan" maxLength={80} defaultValue={editing?.plan ?? ""} className="field field-sm" /></label>
            <label className="text-xs"><span className="cc-kicker mb-1 block">Cost type</span><select name="cost_type" defaultValue={editing?.costType ?? "fixed"} className="field field-sm">{Object.entries(COST_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="text-xs"><span className="cc-kicker mb-1 block">Charge per interval (USD)</span><input name="amount" inputMode="decimal" placeholder="Leave empty if unknown" defaultValue={editing?.row?.amount_cents != null ? (editing.row.amount_cents / 100).toFixed(2) : ""} className="field field-sm" /></label>
            <label className="text-xs"><span className="cc-kicker mb-1 block">Billing interval</span><select name="billing_interval" defaultValue={editing?.interval ?? "monthly"} className="field field-sm">{Object.entries(INTERVALS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="text-xs"><span className="cc-kicker mb-1 block">Next renewal</span><input type="date" name="next_renewal" defaultValue={editing?.renewal ?? ""} className="field field-sm" /></label>
            <label className="text-xs"><span className="cc-kicker mb-1 block">Built2Bid allocation %</span><input type="number" name="allocation_pct" min={0} max={100} defaultValue={editing?.allocation ?? 100} className="field field-sm" /></label>
            <label className="text-xs"><span className="cc-kicker mb-1 block">Monthly budget (USD)</span><input name="budget" inputMode="decimal" placeholder="Optional" defaultValue={editing?.budgetCents != null ? (editing.budgetCents / 100).toFixed(2) : ""} className="field field-sm" /></label>
            <label className="text-xs"><span className="cc-kicker mb-1 block">Where the amount came from</span><select name="cost_source" defaultValue={editing?.source ?? "manual"} className="field field-sm">{Object.entries(SOURCES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="text-xs sm:col-span-2"><span className="cc-kicker mb-1 block">Billing / dashboard link</span><input name="dashboard_url" maxLength={300} placeholder="https://" defaultValue={editing?.row?.dashboard_url ?? editing?.dashboard ?? ""} className="field field-sm" /></label>
            <label className="text-xs"><span className="cc-kicker mb-1 block">Invoice reference</span><input name="invoice_ref" maxLength={200} defaultValue={editing?.row?.invoice_ref ?? ""} className="field field-sm" /></label>
            <label className="text-xs sm:col-span-2 lg:col-span-3"><span className="cc-kicker mb-1 block">Notes</span><input name="notes" maxLength={500} defaultValue={editing?.row?.notes ?? ""} className="field field-sm" /></label>
            <div className="flex items-end gap-3"><button type="submit" disabled={!costs.installed} className="cc-mono rounded-md bg-[var(--cc-green)] px-3 py-1.5 text-sm font-bold text-[#03140c] disabled:opacity-40">Save</button><Link href="/admin/costs#services" className="text-xs text-ink-soft underline">Cancel</Link></div>
          </form>
          {editing && <p className="mt-3 text-xs text-muted">{editing.costNote} Mark a service you stopped using as Discontinued instead of deleting it, so its history stays. Every change is written to the audit log.</p>}
        </Panel>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel kicker="Billing calendar" title="Renewals in the next 90 days">
          {upcoming.length === 0 ? <p className="text-sm text-ink-soft">No renewal dates entered. Add them when editing a service.</p> : (
            <ul className="space-y-2">{upcoming.map((v) => <li key={v.key} className="flex justify-between gap-3 text-sm"><span className="text-white">{v.name}</span><span className="cc-mono text-xs text-ink-soft">{day(v.renewal)} · {v.amountCents != null ? usd(v.amountCents) : "amount unknown"}</span></li>)}</ul>
          )}
        </Panel>
        <Panel kicker="Totals" title="Monthly expense by type" className="lg:col-span-2">
          <dl>
            <Row k="Fixed (subscriptions, plans, domain ÷ 12)">{usd(totals.fixedMonthlyCents)}</Row>
            <Row k="Variable (usage charges recorded this month)">{usd(totals.variableMonthToDateCents)}</Row>
            <Row k="Marketing & prospecting tools">{usd(totals.marketingToolsMonthlyCents)}</Row>
            <Row k="Other operating">{usd(totals.otherMonthlyCents)}</Row>
            <Row k="Advertising (Marketing ledger)"><Link href="/admin/marketing#spend" className="text-[var(--cc-blue)] underline">See Marketing</Link></Row>
          </dl>
          <p className="mt-2 text-xs text-muted">{totals.missing.length ? `Incomplete: ${totals.missing.length} active service${totals.missing.length === 1 ? " has" : "s have"} no cost entered (${totals.missing.map((m) => m.name).join(", ")}).` : "All active services have a cost entered."} Monthly equivalents spread annual charges; cash recorded shows when money actually left.</p>
        </Panel>
      </div>

      <SectionTitle id="ledger" kicker="Expense ledger" title="Dated charges" />
      <div className="grid gap-6 lg:grid-cols-5">
        <Panel title="Record a charge" className="lg:col-span-2">
          {str(sp.expense_saved) && <p role="status" className="mb-3 rounded-md border border-[var(--cc-green)]/50 px-3 py-2 text-xs text-[var(--cc-green)]">Charge recorded.</p>}
          <form action={addExpense} className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs"><span className="cc-kicker mb-1 block">Provider</span><select name="service_key" required className="field field-sm">{views.filter((v) => v.status !== "discontinued").map((v) => <option key={v.key} value={v.key}>{v.name}</option>)}</select></label>
            <label className="text-xs"><span className="cc-kicker mb-1 block">Date</span><input type="date" name="incurred_on" required defaultValue={today} className="field field-sm" /></label>
            <label className="text-xs"><span className="cc-kicker mb-1 block">Amount (USD)</span><input name="amount" required inputMode="decimal" placeholder="25.00" className="field field-sm" /></label>
            <label className="text-xs"><span className="cc-kicker mb-1 block">Type</span><select name="kind" className="field field-sm">{Object.entries(COST_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="text-xs"><span className="cc-kicker mb-1 block">Invoice / transaction id</span><input name="external_id" maxLength={120} placeholder="Prevents double counting" className="field field-sm" /></label>
            <label className="text-xs"><span className="cc-kicker mb-1 block">Note</span><input name="note" maxLength={300} className="field field-sm" /></label>
            <div className="sm:col-span-2"><button type="submit" disabled={!costs.installed} className="cc-mono rounded-md bg-[var(--cc-green)] px-3 py-1.5 text-sm font-bold text-[#03140c] disabled:opacity-40">Record charge</button></div>
          </form>
        </Panel>
        <Panel title="Recent charges" className="lg:col-span-3">
          {recent.length === 0 ? <p className="text-sm text-ink-soft">No charges recorded yet.</p> : (
            <Table head={["Date", "Provider", "Amount", "Source", "Invoice", ""]} align={["l", "l", "r", "l", "l", "r"]} minWidth={520}>
              {recent.map((e) => (
                <tr key={e.id}>
                  <td>{e.incurred_on}</td><td className="font-sans">{nameOf.get(e.service_key) ?? e.service_key}</td><td className="text-right text-white">{usd(e.amount_cents)}</td>
                  <td className="font-sans text-xs text-ink-soft">{e.source === "invoice" ? "Imported" : e.source === "provider_api" ? "Provider API" : "Manual"}</td><td className="max-w-[8rem] truncate text-xs">{e.external_id ?? "–"}</td>
                  <td className="text-right"><form action={deleteExpense}><input type="hidden" name="id" value={e.id} /><button type="submit" className="text-xs text-ink-soft underline hover:text-[var(--cc-red)]">Delete</button></form></td>
                </tr>
              ))}
            </Table>
          )}
        </Panel>
      </div>

      <Panel kicker="Import" title="Paste a billing export (CSV)" className="scroll-mt-24">
        <div id="import" />
        {str(sp.import_error) && <p role="alert" className="mb-3 rounded-md border border-[var(--cc-red)]/50 px-3 py-2 text-xs text-[var(--cc-red)]">{str(sp.import_error)}</p>}
        {str(sp.imported) && <p role="status" className="mb-3 rounded-md border border-[var(--cc-green)]/50 px-3 py-2 text-xs text-[var(--cc-green)]">Imported {str(sp.imported)} · skipped {str(sp.skipped)} duplicate{str(sp.skipped) === "1" ? "" : "s"} · {str(sp.rejected)} line{str(sp.rejected) === "1" ? "" : "s"} rejected.</p>}
        <form action={importExpenses} className="space-y-3">
          <textarea name="csv" rows={5} maxLength={100_000} className="field field-sm w-full font-mono text-xs" placeholder={"date,provider,amount,invoice_id,note\n2026-11-01,netlify,19.00,INV-123,Pro plan\n2026-11-03,supabase,25.00,INV-456,"} />
          <button type="submit" disabled={!costs.installed} className="cc-mono rounded-md border border-[var(--cc-line)] px-3 py-1.5 text-sm text-white hover:border-[var(--cc-blue)] disabled:opacity-40">Import</button>
        </form>
        <p className="mt-3 text-xs text-muted">Provider keys: {[...new Set([...CATALOG.map((c) => c.key), ...costs.services.map((s) => s.provider_key)])].join(", ")}. A row whose invoice id is already recorded for that provider is skipped; rows without an id are skipped when the same provider, date and amount already exist. Imports are audited.</p>
      </Panel>
    </div>
  );
}
