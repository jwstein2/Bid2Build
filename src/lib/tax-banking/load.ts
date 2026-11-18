import "server-only";
/**
 * Data loading for the V6.9 pages. Always the signed-in user's client: RLS decides what each person sees
 * (balances need "reconcile", alerts need company financials). Missing tables (SQL not run yet) load as "not installed".
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissing } from "@/lib/financials/loaders";
import { can } from "./capabilities";
import { buildForecast, customerLateness, type ForecastAccount, type ForecastInput, type PlannedEvent } from "./forecast";
import { bankProviderMode, taxProviderMode } from "./isolation";

type Db = SupabaseClient;
type Row = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
/** A date column as YYYY-MM-DD (PostgREST sends that; a timestamp-shaped value is cut to its date). */
const d10 = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v).slice(0, 10));

export interface Freshness { lastSuccessAt: string | null; lastAttemptAt: string | null; lastStatus: string | null; provider: string | null; authoritiesReachable: number; authoritiesTotal: number }

export async function loadTaxPage(db: Db, bookId: string, perms: readonly string[]) {
  const [profile, alerts, fresh, auths, changes, exemptions] = await Promise.all([
    db.from("fin_tax_profiles").select("*").eq("book_id", bookId).maybeSingle(),
    can(perms, "tax.review_alerts") ? db.from("fin_tax_alerts").select("*").eq("book_id", bookId).order("created_at", { ascending: false }).limit(100) : Promise.resolve({ data: [], error: null }),
    db.rpc("tax_freshness"),
    db.from("tax_authorities").select("state, state_name, authority, website, tax_system, sst_member, note, source_status, last_verified_at, last_checked_at, next_check_at, machine_feed").order("state"),
    db.from("tax_change_events").select("id, state, jurisdiction_name, level, kind, summary, old_rate, new_rate, effective_date, status, source_url, detected_at").order("effective_date", { ascending: false }).limit(200),
    db.from("fin_tax_exemptions").select("id, customer_id, state, reason, certificate_ref, document_id, expires_on, status, created_at").eq("book_id", bookId).order("created_at", { ascending: false }),
  ]);
  if (profile.error && isMissing(profile.error)) return { installed: false as const };
  const p = profile.data as Row | null;
  const states: string[] = (p?.service_states as string[] | undefined) ?? [];
  const allChanges = (changes.data ?? []) as Row[];
  return {
    installed: true as const,
    profile: p,
    alerts: (alerts.data ?? []) as Row[],
    freshness: (fresh.data ?? null) as Freshness | null,
    authorities: (auths.data ?? []) as Row[],
    changes: states.length ? allChanges.filter((c) => states.includes(String(c.state))) : allChanges.slice(0, 30),
    exemptions: (exemptions.data ?? []) as Row[],
    providerMode: taxProviderMode(process.env),
  };
}

export interface BankAccountView {
  id: string; name: string; last4: string | null; kind: string; institution: string | null; isPrimary: boolean; status: string; source: string; connectionId: string | null;
  current: string | null; available: string | null; asOf: string | null; currency: string;
}
export interface ConnectionView { id: string; provider: string; institution: string; status: string; errorCode: string | null; errorMessage: string | null; lastSyncAt: string | null; lastSuccessAt: string | null; historyPartial: boolean; sandbox: boolean; createdAt: string }

