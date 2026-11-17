/**
 * Customer Hub: one directory of every customer the account can see, built from the customer records
 * that bids link to automatically (supabase/migrations/20261122001000_customer_hub.sql).
 *
 * Pure functions only. Relationship status, "needs attention" and next actions come from facts that are
 * actually recorded (pipeline stage, signing, project schedules, communication events). Nothing here
 * invents deadlines or statuses.
 */
import { COLUMN_LABELS, columnOf, nextAction, type BoardBid, type Column } from "@/lib/pipeline/board";

export interface HubCustomerRow {
  id: string; userId: string; companyId: string | null;
  name: string; email: string | null; phone: string | null; address: string | null; notes: string | null;
  customerType: "person" | "business"; companyName: string | null; source: "manual" | "bid" | "backfill";
  createdAt: string; updatedAt: string;
}

export interface HubBid extends BoardBid {
  customerId: string;
  /** Opens the bid: the builder for the viewer's own bids, the read-only company view otherwise. */
  href: string;
  own: boolean;
}

export interface HubProject { id: string; estimateId: string; name: string; status: "draft" | "active" | "completed" | "archived"; startDate: string; updatedAt: string }

/** Recorded communication facts for one customer (Project Command Center only). */
export interface HubComm { status: string | null; lastReplyAt: string | null; lastSentAt: string | null; awaitingReview: number }

export const RELATIONSHIPS = ["active_project", "won", "awaiting", "ready", "drafting", "past", "lost", "no_bids"] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];
export const RELATIONSHIP_LABELS: Record<Relationship, string> = {
  active_project: "Active project", won: "Won · not scheduled", awaiting: "Waiting on customer", ready: "Proposal ready",
  drafting: "Estimate in progress", past: "Past customer", lost: "Lost / declined", no_bids: "No bids yet",
};
export const RELATIONSHIP_TONES: Record<Relationship, "neutral" | "ok" | "warn" | "danger" | "brand" | "accent"> = {
  active_project: "ok", won: "accent", awaiting: "brand", ready: "warn", drafting: "neutral", past: "neutral", lost: "danger", no_bids: "neutral",
};

export interface Attention { key: string; label: string; href: string }
export interface NextStep { label: string; href: string }

export interface CustomerSummary {
  customer: HubCustomerRow;
  bids: HubBid[];
  projects: HubProject[];
  relationship: Relationship;
  openBids: number;
  activeProjects: number;
  attention: Attention[];
  next: NextStep | null;
  /** Most recent bid or project, for the directory row. */
  latest: { kind: "bid" | "project"; label: string; detail: string; href: string; at: string } | null;
  lastActivity: string;
  comm: HubComm | null;
}

const OPEN: Column[] = ["draft", "ready", "sent", "awaiting"];
const ACTIVE_JOB: Column[] = ["scheduled", "in_progress"];
const latestIso = (...xs: (string | null | undefined)[]) => xs.filter(Boolean).sort().at(-1) ?? "";

