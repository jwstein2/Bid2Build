/**
 * Command center actions: things a user can open from search ("new invoice", "bank reconcile", "profit loss").
 *
 * Safety rules:
 *   - An action only ever NAVIGATES. Anything with financial consequences opens its normal review form
 *     (e.g. the invoice or payment form with its own Save button); nothing is created, sent, paid, deleted or
 *     changed by picking a suggestion.
 *   - An action is offered only when the caller passes the same checks as the page it opens: plan (Premium),
 *     company permission, Financials permission on the current book, feature switch, platform admin.
 *     The pages and their APIs still enforce everything again.
 *   - In the practice (sandbox) book, Financials actions are labelled "Practice book".
 */

import { featureForPath, type FeatureId } from "@/lib/access/capabilities";
import { restrictedFor, type EffectiveAccess } from "@/lib/access/effective";

export interface SearchCaps {
  premium: boolean;
  admin: boolean;
  company: { id: string; role: string; perms: string[] } | null;
  fin: { book: string; sandbox: boolean; perms: string[] } | null;
  flags: { pm: boolean; financials: boolean };
  /** V6.7 workspace access: an action is offered only when the feature its page belongs to is on. */
  access?: EffectiveAccess | null;
}

/** Feature switches from Team & Access (V6.7): hide actions whose page is turned off for this person. */
function workspaceAllows(c: SearchCaps, href: string): boolean {
  if (!c.access) return true;
  const f = featureForPath(href.split("?")[0].split("#")[0]);
  return !f || !restrictedFor(c.access, { feature: f.id as FeatureId });
}
/** Every action check goes through here. */
export const actionAllowed = (a: CommandAction, c: SearchCaps) => a.allowed(c) && workspaceAllows(c, a.href);

export interface CommandAction {
  id: string;
  label: string;
  hint: string;
  href: string;
  keywords: string[];
  section: "create" | "open" | "finance" | "team" | "settings" | "admin";
  /** Financial consequences: opens a review form, never runs. */
  reviewForm?: boolean;
  comingSoon?: boolean;
  allowed: (c: SearchCaps) => boolean;
}

const co = (c: SearchCaps, perm: string) => !c.company || c.company.perms.includes(perm);
const anyCo = (c: SearchCaps, ...perms: string[]) => !c.company || perms.some((p) => c.company!.perms.includes(p));
const fin = (c: SearchCaps, perm: string) => c.flags.financials && Boolean(c.fin?.perms.includes(perm));
const finView = (c: SearchCaps) => c.flags.financials && Boolean(c.fin && (c.fin.perms.includes("view_company_financials") || c.fin.perms.includes("view_project_financials")));

