import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isFinancialsEnabled } from "@/lib/env";
import { SandboxBar } from "@/components/financials/sandbox-bar";
import { loadFinState } from "@/lib/financials/loaders";
import type { FinPermission } from "@/lib/financials/permissions";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { FinStateNotice } from "@/components/financials/fin-state-notice";

export const metadata: Metadata = { title: "All financial tools", robots: { index: false } };

interface Tool { label: string; href?: string; needs?: FinPermission; note?: string }
const GROUPS: { title: string; tools: Tool[] }[] = [
  { title: "Getting paid", tools: [
    { label: "Jobs & contracts", href: "/financials/records?view=jobs", needs: "view_project_financials" },
    { label: "Payment schedule milestones", href: "/financials/records?view=milestones", needs: "view_project_financials" },
    { label: "Invoices", href: "/financials/records?view=invoices", needs: "view_project_financials" },
    { label: "Draft invoices", href: "/financials/records?view=invoices&filter=draft", needs: "create_invoices" },
    { label: "Accounts receivable (aging, collections)", href: "/financials/receivables", needs: "view_project_financials" },
    { label: "Payments received", href: "/financials/records?view=payments", needs: "view_company_financials" },
    { label: "Unapplied payments", href: "/financials/records?view=payments&filter=unapplied", needs: "view_company_financials" },
  ] },
  { title: "Job costs", tools: [
    { label: "Expenses & receipts", href: "/financials/records?view=costs", needs: "view_project_financials" },
    { label: "Vendor bills", href: "/financials/records?view=costs&filter=bills_pending", needs: "view_company_financials" },
    { label: "Overhead & company bills (rent, insurance, software)", href: "/financials/overhead", needs: "record_bills" },
    { label: "Commitments (subcontracts & POs)", href: "/financials/records?view=commitments", needs: "view_project_financials" },
    { label: "Budget vs actual by job", href: "/financials/records?view=jobs", needs: "view_project_financials" },
  ] },
  { title: "Reports", tools: [
    { label: "Profit & Loss (by period)", href: "/financials/reports", needs: "view_company_financials" },
    { label: "Profit by project", href: "/financials/reports?view=jobs", needs: "view_company_financials" },
    { label: "Profit by trade", href: "/financials/reports?view=trades", needs: "view_company_financials" },
  ] },
  { title: "Cash, banks & tax", tools: [
    { label: "Cash-flow forecast", href: "/financials/cash", needs: "view_company_financials" },
    { label: "Connected banks (read-only)", href: "/financials/banks", needs: "reconcile" },
    { label: "Tax & regulatory updates", href: "/financials/tax", needs: "view_company_financials" },
    { label: "Tax setup & exemption certificates", href: "/financials/tax?view=setup", needs: "view_company_financials" },
  ] },
  { title: "Accounting", tools: [
    { label: "Accountant reports & CSV export", href: "/financials/accounting/reports", needs: "view_company_financials" },
    { label: "Bank statement import & reconciliation", href: "/financials/accounting/bank", needs: "view_company_financials" },
    { label: "Transactions", href: "/financials/accounting/transactions", needs: "view_company_financials" },
    { label: "Chart of accounts", href: "/financials/accounting/accounts", needs: "view_company_financials" },
    { label: "Audit trail", href: "/financials/accounting/audit", needs: "view_company_financials" },
  ] },
  { title: "Keep it clean", tools: [
    { label: "Alerts", href: "/financials/records?view=alerts", needs: "view_project_financials" },
    { label: "Needs review", href: "/financials/records?view=review", needs: "view_project_financials" },
  ] },
  { title: "Settings", tools: [
    { label: "Business & Trade Configuration", href: "/company/business-config", needs: "manage_financial_config" },
    { label: "AI & Automation", href: "/company/ai-automation", needs: "manage_financial_config" },
  ] },
  { title: "Coming later", tools: [
    { label: "Sending invoice & receipt emails from Built2Bid", note: "Turns on after approval" },
    { label: "Progress billing (schedule of values)", note: "Phase 1b" }, { label: "Retainage", note: "Phase 1b" },
    { label: "Time & materials billing", note: "Later" }, { label: "Service-call billing", note: "Later" },
    { label: "Inventory tracking", note: "Later" }, { label: "Crew utilization", note: "Later" },
    { label: "Online card / ACH payments", note: "Phase 3" },
  ] },
];

/** Every Financials tool in one place, whatever the trade profile chose for the home page. */
export default async function AllTools() {
  if (!isFinancialsEnabled()) notFound();
  const state = await loadFinState(await createClient());
  const crumbs = <Breadcrumbs className="mb-3" items={[{ label: "Financials", href: "/financials" }, { label: "All tools" }]} />;
  if (state.kind !== "ready") return <div className="mx-auto max-w-4xl space-y-4">{crumbs}<h1 className="text-3xl font-extrabold">All financial tools</h1><FinStateNotice state={state} /></div>;
  const perms = state.ctx.access.permissions;
  return (
    <div className="mx-auto max-w-5xl space-y-5" data-testid="fin-tools" data-guide-page="financials.tools">
      {crumbs}
      {state.ctx.access.sandbox && <SandboxBar sandbox canManage={perms.includes("manage_financial_config")} />}
      <h1 className="text-3xl font-extrabold">All financial tools</h1>
      <p className="text-ink-soft">Your home page shows what fits your trade. Everything is always here too.</p>
      <div className="grid gap-4 md:grid-cols-2" data-guide="fin.tool-groups">
        {GROUPS.map((g) => (
          <section key={g.title} className="rounded-xl border border-line bg-surface p-4">
            <h2 className="font-display text-lg font-extrabold">{g.title}</h2>
            <ul className="mt-2 divide-y divide-line">
              {g.tools.map((t) => {
                const allowed = !t.needs || perms.includes(t.needs);
                return (
                  <li key={t.label} className="flex min-h-11 items-center gap-2 py-1 text-sm">
                    {t.href && allowed ? <Link href={t.href} className="font-semibold text-accent-ink underline">{t.label}</Link> : <span className={allowed ? "" : "text-muted"}>{t.label}</span>}
                    <span className="ml-auto text-xs text-muted">{t.note ?? (allowed ? "" : "Not in your role")}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