/** Combine a customer's linked bids, projects and communication facts into one directory entry. */
export function summarize(customer: HubCustomerRow, bids: HubBid[], projects: HubProject[], comm: HubComm | null, opts: { esign: boolean; scheduling: boolean }): CustomerSummary {
  const sorted = [...bids].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const cols = new Map(sorted.map((b) => [b.id, columnOf(b)]));
  const has = (c: Column[]) => sorted.some((b) => c.includes(cols.get(b.id)!));
  const activeProjectIds = new Set([
    ...projects.filter((p) => p.status === "active").map((p) => p.estimateId),
    ...sorted.filter((b) => ACTIVE_JOB.includes(cols.get(b.id)!)).map((b) => b.id),
  ]);
  const relationship: Relationship =
    activeProjectIds.size ? "active_project"
    : has(["won"]) ? "won"
    : has(["sent", "awaiting"]) ? "awaiting"
    : has(["ready"]) ? "ready"
    : has(["draft"]) ? "drafting"
    : has(["completed"]) || projects.some((p) => p.status === "completed") ? "past"
    : sorted.length ? "lost"
    : "no_bids";

  const attention: Attention[] = [];
  for (const b of sorted) {
    if (!b.own) continue;
    const col = cols.get(b.id)!;
    const act = nextAction(b, opts.esign, opts.scheduling);
    const href = act?.href ?? b.href;
    if (col === "won" && !projects.some((p) => p.estimateId === b.id)) attention.push({ key: `won-${b.id}`, label: `Approved, not scheduled: ${b.title}`, href });
    else if (col === "awaiting" && b.signing?.state === "expired") attention.push({ key: `exp-${b.id}`, label: `Signing link expired: ${b.title}`, href });
    else if (col === "ready") attention.push({ key: `ready-${b.id}`, label: `Proposal ready to send: ${b.title}`, href });
  }
  if (comm) {
    if (comm.lastReplyAt && (!comm.lastSentAt || comm.lastReplyAt > comm.lastSentAt) && comm.status === "replied") {
      attention.push({ key: "reply", label: "Customer replied to an email", href: "/dashboard/customers/communications" });
    }
    if (comm.awaitingReview > 0) attention.push({ key: "review", label: `${comm.awaitingReview} email${comm.awaitingReview === 1 ? "" : "s"} waiting for your review`, href: "/dashboard/customers/communications" });
  }

  // Next action: the first attention item, otherwise the pipeline's next step for the most relevant open bid.
  let next: NextStep | null = attention[0] ? { label: attention[0].label.split(":")[0], href: attention[0].href } : null;
  if (!next) {
    const focus = sorted.find((b) => b.own && [...OPEN, ...ACTIVE_JOB].includes(cols.get(b.id)!));
    if (focus) { const a = nextAction(focus, opts.esign, opts.scheduling); next = a ? { label: a.label, href: a.href ?? focus.href } : { label: "Open bid", href: focus.href }; }
    else if (!sorted.length) next = { label: "Create a bid", href: `/dashboard/customers/${customer.id}` };
  }

  const project = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const bid = sorted[0];
  let latest: CustomerSummary["latest"] = null;
  if (project && (!bid || project.updatedAt >= bid.updatedAt)) latest = { kind: "project", label: project.name, detail: `Project · ${PROJECT_STATUS_LABELS[project.status]}`, href: `/projects/${project.id}`, at: project.updatedAt };
  else if (bid) latest = { kind: "bid", label: bid.title, detail: `Bid · ${COLUMN_LABELS[cols.get(bid.id)!]}`, href: bid.href, at: bid.updatedAt };

  // A record made automatically from a bid has no activity of its own beyond that bid.
  const own = customer.source === "manual" || !sorted.length ? [customer.updatedAt, customer.createdAt] : [];
  const lastActivity = latestIso(
    ...own, bid?.updatedAt, project?.updatedAt,
    ...sorted.map((b) => b.signing?.signed?.at), comm?.lastReplyAt, comm?.lastSentAt,
  );
  return {
    customer, bids: sorted, projects, relationship,
    openBids: sorted.filter((b) => OPEN.includes(cols.get(b.id)!)).length,
    activeProjects: activeProjectIds.size,
    attention, next, latest, lastActivity, comm,
  };
}

export const PROJECT_STATUS_LABELS: Record<HubProject["status"], string> = { draft: "Draft schedule", active: "Active", completed: "Completed", archived: "Archived" };

// ---------------------------------------------------------------------------
// Directory: metric filters, search and sorting
// ---------------------------------------------------------------------------
export const FOCUS = {
  all: { label: "All customers", empty: "No customers yet." },
  open: { label: "With open bids", empty: "No customers have an open bid." },
  projects: { label: "With active projects", empty: "No customers have an active project." },
  attention: { label: "Needing attention", empty: "Nothing needs your attention right now." },
  past: { label: "Past customers", empty: "No past customers yet." },
  lost: { label: "Lost / declined", empty: "No lost or declined customers." },
  none: { label: "No bids yet", empty: "Every customer has at least one bid." },
  duplicates: { label: "Possible duplicates", empty: "No possible duplicates found." },
} as const;
export type FocusKey = keyof typeof FOCUS;
export const isFocus = (s: unknown): s is FocusKey => typeof s === "string" && s in FOCUS;