export const ACTIONS: CommandAction[] = [
  { id: "new-bid", label: "Create New Bid", hint: "Start an estimate", href: "/bids", section: "create", keywords: ["new bid", "create bid", "new estimate", "create estimate", "new quote", "start bid", "start estimate"], allowed: (c) => anyCo(c, "create_estimates") },
  { id: "add-customer", label: "Add Customer", hint: "Customers", href: "/dashboard/customers/new", section: "create", keywords: ["add customer", "new customer", "create customer", "new client", "add client"], allowed: (c) => anyCo(c, "create_estimates", "view_company_bids") },
  { id: "schedule-project", label: "Schedule a Project", hint: "Projects", href: "/projects/new", section: "create", keywords: ["schedule project", "new project", "create project", "schedule job", "new schedule"], allowed: (c) => c.flags.pm && co(c, "create_schedules") },
  { id: "create-invoice", label: "Create Invoice", hint: "Pick a job, then review the invoice", href: "/financials/records?view=jobs&do=invoice", section: "finance", reviewForm: true, keywords: ["new invoice", "create invoice", "invoice customer", "bill customer", "send invoice"], allowed: (c) => fin(c, "create_invoices") },
  { id: "record-payment", label: "Record Payment", hint: "Pick a job, then review the payment", href: "/financials/records?view=jobs&do=payment", section: "finance", reviewForm: true, keywords: ["record payment", "customer payment", "receive payment", "log payment", "receipt"], allowed: (c) => fin(c, "record_payments") },
  { id: "add-expense", label: "Add Expense", hint: "Pick a job, then review the expense", href: "/financials/records?view=jobs&do=expense", section: "finance", reviewForm: true, keywords: ["add expense", "new expense", "record expense", "receipt expense"], allowed: (c) => fin(c, "record_expenses") },
  { id: "add-bill", label: "Enter Vendor Bill", hint: "Pick a job, then review the bill", href: "/financials/records?view=jobs&do=bill", section: "finance", reviewForm: true, keywords: ["enter bill", "add bill", "new bill", "vendor bill", "vendor invoice"], allowed: (c) => fin(c, "record_bills") },
  { id: "open-pl", label: "Open Profit & Loss", hint: "Financial reports", href: "/financials/reports", section: "finance", keywords: ["profit loss", "profit and loss", "p&l", "pnl", "income statement", "reports", "financial reports"], allowed: (c) => fin(c, "view_company_financials") },
  { id: "view-ar", label: "View Accounts Receivable", hint: "Who owes you", href: "/financials/receivables", section: "finance", keywords: ["accounts receivable", "receivables", "a/r", "ar", "aging", "who owes", "outstanding invoices"], allowed: finView },
  { id: "view-costs", label: "View Bills & Expenses", hint: "Accounts payable", href: "/financials/records?view=costs", section: "finance", keywords: ["accounts payable", "a/p", "ap", "payables", "bills", "costs"], allowed: finView },
  { id: "reconcile", label: "Reconcile Bank", hint: "Bank connection", href: "/financials", section: "finance", comingSoon: true, keywords: ["bank reconcile", "reconcile bank", "reconciliation", "bank feed", "match transactions"], allowed: (c) => fin(c, "reconcile") || fin(c, "view_company_financials") },
  { id: "financials", label: "Open Financials", hint: "Know Your Numbers", href: "/financials", section: "finance", keywords: ["financials", "accounting", "books", "money", "cash"], allowed: finView },
  { id: "open-bids", label: "Open Bids", hint: "Your bids", href: "/dashboard", section: "open", keywords: ["bids", "my bids", "estimates", "quotes", "dashboard"], allowed: () => true },
  { id: "team-pipeline", label: "Open Team Pipeline", hint: "Company bids", href: "/company/pipeline", section: "open", keywords: ["pipeline", "team bids", "company bids", "sales pipeline"], allowed: (c) => Boolean(c.company && (c.company.perms.includes("view_team_bids") || c.company.perms.includes("view_company_bids"))) },
  { id: "open-customers", label: "Open Customers", hint: "Customer list", href: "/dashboard/customers", section: "open", keywords: ["customers", "clients", "customer list"], allowed: () => true },
  { id: "open-projects", label: "Open Projects", hint: "All projects", href: "/projects", section: "open", keywords: ["projects", "jobs", "open projects", "project list"], allowed: (c) => c.flags.pm && co(c, "view_schedules") },
  { id: "view-schedule", label: "View Schedule", hint: "Projects calendar", href: "/projects", section: "open", keywords: ["schedule", "calendar", "gantt", "view schedule"], allowed: (c) => c.flags.pm && co(c, "view_schedules") },
  { id: "saved-items", label: "Open Saved Items & Pricing", hint: "Pricing library", href: "/dashboard/items", section: "open", keywords: ["saved items", "pricing library", "price list", "items", "catalog", "assemblies"], allowed: (c) => c.premium },
  { id: "import-pricing", label: "Import Supplier Pricing", hint: "Upload a price list (you review before saving)", href: "/dashboard/items/import", section: "open", keywords: ["import pricing", "supplier pricing", "price import", "upload price list", "import supplier"], allowed: (c) => c.premium },
  { id: "templates", label: "Open Proposal Templates", hint: "Templates", href: "/dashboard/templates", section: "open", keywords: ["templates", "proposal templates"], allowed: (c) => c.premium },
  { id: "add-sub", label: "Add Subcontractor", hint: "Team & subcontractors", href: "/projects/team", section: "team", keywords: ["add subcontractor", "new subcontractor", "add sub", "new sub", "add crew", "add employee"], allowed: (c) => c.flags.pm },
  { id: "suppliers", label: "Open Supplier Directory", hint: "Suppliers", href: "/projects/team/suppliers", section: "team", keywords: ["suppliers", "supplier directory", "vendors"], allowed: (c) => c.flags.pm },
  { id: "time-clock", label: "Open Time Clock", hint: "Employees & time", href: "/projects/team/time", section: "team", keywords: ["time clock", "timesheet", "clock in", "hours", "employees"], allowed: (c) => c.flags.pm },
  { id: "sub-records", label: "Open Subcontractor Records", hint: "W-9 and insurance", href: "/projects/team/subs", section: "team", keywords: ["w9", "w-9", "insurance", "coi", "sub records", "compliance"], allowed: (c) => c.flags.pm },
  { id: "1099", label: "Open 1099 Totals", hint: "Year-end", href: "/projects/team/1099", section: "team", keywords: ["1099", "1099s", "tax forms"], allowed: (c) => c.flags.pm },
  { id: "company-settings", label: "Open Company Settings", hint: "Company profile", href: "/settings/company", section: "settings", keywords: ["company settings", "company profile", "business info", "logo", "settings"], allowed: () => true },
  { id: "company-users", label: "Manage Users", hint: "Enterprise users", href: "/company/users", section: "settings", keywords: ["users", "team members", "invite", "seats", "permissions"], allowed: (c) => Boolean(c.company?.perms.includes("manage_users")) },
  { id: "subscription", label: "Open Subscription", hint: "View your plan (changes need confirmation there)", href: "/settings/billing", section: "settings", keywords: ["subscription", "billing", "plan", "upgrade"], allowed: () => true },
  { id: "account", label: "Open Account Settings", hint: "Your account", href: "/settings/account", section: "settings", keywords: ["account", "profile", "password", "email settings", "signature"], allowed: () => true },
  { id: "business-config", label: "Open Business & Trades", hint: "Financials setup", href: "/company/business-config", section: "settings", keywords: ["business config", "trades", "cost codes", "tax setup"], allowed: (c) => fin(c, "manage_financial_config") },
  { id: "whats-new", label: "What's New", hint: "Latest features", href: "/whats-new", section: "settings", keywords: ["whats new", "what's new", "updates", "release notes"], allowed: () => true },
  // Owner administration (platform admins only).
  { id: "admin", label: "Admin: Overview", hint: "Owner administration", href: "/admin", section: "admin", keywords: ["admin", "owner", "command center"], allowed: (c) => c.admin },
  { id: "admin-customers", label: "Admin: Customers", hint: "Owner administration", href: "/admin/customers", section: "admin", keywords: ["admin customers", "accounts", "users"], allowed: (c) => c.admin },
  { id: "admin-revenue", label: "Admin: Revenue", hint: "Owner administration", href: "/admin/revenue", section: "admin", keywords: ["admin revenue", "mrr", "revenue"], allowed: (c) => c.admin },
  { id: "admin-costs", label: "Admin: Costs", hint: "Owner administration", href: "/admin/costs", section: "admin", keywords: ["admin costs", "costs", "spend"], allowed: (c) => c.admin },
  { id: "admin-flags", label: "Admin: Feature Flags", hint: "Owner administration", href: "/admin/flags", section: "admin", keywords: ["flags", "feature flags"], allowed: (c) => c.admin },
  { id: "admin-complimentary", label: "Admin: Complimentary Access", hint: "Owner administration", href: "/admin/complimentary", section: "admin", keywords: ["complimentary", "comp", "grant access"], allowed: (c) => c.admin },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9&/ ]+/g, " ").replace(/\s+/g, " ").trim();

