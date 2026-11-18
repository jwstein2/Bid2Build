import Link from "next/link";
import type { ReactNode } from "react";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Notice } from "@/components/ui/misc";
import { FinStateNotice } from "@/components/financials/fin-state-notice";
import { SandboxBar } from "@/components/financials/sandbox-bar";
import type { FinState } from "@/lib/financials/loaders";
import { ACCOUNTANT_NAV, type AccountantNavKey } from "@/lib/financials/accounting";
import { cn } from "@/lib/cn";

/** Page-guide keys for the accounting pages (src/lib/features/page-guides.ts). */
export const GUIDE_PAGE = { queue: "financials.accounting", transactions: "financials.accounting.transactions", bank: "financials.accounting.bank", reports: "financials.accounting.reports", audit: "financials.accounting.audit", accounts: "financials.accounting.accounts" } as const;
export type AccountingGuide = (typeof GUIDE_PAGE)[keyof typeof GUIDE_PAGE];

/** Accountant Mode navigation: one row of real links (scrolls sideways on phones, never wraps into a menu). */
export function AccountantNav({ active, className }: { active?: AccountantNavKey; className?: string }) {
  return (
    <nav aria-label="Accounting" className={cn("-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0", className)} data-guide="fin.acct-nav" data-testid="fin-acct-nav">
      <ul className="flex min-w-max gap-1 border-b border-line">
        {ACCOUNTANT_NAV.map((n) => (
          <li key={n.key}>
            <Link href={n.href} aria-current={active === n.key ? "page" : undefined}
              className={cn("inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-semibold", active === n.key ? "border-brand text-ink" : "border-transparent text-ink-soft hover:text-ink")}>
              {n.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Page frame for /financials/accounting/*: breadcrumbs, title, the accounting navigation, and the access
 * check. Every page here needs "view company financials"; the queries re-check it through RLS and RPCs.
 */
export function AccountingShell({ state, title, active, intro, guide, actions, children }: {
  state: FinState; title: string; active?: AccountantNavKey; intro?: ReactNode; guide: AccountingGuide; actions?: ReactNode; children?: ReactNode;
}) {
  const crumbs = <Breadcrumbs className="mb-3" items={[{ label: "Financials", href: "/financials" }, { label: "Accounting", href: "/financials/accounting" }, { label: title }]} />;
  if (state.kind !== "ready") return <div className="mx-auto max-w-4xl space-y-4">{crumbs}<FinStateNotice state={state} /></div>;
  const perms = state.ctx.access.permissions;
  if (!perms.includes("view_company_financials")) {
    return <div className="mx-auto max-w-4xl space-y-4">{crumbs}<Notice title="Accounting needs a company financial role">Ask your company owner for a Bookkeeper, Accountant or Financial admin seat. Your project financials are still on the Financials home.</Notice></div>;
  }
  return (
    <div className="mx-auto max-w-7xl space-y-4" data-guide-page={guide} data-testid="fin-accounting">
      {state.ctx.access.sandbox && <SandboxBar sandbox canManage={perms.includes("manage_financial_config")} />}
      {crumbs}
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Accounting</p>
          <h1 className="text-3xl font-extrabold">{title}</h1>
          {intro && <p className="mt-1 max-w-3xl text-sm text-ink-soft">{intro}</p>}
        </div>
        {actions}
      </header>
      <AccountantNav active={active} />
      {state.ctx.access.readOnly && <Notice tone="warn" title="Read-only">The Financials add-on lapsed. You can read and export everything; matching and reconciling are paused.</Notice>}
      {children}
    </div>
  );
}
