import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isFinancialsEnabled } from "@/lib/env";
import { SandboxBar } from "@/components/financials/sandbox-bar";
import { loadFinState } from "@/lib/financials/loaders";
import { formatCurrency } from "@/lib/estimate/money";
import { ALERT_LABELS, SEVERITY_LABELS, STATE_LABELS } from "@/lib/financials/ui-labels";
import type { AlertKind, AlertSeverity, MilestoneState } from "@/lib/financials/types";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Badge } from "@/components/ui/misc";
import { BasisBadge } from "@/components/financials/basis";
import { FinStateNotice } from "@/components/financials/fin-state-notice";

export const metadata: Metadata = { title: "Financial records", robots: { index: false } };

type Row = Record<string, unknown>;
const VIEWS = { jobs: "Jobs", milestones: "Milestones", invoices: "Invoices", payments: "Payments", costs: "Costs", commitments: "Commitments", alerts: "Alerts", review: "Needs review" } as const;
type View = keyof typeof VIEWS;
const $ = (v: unknown) => formatCurrency(String(v ?? "0"));
const d = (v: unknown) => (v ? String(v).slice(0, 10) : "—");
const daysAhead = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

/** The records behind every Financials number (filtered by ?view= and ?filter=). Reads through RLS. */
export default async function Records({ searchParams }: { searchParams: Promise<{ view?: string; filter?: string; do?: string }> }) {
  if (!isFinancialsEnabled()) notFound();
  const sp = await searchParams;
  const view: View = sp.view && sp.view in VIEWS ? (sp.view as View) : "jobs";
  const filter = sp.filter ?? "";
  const doAction = sp.do && /^[a-z]+$/.test(sp.do) ? sp.do : null;
  const db = await createClient();
  const state = await loadFinState(db);
  const crumbs = <Breadcrumbs className="mb-3" items={[{ label: "Financials", href: "/financials" }, { label: VIEWS[view] }]} />;
  if (state.kind !== "ready") return <div className="mx-auto max-w-4xl space-y-4">{crumbs}<FinStateNotice state={state} /></div>;
  const b = state.ctx.bookId;
  const { data: jobsRaw } = await db.from("fin_jobs").select("id, estimate_id, job_number, name").eq("book_id", b);
  const jobs = new Map(((jobsRaw ?? []) as Row[]).map((j) => [String(j.id), j]));
  const jobLink = (jobId: unknown, extra = "") => { const j = jobs.get(String(jobId)); return j ? `/financials/jobs/${j.estimate_id}${extra}` : null; };
  const jobName = (jobId: unknown) => { const j = jobs.get(String(jobId)); return j ? `${j.job_number} · ${j.name}` : "No job"; };
  const today = new Date().toISOString().slice(0, 10);

  let rows: { key: string; title: string; detail?: string; amount?: string; basis?: string; badge?: { text: string; tone: "neutral" | "ok" | "warn" | "danger" }; href?: string | null }[] = [];
  let extra: React.ReactNode = null;

  if (view === "jobs") {
    const { data } = await db.from("fin_job_profitability_v").select("*").eq("book_id", b).order("job_number");
    rows = ((data ?? []) as Row[]).map((r) => ({
      key: String(r.job_id), title: `${r.job_number} · ${r.name}`, amount: $(r.contract_value), basis: "Contracted", href: jobLink(r.job_id, doAction ? `?do=${doAction}` : ""),
      detail: `Invoiced ${$(r.invoiced_revenue)} · Estimated cost ${$(r.estimated_cost)} · Committed ${$(r.committed_cost)} · Actual ${$(r.actual_cost)}`,
      badge: r.status === "closed" ? { text: "Closed", tone: "neutral" } : undefined,
    }));
    const { data: won } = await db.from("estimates").select("id, title, customer_name, pipeline_stage").in("pipeline_stage", ["won", "scheduled", "in_progress", "completed"]).order("updated_at", { ascending: false }).limit(50);
    const open = ((won ?? []) as Row[]).filter((e) => ![...jobs.values()].some((j) => j.estimate_id === e.id));
    if (open.length) extra = (
      <section className="rounded-xl border border-line bg-surface p-4" data-guide="fin.won-bids">
        <h2 className="font-display text-lg font-extrabold">Won bids without job financials yet</h2>
        <ul className="mt-2 divide-y divide-line">
          {open.map((e) => <li key={String(e.id)}><Link href={`/financials/jobs/${e.id}${doAction ? `?do=${doAction}` : ""}`} className="flex min-h-11 items-center gap-2 text-sm"><span className="font-semibold text-accent-ink underline">{String(e.title)}</span><span className="text-muted">{String(e.customer_name ?? "")}</span></Link></li>)}
        </ul>
      </section>
    );
  } else if (view === "milestones") {
    let q = db.from("fin_milestone_status_v").select("*").eq("book_id", b).order("seq");
    if (filter === "ready") q = q.eq("state", "ready_to_invoice");
    if (filter === "deposits") q = q.eq("is_deposit", true).neq("state", "paid");
    const { data } = await q;
    rows = ((data ?? []) as Row[]).map((m) => ({
      key: String(m.milestone_id), title: `${jobName(m.job_id)} — ${m.description}`, amount: $(m.current_amount), basis: "Contracted", href: jobLink(m.job_id),
      detail: `Due ${d(m.due_on)} · Invoiced ${$(m.invoiced)} · Paid ${$(m.paid)}`,
      badge: { text: STATE_LABELS[m.state as MilestoneState] ?? String(m.state), tone: m.overdue ? "danger" : m.state === "ready_to_invoice" ? "warn" : m.state === "paid" ? "ok" : "neutral" },
    }));
  } else if (view === "invoices") {
    let q = db.from("fin_invoice_balances_v").select("*").eq("book_id", b).order("due_date", { ascending: true, nullsFirst: false });
    if (filter === "open") q = q.eq("status", "issued").gt("balance", 0);
    if (filter === "overdue") q = q.eq("status", "issued").gt("days_overdue", 0);
    if (filter === "draft") q = q.eq("status", "draft");
    const { data } = await q;
    rows = ((data ?? []) as Row[]).map((i) => ({
      key: String(i.invoice_id), title: `${i.number ?? "Draft"} · ${jobName(i.job_id)}`, amount: $(i.status === "issued" ? i.balance : i.total), basis: i.status === "issued" ? "Outstanding" : "Invoiced", href: jobLink(i.job_id),
      detail: `${String(i.kind)} · Total ${$(i.total)} · Paid ${$(i.paid)} · Due ${d(i.due_date)}`,
      badge: i.status === "void" ? { text: "Void", tone: "neutral" } : i.status === "draft" ? { text: "Draft", tone: "neutral" } : Number(i.days_overdue) > 0 ? { text: `${i.days_overdue} days late`, tone: "danger" } : Number(i.balance) <= 0 ? { text: "Paid", tone: "ok" } : { text: "Open", tone: "warn" },
    }));
  } else if (view === "payments") {
    let q = db.from("fin_payment_balances_v").select("*").eq("book_id", b).order("received_on", { ascending: false });
    if (filter === "unapplied") q = q.eq("status", "active").gt("unapplied", 0);
    if (filter === "unverified") q = q.eq("status", "active").eq("verified", false);
    const { data } = await q;
    rows = ((data ?? []) as Row[]).map((p) => ({
      key: String(p.payment_id), title: `${p.number} · ${jobName(p.job_id)}`, amount: $(p.amount), basis: "Paid", href: jobLink(p.job_id),
      detail: `${d(p.received_on)} · ${p.method} · Applied ${$(p.applied)} · Unapplied ${$(p.unapplied)}`,
      badge: p.status === "void" ? { text: "Void", tone: "neutral" } : p.verified ? { text: "Verified", tone: "ok" } : { text: "Recorded, not verified", tone: "warn" },
    }));
  } else if (view === "costs") {
    const [{ data: ex }, { data: bills }] = await Promise.all([
      db.from("fin_expenses").select("id, number, job_id, spent_on, amount, description, status, cost_code_id").eq("book_id", b).order("spent_on", { ascending: false }),
      db.from("fin_vendor_bills").select("id, number, vendor_invoice_number, bill_date, due_date, total, status").eq("book_id", b).order("bill_date", { ascending: false }),
    ]);
    let E = (ex ?? []) as Row[], B = (bills ?? []) as Row[];
    if (filter === "expenses_pending") { E = E.filter((x) => x.status === "pending"); B = []; }
    if (filter === "bills_pending") { B = B.filter((x) => x.status === "pending_approval"); E = []; }
    if (filter === "bills_due") { B = B.filter((x) => x.status === "approved" && String(x.due_date) <= daysAhead(14)); E = []; }
    rows = [
      ...E.map((x) => ({ key: String(x.id), title: `${x.number} · ${x.description}`, amount: $(x.amount), basis: x.status === "approved" ? "Actual" : "Count", href: jobLink(x.job_id, "#costs"),
        detail: `Expense · ${d(x.spent_on)} · ${jobName(x.job_id)}${x.job_id && !x.cost_code_id ? " · no cost code" : ""}`, badge: { text: String(x.status), tone: (x.status === "approved" ? "ok" : x.status === "pending" ? "warn" : "neutral") as "ok" | "warn" | "neutral" } })),
      ...B.map((x) => ({ key: String(x.id), title: `${x.number} · Vendor #${x.vendor_invoice_number}`, amount: $(x.total), basis: x.status === "approved" ? "Actual" : "Count", href: null,
        detail: `Bill · ${d(x.bill_date)} · due ${d(x.due_date)}`, badge: { text: x.status === "pending_approval" ? "Waiting for approval" : String(x.status), tone: (String(x.due_date) < today && x.status === "approved" ? "danger" : x.status === "approved" ? "ok" : "warn") as "danger" | "ok" | "warn" } })),
    ];
  } else if (view === "commitments") {
    const { data } = await db.from("fin_commitment_balances_v").select("*").eq("book_id", b);
    let C = (data ?? []) as Row[];
    if (filter === "overrun") C = C.filter((c) => Number(c.billed) > Number(c.current_amount));
    rows = C.map((c) => ({ key: String(c.commitment_id), title: `${c.number} · ${c.title}`, amount: $(c.open_committed), basis: "Committed", href: jobLink(c.job_id, "#costs"),
      detail: `${jobName(c.job_id)} · Current ${$(c.current_amount)} · Billed ${$(c.billed)}`, badge: Number(c.billed) > Number(c.current_amount) ? { text: "Over committed", tone: "danger" } : { text: String(c.status), tone: "neutral" } }));
  } else if (view === "alerts") {
    let q = db.from("fin_alerts").select("id, job_id, kind, severity, status, details").eq("book_id", b).in("status", ["open", "acknowledged"]);
    if (filter) q = q.eq("kind", filter);
    const { data } = await q;
    rows = ((data ?? []) as Row[]).map((a) => ({ key: String(a.id), title: ALERT_LABELS[a.kind as AlertKind] ?? String(a.kind), detail: jobName(a.job_id), href: jobLink(a.job_id),
      badge: { text: SEVERITY_LABELS[a.severity as AlertSeverity] ?? String(a.severity), tone: a.severity === "action_required" ? "danger" : a.severity === "warning" ? "warn" : "neutral" } }));
  } else if (view === "review") {
    let q = db.from("fin_review_items").select("id, job_id, kind, entity_type, created_at").eq("book_id", b).eq("status", "open");
    if (filter === "uncoded") q = q.eq("kind", "uncoded_cost");
    const { data } = await q;
    rows = ((data ?? []) as Row[]).map((r) => ({ key: String(r.id), title: String(r.kind).replace(/_/g, " "), detail: `${jobName(r.job_id)} · ${r.entity_type}`, href: jobLink(r.job_id, "#review"), badge: { text: "Open", tone: "warn" } }));
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4" data-testid={`fin-records-${view}`} data-guide-page="financials.records">
      {crumbs}
      {state.ctx.access.sandbox && <SandboxBar sandbox canManage={state.ctx.access.permissions.includes("manage_financial_config")} />}
      <h1 className="text-3xl font-extrabold">{VIEWS[view]}{filter ? <span className="ml-2 text-base font-semibold text-muted">({filter.replace(/_/g, " ")})</span> : null}</h1>
      {doAction && <p className="text-sm text-ink-soft">Pick a job to continue.</p>}
      <nav aria-label="Record types" data-guide="fin.record-tabs" className="flex gap-1 overflow-x-auto border-b border-line">
        {(Object.keys(VIEWS) as View[]).map((v) => (
          <Link key={v} href={`/financials/records?view=${v}${doAction ? `&do=${doAction}` : ""}`} aria-current={v === view ? "page" : undefined}
            className={`-mb-px inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm font-semibold ${v === view ? "border-brand text-navy" : "border-transparent text-muted hover:text-ink"}`}>{VIEWS[v]}</Link>
        ))}
      </nav>
      {extra}
      {rows.length === 0 ? <p className="rounded-xl border border-dashed border-line-strong p-6 text-center text-sm text-ink-soft">Nothing here yet.</p> : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface" data-guide="fin.records-list">
          {rows.map((r) => {
            const inner = (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{r.title}</span>
                  {r.detail && <span className="block text-xs text-muted">{r.detail}</span>}
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {r.amount && <span className="tabular font-semibold">{r.amount}</span>}
                  <span className="flex gap-1">{r.basis && <BasisBadge basis={r.basis} />}{r.badge && <Badge tone={r.badge.tone}>{r.badge.text}</Badge>}</span>
                </span>
              </>
            );
            return <li key={r.key} data-search-id={r.key}>{r.href ? <Link href={r.href} className="flex items-center gap-3 px-4 py-3 hover:bg-black/5">{inner}</Link> : <div className="flex items-center gap-3 px-4 py-3">{inner}</div>}</li>;
          })}
        </ul>
      )}
    </div>
  );
}
