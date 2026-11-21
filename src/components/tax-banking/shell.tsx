import Link from "next/link";
import type { ReactNode } from "react";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Notice } from "@/components/ui/misc";
import { FinStateNotice } from "@/components/financials/fin-state-notice";
import { SandboxBar } from "@/components/financials/sandbox-bar";
import type { FinState } from "@/lib/financials/loaders";
import { can, type Capability } from "@/lib/tax-banking/capabilities";
import { cn } from "@/lib/cn";

export const TB_NAV = [
  { key: "cash", label: "Cash flow", href: "/financials/cash", cap: "cash.view_forecast" },
  { key: "banks", label: "Connected banks", href: "/financials/banks", cap: "bank.view_balances" },
  { key: "tax", label: "Tax & regulatory updates", href: "/financials/tax", cap: "tax.view_config" },
] as const satisfies readonly { key: string; label: string; href: string; cap: Capability }[];
export type TbNavKey = (typeof TB_NAV)[number]["key"];

/** Page frame for the V6.9 pages: breadcrumbs, title, a row of links, and the capability check (re-checked by RLS/RPCs). */
export function TbShell({ state, title, active, cap, intro, actions, children }: {
  state: FinState; title: string; active: TbNavKey; cap: Capability; intro?: ReactNode; actions?: ReactNode; children?: ReactNode;
}) {
  const crumbs = <Breadcrumbs className="mb-3" items={[{ label: "Financials", href: "/financials" }, { label: title }]} />;
  if (state.kind !== "ready") return <div className="mx-auto max-w-4xl space-y-4">{crumbs}<FinStateNotice state={state} /></div>;
  const perms = state.ctx.access.permissions;
  if (!can(perms, cap)) {
    return <div className="mx-auto max-w-4xl space-y-4">{crumbs}<h1 className="text-3xl font-extrabold">{title}</h1>
      <Notice title="Your financial role doesn't include this">Ask your company owner for a role that includes it (Bookkeeper, Accountant or Financial admin). Nothing here changes what you can already see.</Notice></div>;
  }
  return (
    <div className="mx-auto max-w-7xl space-y-4" data-testid={`tb-${active}`}>
      {state.ctx.access.sandbox && <SandboxBar sandbox canManage={perms.includes("manage_financial_config")} />}
      {crumbs}
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-[min(100%,20rem)] flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Financials</p>
          <h1 className="text-3xl font-extrabold">{title}</h1>
          {intro && <p className="mt-1 max-w-3xl text-sm text-ink-soft">{intro}</p>}
        </div>
        {actions && <div className="min-w-0 max-w-full">{actions}</div>}
      </header>
      <nav aria-label="Cash, banks and tax" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-1 border-b border-line">
          {TB_NAV.filter((n) => can(perms, n.cap)).map((n) => (
            <li key={n.key}><Link href={n.href} aria-current={active === n.key ? "page" : undefined}
              className={cn("inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-semibold", active === n.key ? "border-brand text-ink" : "border-transparent text-ink-soft hover:text-ink")}>{n.label}</Link></li>
          ))}
        </ul>
      </nav>
      {state.ctx.access.readOnly && <Notice tone="warn" title="Read-only">The Financials add-on lapsed. Everything stays readable; changes are paused.</Notice>}
      {children}
    </div>
  );
}