export async function loadBanks(db: Db, bookId: string) {
  const [conns, accts, bals] = await Promise.all([
    db.from("fin_bank_connections").select("*").eq("book_id", bookId).order("created_at"),
    db.from("fin_bank_accounts").select("id, name, last4, kind, institution_name, is_primary, status, source, connection_id, currency").eq("book_id", bookId).order("created_at"),
    db.from("fin_bank_balances").select("account_id, current_balance, available_balance, as_of").eq("book_id", bookId).order("as_of", { ascending: false }).limit(500),
  ]);
  if (conns.error && isMissing(conns.error)) return { installed: false as const };
  const latest = new Map<string, Row>();
  for (const b of (bals.data ?? []) as Row[]) if (!latest.has(String(b.account_id))) latest.set(String(b.account_id), b);
  const connections: ConnectionView[] = ((conns.data ?? []) as Row[]).map((c) => ({ id: String(c.id), provider: String(c.provider), institution: String(c.institution_name), status: String(c.status),
    errorCode: s(c.error_code), errorMessage: s(c.error_message), lastSyncAt: s(c.last_sync_at), lastSuccessAt: s(c.last_success_at), historyPartial: Boolean(c.history_partial), sandbox: Boolean(c.sandbox), createdAt: String(c.created_at) }));
  const connStatus = new Map(connections.map((c) => [c.id, c.status]));
  const accounts: BankAccountView[] = ((accts.data ?? []) as Row[]).map((a) => {
    const b = latest.get(String(a.id));
    return { id: String(a.id), name: String(a.name), last4: s(a.last4), kind: String(a.kind), institution: s(a.institution_name), isPrimary: Boolean(a.is_primary),
      status: a.connection_id ? (connStatus.get(String(a.connection_id)) ?? "active") : String(a.status), source: String(a.source), connectionId: s(a.connection_id),
      current: s(b?.current_balance), available: s(b?.available_balance), asOf: s(b?.as_of), currency: String(a.currency ?? "USD") };
  });
  return { installed: true as const, connections, accounts };
}

export interface CashQuery { horizon: number; end?: string; accounts?: string[] }

