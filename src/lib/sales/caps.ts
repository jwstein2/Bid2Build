/**
 * Sales Hub capabilities (V8.3). The database computes them (sales_capabilities) from three separate
 * sources: an active selling sales_reps row, a Sales Administrator row (role 'admin'), and the platform
 * owner (admin_roles). The app only uses them to choose what to show; every admin_* database function
 * checks them again. An Enterprise company admin is a customer role and grants none of these.
 */
export const REP_CAPS = ["view_own_leads", "edit_own_leads", "import_own_leads", "send_own_outreach", "view_own_commissions"] as const;
export const ADMIN_CAPS = ["view_admin_hub", "view_all_reps", "view_all_leads", "reassign_leads", "approve_commissions", "review_compliance", "manage_reps", "export_reports", "set_team_goals"] as const;
export const OWNER_CAPS = ["edit_commission_policies", "adjust_commissions", "payout_operations", "manage_sales_admins", "platform_owner"] as const;
export type SalesCap = (typeof REP_CAPS)[number] | (typeof ADMIN_CAPS)[number] | (typeof OWNER_CAPS)[number];

/** Same rules as the database function, used only when the V8.3 migration isn't applied yet. */
export function fallbackCaps(o: { sells: boolean; salesAdmin: boolean; owner: boolean }): SalesCap[] {
  return [...(o.sells ? REP_CAPS : []), ...(o.salesAdmin || o.owner ? ADMIN_CAPS : []), ...(o.owner ? OWNER_CAPS : [])];
}

export const canMy = (caps: readonly string[]) => caps.includes("view_own_leads");
export const canAdmin = (caps: readonly string[]) => caps.includes("view_admin_hub");

export type SalesView = "my" | "admin";
export const VIEW_COOKIE = "sales_view";

/** Which hub a person lands on at /sales: their last view if they still have it, otherwise the one they have. */
export function landingView(caps: readonly string[], last: string | undefined): SalesView | null {
  const my = canMy(caps), admin = canAdmin(caps);
  if (my && admin) return last === "admin" ? "admin" : "my";
  if (admin) return "admin";
  if (my) return "my";
  return null;
}

/** A role label for the header, e.g. "Rep + Sales Admin". */
export function roleLabel(caps: readonly string[]): string {
  const parts: string[] = [];
  if (caps.includes("platform_owner")) parts.push("Owner");
  if (canMy(caps)) parts.push("Rep");
  if (canAdmin(caps) && !caps.includes("platform_owner")) parts.push("Sales Admin");
  return parts.join(" + ");
}

/** Admin Sales Hub sections, in the top navigation when the Admin view is on. `cap` hides a section. */
export const ADMIN_TABS = [
  { id: "overview", label: "Overview" },
  { id: "team", label: "Representatives" },
  { id: "analytics", label: "Activity & analytics" },
  { id: "leads", label: "All leads" },
  { id: "recycling", label: "Lead recycling" },
  { id: "customers", label: "Customers" },
  { id: "commissions", label: "Commission approvals" },
  { id: "recognition", label: "Recognition & incentives" },
  { id: "statements", label: "Statements & payouts" },
  { id: "compliance", label: "Compliance" },
  { id: "policy", label: "Policies" },
] as const;
export type AdminTab = (typeof ADMIN_TABS)[number]["id"];

/** Reporting windows for the admin views. */
export const RANGES = { "7d": { label: "Last 7 days", days: 7 }, "30d": { label: "Last 30 days", days: 30 }, "90d": { label: "Last 90 days", days: 90 }, "365d": { label: "Last 12 months", days: 365 } } as const;
export type RangeKey = keyof typeof RANGES;
export function rangeSince(key: string | undefined, now = new Date()): { key: RangeKey; since: Date; until: Date } {
  const k = (key && key in RANGES ? key : "30d") as RangeKey;
  return { key: k, since: new Date(now.getTime() - RANGES[k].days * 86_400_000), until: now };
}

export interface RepMetrics {
  leads: number; leads_new: number; contacted: number; calls: number; emails: number; texts: number; meetings: number; follow_ups: number;
  tasks_overdue: number; demos: number; trials: number; closed: number; active_customers: number; visits: number; signups: number;
  commission_cents: number; pending_cents: number; unpaid_cents: number; milestones: number;
}
export interface AnalyticsRep { id: string; full_name: string; role: string; status: string; is_admin_rep: boolean; metrics: RepMetrics }

/**
 * Team totals. Every sale belongs to exactly one rep, so summing rows never double counts. Reps who are
 * also administrators (Sales Admin or Platform Owner) are included unless the filter excludes them.
 */
export function teamTotals(reps: AnalyticsRep[], includeAdminReps = true) {
  const rows = reps.filter((r) => includeAdminReps || !r.is_admin_rep);
  const sum = (k: keyof RepMetrics) => rows.reduce((t, r) => t + (r.metrics[k] ?? 0), 0);
  const contacted = sum("contacted"), closed = sum("closed");
  return {
    reps: rows.length, contacted, calls: sum("calls"), emails: sum("emails"), meetings: sum("meetings"), follow_ups: sum("follow_ups"),
    closed, trials: sum("trials"), tasks_overdue: sum("tasks_overdue"), commission_cents: sum("commission_cents"), unpaid_cents: sum("unpaid_cents"),
    conversion: contacted > 0 ? closed / contacted : null,
  };
}


export interface RepDetail {
  rep: { id: string; full_name: string; email: string; role: string; status: string; sells: boolean; activated_at: string | null; is_admin_rep: boolean };
  since: string; until: string; metrics: RepMetrics; stages: Record<string, number>;
  weeks: { week: string; contacted: number; calls: number; emails: number; closed: number }[];
  leads: { id: string; company_name: string; stage: string; last_activity_at: string | null; next_action_at: string | null; do_not_contact: boolean }[];
  customers: { company: string | null; plan: string | null; sub_status: string | null; first_paid_at: string | null; ended_at: string | null }[];
  statements: { period_month: string; status: string; total_cents: number }[];
}

/** The rep-detail summary rows used on screen and in the CSV export. */
export function detailSummary(d: RepDetail): [string, string | number][] {
  const m = d.metrics;
  return [
    ["Leads assigned", m.leads], ["New leads in range", m.leads_new], ["Leads contacted", m.contacted], ["Calls", m.calls], ["Emails", m.emails],
    ["Texts", m.texts], ["Follow-ups", m.follow_ups], ["Meetings", m.meetings], ["Overdue tasks (now)", m.tasks_overdue], ["Demos in pipeline", m.demos],
    ["Trials (now)", m.trials], ["Closed sales", m.closed], ["Conversion (closed ÷ contacted)", m.contacted ? `${Math.round((m.closed / m.contacted) * 100)}%` : "—"],
    ["Active customers", m.active_customers], ["Link visits", m.visits], ["Link sign-ups", m.signups],
    ["Commission earned in range ($)", (m.commission_cents / 100).toFixed(2)], ["Pending, in 30-day hold ($)", (m.pending_cents / 100).toFixed(2)],
    ["Approved, not paid yet ($)", (m.unpaid_cents / 100).toFixed(2)], ["Milestone boxes", m.milestones],
  ];
}
