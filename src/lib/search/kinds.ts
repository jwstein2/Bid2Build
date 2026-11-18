/**
 * Universal search result kinds: category, label, status wording and where a result opens.
 * Links always point at the real record's existing page (no search-only copies). `#r-<id>` asks the page to
 * scroll to and highlight that row (see components/search/search-focus.tsx).
 */

export const SEARCH_KINDS = [
  "customer", "estimate", "project", "task", "scope", "change_order", "signature", "invoice", "payment",
  "bill", "expense", "vendor", "resource", "supplier", "saved_item", "assembly", "photo", "message",
] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];
export const FIN_KINDS: SearchKind[] = ["invoice", "payment", "bill", "expense", "vendor"];
export const PM_KINDS: SearchKind[] = ["project", "task", "scope", "resource", "supplier", "photo", "change_order"];
export const isSearchKind = (k: unknown): k is SearchKind => typeof k === "string" && (SEARCH_KINDS as readonly string[]).includes(k);

/** One row as the database returns it. */
export interface SearchRow {
  kind: SearchKind; id: string; title: string; subtitle: string | null; status: string | null; reason: string | null; score: string | number;
  estimate_id: string | null; schedule_id: string | null; customer_id: string | null; customer_name: string | null; parent_id: string | null;
  owned: boolean; in_context: boolean; workspace: "live" | "sandbox"; amount: string | number | null; record_date: string | null;
  updated_at: string | null; total_kind: number; total_all: number;
}

/** What the browser gets: everything needed to render and open a result. */
export interface SearchResult {
  kind: SearchKind; id: string; group: GroupId; title: string; subtitle: string | null; kindLabel: string;
  status: { key: string; label: string; tone: Tone } | null; reason: string | null; href: string;
  inContext: boolean; sandbox: boolean; amount: string | null; date: string | null; customerName: string | null;
  customerId: string | null; estimateId: string | null;
}
export type Tone = "neutral" | "ok" | "warn" | "danger" | "info";

export type GroupId = "customers" | "projects" | "bids" | "proposals" | "invoices" | "tasks" | "team" | "accounting" | "library" | "documents" | "messages" | "admin" | "actions";
export const GROUPS: { id: GroupId; label: string; kinds: SearchKind[] }[] = [
  { id: "customers", label: "Customers", kinds: ["customer"] },
  { id: "projects", label: "Projects", kinds: ["project", "scope"] },
  { id: "bids", label: "Bids & Estimates", kinds: ["estimate"] },
  { id: "proposals", label: "Proposals & Change Orders", kinds: ["signature", "change_order"] },
  { id: "invoices", label: "Invoices & Payments", kinds: ["invoice", "payment"] },
  { id: "tasks", label: "Schedules & Tasks", kinds: ["task"] },
  { id: "team", label: "Team & Subcontractors", kinds: ["resource", "supplier"] },
  { id: "accounting", label: "Accounting", kinds: ["bill", "expense", "vendor"] },
  { id: "library", label: "Pricing Library", kinds: ["saved_item", "assembly"] },
  { id: "documents", label: "Documents & Photos", kinds: ["photo"] },
  { id: "messages", label: "Communications", kinds: ["message"] },
];
export const groupOf = (k: SearchKind): GroupId => GROUPS.find((g) => g.kinds.includes(k))!.id;

const KIND_LABEL: Record<SearchKind, string> = {
  customer: "Customer", estimate: "Bid", project: "Project", task: "Task", scope: "Trade scope", change_order: "Change order",
  signature: "Signed proposal", invoice: "Invoice", payment: "Customer payment", bill: "Vendor bill", expense: "Expense", vendor: "Vendor",
  resource: "Team", supplier: "Supplier", saved_item: "Saved item", assembly: "Assembly", photo: "Photo", message: "Customer message",
};