export const SORTS = { activity: "Last activity", name: "Name (A–Z)", bids: "Most bids", created: "Newest customer" } as const;
export type SortKey = keyof typeof SORTS;
export const isSort = (s: unknown): s is SortKey => typeof s === "string" && s in SORTS;

export function matchesFocus(s: CustomerSummary, focus: FocusKey, dupes?: Set<string>): boolean {
  switch (focus) {
    case "all": return true;
    case "open": return s.openBids > 0;
    case "projects": return s.activeProjects > 0;
    case "attention": return s.attention.length > 0;
    case "past": return s.relationship === "past";
    case "lost": return s.relationship === "lost";
    case "none": return s.bids.length === 0;
    case "duplicates": return Boolean(dupes?.has(s.customer.id));
  }
}

const norm = (v: string | null | undefined) => (v ?? "").toLowerCase().replace(/[^a-z0-9@.]+/g, " ").trim();
/** Same rule as customer_norm() in SQL: lowercase, anything but letters/digits becomes one space. */
const nameKey = (v: string | null | undefined) => (v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const digits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

/** Search across name, business name, email, phone, address and linked bid titles / numbers. */
export function matchesSearch(s: CustomerSummary, q: string): boolean {
  const t = norm(q);
  if (!t) return true;
  const c = s.customer;
  const hay = norm([c.name, c.companyName, c.email, c.address, ...s.bids.map((b) => `${b.title} ${b.number}`)].join(" "));
  const d = digits(q);
  return t.split(" ").every((w) => hay.includes(w)) || (d.length >= 3 && digits(c.phone).includes(d));
}

export function sortSummaries(list: CustomerSummary[], sort: SortKey): CustomerSummary[] {
  const by = {
    activity: (a: CustomerSummary, b: CustomerSummary) => b.lastActivity.localeCompare(a.lastActivity),
    name: (a: CustomerSummary, b: CustomerSummary) => a.customer.name.localeCompare(b.customer.name, "en", { sensitivity: "base" }),
    bids: (a: CustomerSummary, b: CustomerSummary) => b.bids.length - a.bids.length || b.lastActivity.localeCompare(a.lastActivity),
    created: (a: CustomerSummary, b: CustomerSummary) => b.customer.createdAt.localeCompare(a.customer.createdAt),
  }[sort];
  return [...list].sort((a, b) => by(a, b) || a.customer.id.localeCompare(b.customer.id));
}

export function hubMetrics(list: CustomerSummary[]) {
  return {
    total: list.length,
    open: list.filter((s) => s.openBids > 0).length,
    projects: list.filter((s) => s.activeProjects > 0).length,
    attention: list.filter((s) => s.attention.length > 0).length,
  };
}

/**
 * Records that may be the same customer, for review (never merged automatically): same scope and the
 * same normalized name, email or phone. Returns customer id -> the other ids it may duplicate.
 */
export function possibleDuplicates(customers: HubCustomerRow[]): Map<string, string[]> {
  const out = new Map<string, Set<string>>();
  const groups = new Map<string, string[]>();
  for (const c of customers) {
    const scope = c.companyId ?? `u:${c.userId}`;
    const keys = [`n:${nameKey(c.name)}`, c.email ? `e:${c.email.trim().toLowerCase()}` : null, digits(c.phone).length >= 7 ? `p:${digits(c.phone).slice(-10)}` : null];
    for (const k of keys) if (k && k !== "n:") { const g = `${scope}|${k}`; groups.set(g, [...(groups.get(g) ?? []), c.id]); }
  }
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) { const s = out.get(id) ?? new Set<string>(); for (const o of ids) if (o !== id) s.add(o); out.set(id, s); }
  }
  return new Map([...out].map(([k, v]) => [k, [...v]]));
}