/** Score an action against the raw query: 0 = no match. Whole-phrase keyword > keyword prefix > all words present. */
export function matchAction(a: CommandAction, raw: string): number {
  const q = norm(raw);
  if (q.length < 2) return 0;
  const words = q.split(" ");
  let best = 0;
  for (const k of [a.label, ...a.keywords].map(norm)) {
    if (k === q) best = Math.max(best, 100);
    else if (k.startsWith(q)) best = Math.max(best, 80);
    else if (q.length >= 3 && k.split(" ").some((w) => w.startsWith(q))) best = Math.max(best, 60);
    else if (words.length > 1 && words.every((w) => k.split(" ").some((kw) => kw.startsWith(w)))) best = Math.max(best, 70);
  }
  return best;
}

export interface ActionResult { id: string; label: string; hint: string; href: string; section: CommandAction["section"]; reviewForm: boolean; comingSoon: boolean; sandbox: boolean }

export function findActions(raw: string, caps: SearchCaps, limit = 5): ActionResult[] {
  return scoredActions(raw, caps, limit).map(({ a }) => toActionResult(a, caps));
}

/** Allowed actions matching the query, best first, with their match score (80+ = the query reads as a command). */
export function scoredActions(raw: string, caps: SearchCaps, limit = 5): { a: CommandAction; s: number }[] {
  return ACTIONS.filter((a) => actionAllowed(a, caps))
    .map((a) => ({ a, s: matchAction(a, raw) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s || ACTIONS.indexOf(x.a) - ACTIONS.indexOf(y.a))
    .slice(0, limit);
}

export function toActionResult(a: CommandAction, caps: SearchCaps): ActionResult {
  return { id: a.id, label: a.label, hint: a.hint, href: a.href, section: a.section, reviewForm: Boolean(a.reviewForm), comingSoon: Boolean(a.comingSoon), sandbox: a.section === "finance" && Boolean(caps.fin?.sandbox) };
}

/** Suggested actions for an empty search box (favorites first, then the common ones the user may use). */
export function defaultActions(caps: SearchCaps, favorites: string[] = []): ActionResult[] {
  const allowed = ACTIONS.filter((a) => actionAllowed(a, caps) && !a.comingSoon);
  const fav = favorites.map((id) => allowed.find((a) => a.id === id)).filter((a): a is CommandAction => Boolean(a));
  const common = ["new-bid", "add-customer", "create-invoice", "open-projects", "open-pl"].map((id) => allowed.find((a) => a.id === id)).filter((a): a is CommandAction => Boolean(a));
  return [...new Map([...fav, ...common].map((a) => [a.id, a])).values()].slice(0, 6).map((a) => toActionResult(a, caps));
}
