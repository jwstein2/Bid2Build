/**
 * "Export everything, anytime": the data portability export behind Settings > Account > Download my data.
 *
 * Every table is read with the signed-in user's own client, so row-level security decides what's
 * included: the user's own rows plus the company, project and customer rows they can already see
 * in the app. Nothing here widens access. Secret link tokens (even hashed) are removed, because a
 * downloaded file is easy to forward and those columns are of no use outside Built2Bid.
 */

/** Grouped so the file reads as sections; each table name is also a top-level key in the export. */
export const EXPORT_SECTIONS = {
  account: ["profiles", "business_profiles", "subscriptions", "billing_customers", "credit_accounts", "credit_ledger", "usage_counters", "usage_events", "market_consent", "referral_codes", "referrals", "user_notifications"],
  bids: ["estimates", "estimate_groups", "estimate_items", "estimate_versions", "estimate_project_profiles", "estimate_stage_history", "generated_documents", "saved_items", "assemblies", "assembly_items", "user_templates"],
  signatures: ["signing_requests", "signatures"],
  customers: ["customers", "comm_settings", "comm_contacts", "comm_messages", "comm_events", "comm_offers", "comm_suppressions", "project_comm_settings"],
  projects: ["project_schedules", "schedule_tasks", "schedule_dependencies", "schedule_revisions", "schedule_publications", "project_activity", "project_reviews", "project_photos", "project_scope_sections", "project_scope_revisions", "project_cost_adjustments", "scope_shares", "scope_share_versions", "subcontractor_quotes", "subcontractor_quote_revisions", "pm_editors", "pm_resources", "pm_crew_members", "pm_suppliers", "pm_employee_profiles", "pm_time_entries", "pm_time_entry_changes", "pm_sub_tax_profiles", "pm_sub_documents", "supplier_connections"],
  change_orders: ["change_orders", "change_order_versions", "change_order_signing", "change_order_signatures"],
  financials: ["fin_books", "fin_seats", "fin_business_config", "fin_jobs", "fin_contract_snapshots", "fin_contract_changes", "fin_payment_milestones", "fin_milestone_triggers", "fin_milestone_amendments", "fin_invoices", "fin_invoice_lines", "fin_payments", "fin_payment_allocations", "fin_credit_memos", "fin_credit_applications", "fin_refunds", "fin_cost_codes", "fin_budget_lines", "fin_vendors", "fin_commitments", "fin_commitment_revisions", "fin_vendor_bills", "fin_vendor_bill_lines", "fin_expenses", "fin_documents", "fin_invoice_disputes", "fin_audit_log"],
  company: ["companies", "company_members", "company_invitations", "company_teams", "company_team_members", "company_proposal_styles", "company_proposal_style_history", "company_audit_log", "sales_pay_settings"],
} as const;

export const EXPORT_TABLES: string[] = Object.values(EXPORT_SECTIONS).flat();

/** Columns that are link or reply secrets, removed from every row. */
const SECRET_COLUMN = /(^|_)token(_hash)?$/; // token_hash, invite_token_hash, reply_token, inbound_test_token

export function stripSecrets(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!SECRET_COLUMN.test(k)) out[k] = v;
  return out;
}

const PAGE = 1000;
/** Safety ceiling per table so one runaway table can't time the export out. */
export const MAX_ROWS_PER_TABLE = 50_000;

type Page = { data: Record<string, unknown>[] | null; error: { code?: string; message?: string } | null };
type Query = { order: (col: string, o?: { ascending: boolean }) => Query; range: (from: number, to: number) => PromiseLike<Page> };
export type ExportClient = { from: (table: string) => { select: (cols: string) => Query } };

export type TableResult = { rows: Record<string, unknown>[]; truncated: boolean; unavailable: boolean };

/**
 * Reads every visible row of one table, 1,000 at a time (PostgREST caps a single response), ordered by
 * id when the table has one. A table that doesn't exist yet or can't be read comes back empty and
 * flagged, never as a failed export.
 */
export async function readTable(client: ExportClient, table: string): Promise<TableResult> {
  const rows: Record<string, unknown>[] = [];
  let ordered = true;
  for (let from = 0; from < MAX_ROWS_PER_TABLE; from += PAGE) {
    const q = client.from(table).select("*");
    let res = await (ordered ? q.order("id", { ascending: true }) : q).range(from, from + PAGE - 1);
    if (res.error && ordered && from === 0) {
      ordered = false; // no id column: fall back to the table's natural order
      res = await client.from(table).select("*").range(0, PAGE - 1);
    }
    if (res.error) return { rows, truncated: false, unavailable: rows.length === 0 };
    const page = res.data ?? [];
    for (const r of page) rows.push(stripSecrets(r));
    if (page.length < PAGE) return { rows, truncated: false, unavailable: false };
  }
  return { rows, truncated: true, unavailable: false };
}

export async function buildExport(client: ExportClient, account: { id: string; email: string | null | undefined }, now = new Date()) {
  const results = new Map<string, TableResult>();
  // A few tables at a time: fast, without flooding the database.
  for (let i = 0; i < EXPORT_TABLES.length; i += 6) {
    const batch = EXPORT_TABLES.slice(i, i + 6);
    const got = await Promise.all(batch.map((t) => readTable(client, t)));
    batch.forEach((t, j) => results.set(t, got[j]));
  }
  const out: Record<string, unknown> = {
    exported_at: now.toISOString(),
    account: { id: account.id, email: account.email ?? null },
    about: "Everything in your Built2Bid account that you can see in the app: your bids, customers and messages, projects and schedules, change orders, signatures, company data, and financial records. Photos and PDFs are listed by their stored file path; download them from the app. Secret link tokens are left out.",
    sections: EXPORT_SECTIONS,
    row_counts: Object.fromEntries(EXPORT_TABLES.map((t) => [t, results.get(t)!.rows.length])),
    truncated_tables: EXPORT_TABLES.filter((t) => results.get(t)!.truncated),
  };
  for (const t of EXPORT_TABLES) out[t] = results.get(t)!.rows;
  return out;
}