const S = (label: string, tone: Tone = "neutral") => ({ label, tone });
const STATUS: Partial<Record<SearchKind, Record<string, { label: string; tone: Tone }>>> = {
  estimate: { draft: S("Draft"), ready_for_review: S("Ready for review", "info"), approved: S("Approved", "info"), sent: S("Sent", "info"), pending: S("Pending", "info"),
    won: S("Won", "ok"), scheduled: S("Scheduled", "ok"), in_progress: S("In progress", "ok"), completed: S("Completed", "ok"), lost: S("Lost", "danger"), archived: S("Archived") },
  project: { won: S("Approved — Needs Review", "warn"), scheduled: S("Scheduled", "info"), in_progress: S("In Progress", "ok"), completed: S("Completed", "ok"),
    schedule_draft: S("Draft schedule"), schedule_active: S("Scheduled", "info"), archived: S("Archived") },
  task: { not_started: S("Not started"), in_progress: S("In progress", "info"), complete: S("Complete", "ok"), delayed: S("Delayed", "danger"), on_hold: S("On hold", "warn") },
  change_order: { draft: S("Draft"), sent: S("Sent", "info"), approved: S("Approved", "ok"), signed: S("Signed", "ok"), declined: S("Declined", "danger"), void: S("Void") },
  signature: { signed: S("Signed", "ok") },
  invoice: { draft: S("Draft"), open: S("Open", "info"), overdue: S("Overdue", "danger"), paid: S("Paid", "ok"), void: S("Void") },
  payment: { recorded: S("Recorded", "info"), verified: S("Verified", "ok"), void: S("Void") },
  bill: { pending_approval: S("Needs approval", "warn"), approved: S("Approved", "ok"), void: S("Void") },
  expense: { pending: S("Needs approval", "warn"), approved: S("Approved", "ok"), rejected: S("Rejected", "danger"), void: S("Void") },
  vendor: { active: S("Active"), archived: S("Archived") },
  supplier: { active: S("Active"), archived: S("Archived") },
  saved_item: { favorite: S("Favorite", "info") },
  message: { draft: S("Draft"), scheduled: S("Scheduled", "info"), awaiting_review: S("Needs review", "warn"), approved: S("Approved", "info"), sending: S("Sending", "info"),
    sent: S("Sent", "ok"), delivered: S("Delivered", "ok"), failed: S("Failed", "danger"), paused: S("Paused", "warn"), replied: S("Replied", "ok"), canceled: S("Canceled"), skipped: S("Skipped") },
};

export function statusOf(kind: SearchKind, key: string | null): SearchResult["status"] {
  if (!key) return null;
  if (kind === "resource") return key.endsWith("_archived") ? { key, label: "Archived", tone: "neutral" } : null;
  const s = STATUS[kind]?.[key];
  return s ? { key, ...s } : { key, label: key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()), tone: "neutral" };
}

export function kindLabel(kind: SearchKind, status: string | null): string {
  if (kind === "resource") return status?.startsWith("staff") ? "Employee" : status?.startsWith("subcontractor") ? "Subcontractor" : "Crew";
  return KIND_LABEL[kind];
}

const focus = (id: string) => `#r-${id}`;
/** Where a result opens: always the real record's own page. */
export function hrefFor(r: Pick<SearchRow, "kind" | "id" | "estimate_id" | "schedule_id" | "customer_id" | "parent_id" | "owned" | "status">): string {
  const est = r.estimate_id, sched = r.schedule_id;
  const bid = est ? (r.owned ? `/estimates/${est}` : `/company/bids/${est}`) : "/dashboard";
  switch (r.kind) {
    case "customer": return `/dashboard/customers/${r.id}`;
    case "estimate": return r.owned ? `/estimates/${r.id}` : `/company/bids/${r.id}`;
    case "project": return `/projects/${r.id}`;
    case "task": return sched ? `/projects/${sched}?tab=schedule${focus(r.id)}` : "/projects";
    case "scope": return sched ? `/projects/${sched}?tab=scope${focus(r.id)}` : bid;
    case "change_order": return sched ? `/projects/${sched}?tab=documents${focus(r.id)}` : bid;
    case "signature": return `/signed/${r.id}`;
    case "invoice": return est ? `/financials/jobs/${est}${focus(r.id)}` : `/financials/records?view=invoices${focus(r.id)}`;
    case "payment": return `/financials/records?view=payments${focus(r.id)}`;
    case "bill": return `/financials/records?view=costs${focus(r.id)}`;
    case "expense": return `/financials/records?view=costs${focus(r.id)}`;
    case "vendor": return r.parent_id ? `/projects/team/subs/${r.parent_id}` : `/financials/records?view=costs`;
    case "resource": return r.status?.startsWith("subcontractor") ? `/projects/team/subs/${r.id}` : r.status?.startsWith("staff") ? `/projects/team/time${focus(r.id)}` : `/projects/team${focus(r.id)}`;
    case "supplier": return `/projects/team/suppliers${focus(r.id)}`;
    case "saved_item": case "assembly": return `/dashboard/items${focus(r.id)}`;
    case "photo": return sched ? `/projects/${sched}?tab=photos${focus(r.id)}` : r.customer_id ? `/dashboard/customers/${r.customer_id}${focus(r.id)}` : bid;
    case "message": return r.customer_id ? `/dashboard/customers/${r.customer_id}${focus(r.id)}` : "/dashboard/customers/communications";
  }
}

const money = (v: string | number | null) => (v == null ? null : Number(v).toLocaleString("en-US", { style: "currency", currency: "USD" }));

export function toResult(r: SearchRow): SearchResult {
  return {
    kind: r.kind, id: r.id, group: groupOf(r.kind), title: r.title, subtitle: r.subtitle, kindLabel: kindLabel(r.kind, r.status),
    status: statusOf(r.kind, r.status), reason: r.reason, href: hrefFor(r), inContext: Boolean(r.in_context), sandbox: r.workspace === "sandbox",
    amount: FIN_KINDS.includes(r.kind) ? money(r.amount) : null, date: r.record_date, customerName: r.customer_name,
    customerId: r.customer_id, estimateId: r.estimate_id,
  };
}
