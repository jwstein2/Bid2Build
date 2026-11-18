/**
 * V6.9 capabilities and dashboard widgets.
 *
 * Capabilities map onto the existing financial permission keys (public.fin_permission_keys()), so no role gains
 * or loses anything by this release and the database stays the authority. Mirror of public.tb_capability_key()
 * in supabase/migrations/20261226001000_tax_banking.sql (a unit test keeps them in sync).
 *
 * The V6.7 capability registry and the V6.6 widget registry can import CAPABILITIES / WIDGETS from here: the shape
 * (key, label, group, needs) is plain data. Until those land, the Financials home cards use the same definitions.
 * Switching Contractor <-> Accountant mode never changes what these allow.
 */
import type { FinPermission } from "@/lib/financials/permissions";

export const CAPABILITIES = {
  "tax.view_config": { label: "View tax configuration", group: "Tax", needs: "view_company_financials" },
  "tax.manage_settings": { label: "Change tax settings", group: "Tax", needs: "manage_financial_config" },
  "tax.review_alerts": { label: "Review tax alerts", group: "Tax", needs: "view_company_financials" },
  "bank.view_balances": { label: "View bank balances", group: "Banking", needs: "reconcile" },
  "bank.connect": { label: "Connect banks", group: "Banking", needs: "manage_financial_config" },
  "bank.disconnect": { label: "Disconnect banks", group: "Banking", needs: "manage_financial_config" },
  "bank.view_transactions": { label: "View bank transactions", group: "Banking", needs: "reconcile" },
  "bank.reconcile": { label: "Reconcile accounts", group: "Banking", needs: "reconcile" },
  "cash.view_forecast": { label: "View company cash-flow forecasts", group: "Cash flow", needs: "view_company_financials" },
  "cash.manage_plan": { label: "Add planned cash events", group: "Cash flow", needs: "reconcile" },
  "reports.view": { label: "View financial reports", group: "Reports", needs: "view_company_financials" },
} as const satisfies Record<string, { label: string; group: string; needs: FinPermission }>;

export type Capability = keyof typeof CAPABILITIES;
export const can = (perms: readonly string[], cap: Capability) => perms.includes(CAPABILITIES[cap].needs);

/**
 * Forecast detail follows bank access: someone who can see the forecast but not bank balances sees the net change
 * from planned events (starting at $0), never the bank-reported balance.
 */
export const forecastStartsFromBank = (perms: readonly string[]) => can(perms, "bank.view_balances");

export interface WidgetDef {
  key: string;
  title: string;
  description: string;
  needs: readonly Capability[];
  /** Licensed feature: the Financials add-on (fin_entitlement active, or read-only when lapsed). */
  entitlement: "financials";
  sizes: readonly ("sm" | "md" | "lg")[];
  defaultSize: "sm" | "md" | "lg";
  href: string;
}

export const WIDGETS: readonly WidgetDef[] = [
  { key: "tax_updates", title: "Tax & Compliance Updates", description: "Recent verified tax changes, upcoming effective dates, data freshness and items to review.",
    needs: ["tax.review_alerts"], entitlement: "financials", sizes: ["sm", "md", "lg"], defaultSize: "md", href: "/financials/tax" },
  { key: "cash_position", title: "Connected Banks & Cash Flow", description: "Bank-reported balance next to the projected balance, expected inflows and outflows, last bank update.",
    needs: ["cash.view_forecast"], entitlement: "financials", sizes: ["md", "lg"], defaultSize: "lg", href: "/financials/cash" },
];