export async function loadForecast(db: Db, bookId: string, perms: readonly string[], q: CashQuery, today = new Date().toISOString().slice(0, 10)) {
  const withBank = can(perms, "bank.view_balances");
  const banks = withBank ? await loadBanks(db, bookId) : { installed: true as const, connections: [], accounts: [] as BankAccountView[] };
  if (!banks.installed) return { installed: false as const };
  const [inv, paidInv, ms, bills, vendors, planned, payments, matches, checkPays, checkExps, customers] = await Promise.all([
    db.from("fin_invoice_balances_v").select("invoice_id, number, balance, due_date, customer_id, job_id, status").eq("book_id", bookId).eq("status", "issued").gt("balance", 0),
    db.from("fin_invoice_balances_v").select("invoice_id, customer_id, due_date, balance, total").eq("book_id", bookId).eq("status", "issued").lte("balance", 0).limit(500),
    db.from("fin_milestone_status_v").select("milestone_id, job_id, description, current_amount, invoiced, paid, due_on, state").eq("book_id", bookId).in("state", ["not_triggered", "ready_to_invoice"]),
    db.from("fin_bill_balances_v").select("bill_id, vendor_id, number, vendor_invoice_number, due_date, balance").eq("book_id", bookId).gt("balance", 0),
    db.from("fin_vendors").select("id, name, kind").eq("book_id", bookId),
    db.from("fin_cash_events").select("*").eq("book_id", bookId).eq("status", "active"),
    db.from("fin_payments").select("id, number, amount, received_on, customer_id").eq("book_id", bookId).eq("status", "active").gte("received_on", new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)),
    db.from("fin_bank_matches").select("target_type, target_id").eq("book_id", bookId).eq("status", "active"),
    db.from("fin_bill_payments").select("id, amount, paid_on, reference").eq("book_id", bookId).eq("status", "active").eq("method", "check"),
    db.from("fin_expenses").select("id, number, amount, spent_on, payee").eq("book_id", bookId).in("status", ["pending", "approved"]).eq("method", "check"),
    db.from("customers").select("id, name").limit(2000),
  ]);
  if (planned.error && isMissing(planned.error)) return { installed: false as const };
  const matched = new Set(((matches.data ?? []) as Row[]).map((m) => `${m.target_type}:${m.target_id}`));
  const vend = new Map(((vendors.data ?? []) as Row[]).map((v) => [String(v.id), v]));
  const cust = new Map(((customers.data ?? []) as Row[]).map((c) => [String(c.id), String(c.name)]));
  // Payment history for expected dates: allocation dates aren't needed for a usable average; paid invoices' last payment date.
  const paidIds = ((paidInv.data ?? []) as Row[]).map((r) => String(r.invoice_id));
  const { data: allocs } = paidIds.length ? await db.from("fin_payment_allocations").select("invoice_id, created_at").in("invoice_id", paidIds.slice(0, 300)).is("reversed_at", null) : { data: [] };
  const lastPaid = new Map<string, string>();
  for (const a of (allocs ?? []) as Row[]) { const k = String(a.invoice_id); const d = String(a.created_at).slice(0, 10); if (!lastPaid.has(k) || lastPaid.get(k)! < d) lastPaid.set(k, d); }
  const lateness = customerLateness(((paidInv.data ?? []) as Row[]).map((r) => ({ customerId: s(r.customer_id), dueDate: d10(r.due_date), paidOn: lastPaid.get(String(r.invoice_id)) ?? null })));

  const active = banks.accounts.filter((a) => a.status !== "archived" && a.status !== "disconnected" && (a.source === "provider_feed" ? a.connectionId : true));
  const feedAccounts = active.filter((a) => a.source === "provider_feed");
  const chosen = q.accounts?.length ? new Set(q.accounts) : null;
  const accounts: ForecastAccount[] = feedAccounts.map((a) => ({ id: a.id, name: `${a.name}${a.last4 ? ` ••${a.last4}` : ""}`, current: a.current, available: a.available, asOf: a.asOf, status: a.status,
    included: chosen ? chosen.has(a.id) : a.kind !== "credit_card" }));
  const input: ForecastInput = {
    today, horizonDays: q.horizon, endDate: q.end, accounts, includeBankBalance: withBank,
    invoices: ((inv.data ?? []) as Row[]).map((r) => ({ id: String(r.invoice_id), number: String(r.number ?? "Draft"), balance: String(r.balance), dueDate: d10(r.due_date), customerId: s(r.customer_id), customerName: r.customer_id ? cust.get(String(r.customer_id)) ?? null : null, jobId: s(r.job_id) })),
    // Milestones still waiting on their trigger count only when they have a date; ready ones assume about 30 days.
    milestones: ((ms.data ?? []) as Row[]).filter((m) => Number(m.invoiced) === 0 && (m.state === "ready_to_invoice" || m.due_on)).map((m) => ({ id: String(m.milestone_id), label: String(m.description ?? "Milestone"), amount: String(m.current_amount), expectedOn: d10(m.due_on), jobId: s(m.job_id) })),
    bills: ((bills.data ?? []) as Row[]).map((b) => { const v = vend.get(String(b.vendor_id)); return { id: String(b.bill_id), label: `Bill ${b.number ?? ""} · ${v?.name ?? "Vendor"}`, balance: String(b.balance), dueDate: d10(b.due_date), vendorKind: (v?.kind as "subcontractor" | "supplier" | "other" | undefined) ?? "other" }; }),
    checks: [
      ...((checkPays.data ?? []) as Row[]).filter((p) => !matched.has(`bill_payment:${p.id}`)).map((p) => ({ id: String(p.id), label: `Bill payment${p.reference ? ` #${p.reference}` : ""}`, amount: String(p.amount), date: d10(p.paid_on)!, kind: "bill_payment" as const })),
      ...((checkExps.data ?? []) as Row[]).filter((x) => !matched.has(`expense:${x.id}`)).map((x) => ({ id: String(x.id), label: `Expense ${x.number} · ${x.payee ?? ""}`, amount: String(x.amount), date: d10(x.spent_on)!, kind: "expense" as const })),
    ],
    depositsInTransit: withBank && feedAccounts.length ? ((payments.data ?? []) as Row[]).filter((p) => !matched.has(`payment:${p.id}`)).map((p) => ({ id: String(p.id), label: `${p.number}${p.customer_id ? ` · ${cust.get(String(p.customer_id)) ?? ""}` : ""}`, amount: String(p.amount), receivedOn: d10(p.received_on)! })) : [],
    planned: ((planned.data ?? []) as Row[]).map((p) => ({ id: String(p.id), kind: String(p.kind), label: String(p.label), amount: String(p.amount), direction: p.direction as "in" | "out", expectedOn: d10(p.expected_on)!,
      recurrence: p.recurrence as PlannedEvent["recurrence"], recurUntil: d10(p.recur_until), certainty: p.certainty as "scheduled" | "expected", accountId: s(p.account_id), toAccountId: s(p.to_account_id), invoiceId: s(p.invoice_id), settlement: s(p.settlement) })),
    customerLateness: lateness,
  };
  return { installed: true as const, forecast: buildForecast(input), banks, accounts, planned: (planned.data ?? []) as Row[], withBank,
    invoices: input.invoices.map((i) => ({ id: i.id, label: `${i.number}${i.customerName ? ` · ${i.customerName}` : ""}` })) };
}

export const bankMode = (sandbox: boolean) => bankProviderMode(process.env, { sandbox });
