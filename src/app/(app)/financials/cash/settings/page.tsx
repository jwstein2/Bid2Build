import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { isFinancialsEnabled } from "@/lib/env";
import { isMissing, loadFinState } from "@/lib/financials/loaders";
import { Notice } from "@/components/ui/misc";
import { TbShell } from "@/components/tax-banking/shell";
import { can } from "@/lib/tax-banking/capabilities";
import { isCashV9Enabled } from "@/lib/cash-v9/load";
import { customerHistory } from "@/lib/cash-v9/collections";
import { mapSettings } from "@/lib/cash-v9/settings";
import { CashSettingsForm, CollectionTermRow } from "@/components/cash-v9/settings-form";

export const metadata: Metadata = { title: "Forecast settings", robots: { index: false } };
type Row = Record<string, unknown>;
const rows = (r: { data: unknown }) => (r.data ?? []) as Row[];

/**
 * V9 forecast assumptions: minimum cash, margin targets, customer payment timing, expense mode, payroll and warnings.
 * Anyone who can see the forecast can read these; only manage_financial_config can change them (the database re-checks).
 */
export default async function CashSettingsPage() {
  if (!isFinancialsEnabled() || !isCashV9Enabled()) notFound();
  const db = await createClient();
  const state = await loadFinState(db);
  const shell = { state, title: "Forecast settings", active: "cash" as const, cap: "cash.view_forecast" as const };
  if (state.kind !== "ready" || !can(state.ctx.access.permissions, "cash.view_forecast")) return <TbShell {...shell} />;
  const { ctx } = state;
  const canEdit = ctx.access.active && !ctx.access.readOnly && ctx.access.permissions.includes("manage_financial_config");
  const settingsRes = await db.from("fin_cash_settings").select("*").eq("book_id", ctx.bookId).maybeSingle();
  if (settingsRes.error && isMissing(settingsRes.error)) {
    return <TbShell {...shell}><Notice title="Forecast settings turn on after the database update">The V9 SQL (20270217001000) hasn&apos;t been installed on this database yet.</Notice></TbShell>;
  }
  const settings = mapSettings(settingsRes.data as Row | null);

  // Customers with work in this book, their saved payment habit and paid-invoice history.
  const [jobsR, termsR, paidR] = await Promise.all([
    db.from("fin_jobs").select("customer_id, status").eq("book_id", ctx.bookId).not("customer_id", "is", null).limit(2000),
    db.from("fin_customer_collection_terms").select("customer_id, days, basis").eq("book_id", ctx.bookId),
    db.from("fin_invoice_balances_v").select("invoice_id, customer_id, issue_date, due_date").eq("book_id", ctx.bookId).eq("status", "issued").lte("balance", 0).limit(1000),
  ]);
  const custIds = [...new Set(rows(jobsR).map((j) => String(j.customer_id)))].slice(0, 300);
  const [custR, allocR] = await Promise.all([
    custIds.length ? db.from("customers").select("id, name").in("id", custIds) : Promise.resolve({ data: [] }),
    rows(paidR).length ? db.from("fin_payment_allocations").select("invoice_id, created_at").in("invoice_id", rows(paidR).map((p) => String(p.invoice_id)).slice(0, 500)).is("reversed_at", null) : Promise.resolve({ data: [] }),
  ]);
  const last = new Map<string, string>();
  for (const a of rows(allocR)) { const k = String(a.invoice_id); const d = String(a.created_at).slice(0, 10); if (!last.has(k) || last.get(k)! < d) last.set(k, d); }
  const history = customerHistory(rows(paidR).map((p) => ({ customerId: p.customer_id ? String(p.customer_id) : null, issueDate: p.issue_date ? String(p.issue_date).slice(0, 10) : null,
    dueDate: p.due_date ? String(p.due_date).slice(0, 10) : null, paidOn: last.get(String(p.invoice_id)) ?? null })));
  const terms = new Map(rows(termsR).map((t) => [String(t.customer_id), { days: Number(t.days), basis: t.basis === "issue" ? "issue" as const : "due" as const }]));
  // People who may get warning emails: the book owner and seats whose role can see company financials.
  const people = canEdit ? await recipientsFor(ctx.bookId) : [];
  const customers = rows(custR).map((c) => ({ id: String(c.id), name: String(c.name || "Customer") })).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <TbShell {...shell} intro="The assumptions behind your cash forecast. They are your company's own numbers, not industry figures, and you can change them any time. Changing them never changes an invoice, bill or payment."
      actions={<Link href="/financials/cash" className="inline-flex min-h-9 items-center rounded-lg border border-line px-3 text-sm font-semibold hover:bg-black/5">← Back to Cash flow</Link>}>
      {!settings.saved && <Notice title="Using starting assumptions">Nothing has been saved yet, so the forecast uses the values shown below. Save them once to make them yours.</Notice>}
      <CashSettingsForm s={settings} canEdit={canEdit} people={people} />
      <section className="space-y-2 rounded-xl border border-line bg-surface p-4" aria-labelledby="v9-cust-h" data-testid="v9-collection-terms">
        <h2 id="v9-cust-h" className="text-lg font-bold">Customer payment habits</h2>
        <p className="text-sm text-muted">Set how long a specific customer usually takes to pay. This wins over their history and the company default above.</p>
        {customers.length ? (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead><tr className="text-xs uppercase text-muted"><th className="p-2">Customer</th><th className="p-2">History</th><th className="p-2">Usually pays</th></tr></thead>
            <tbody>{customers.map((c) => <CollectionTermRow key={c.id} customerId={c.id} name={c.name} current={terms.get(c.id) ?? null} history={history[c.id] ?? null} canEdit={canEdit} />)}</tbody>
          </table></div>
        ) : <p className="text-sm text-muted">Customers appear here once they have a job.</p>}
      </section>
    </TbShell>
  );
}

const FORECAST_ROLES = ["owner", "financial_admin", "bookkeeper", "accountant"];
async function recipientsFor(bookId: string): Promise<{ id: string; label: string }[]> {
  try {
    const admin = createAdminClient();
    const [{ data: book }, { data: seats }] = await Promise.all([
      admin.from("fin_books").select("owner_user_id, company_id").eq("id", bookId).maybeSingle(),
      admin.from("fin_seats").select("user_id, fin_role").eq("book_id", bookId),
    ]);
    const b = book as Row | null;
    const ids = new Set(rows({ data: seats }).filter((x) => FORECAST_ROLES.includes(String(x.fin_role))).map((x) => String(x.user_id)));
    if (b?.owner_user_id) ids.add(String(b.owner_user_id));
    if (b?.company_id) {
      const { data: c } = await admin.from("companies").select("owner_user_id").eq("id", String(b.company_id)).maybeSingle();
      if ((c as Row | null)?.owner_user_id) ids.add(String((c as Row).owner_user_id));
    }
    const list = [...ids].slice(0, 50);
    const { data: m } = list.length ? await admin.from("company_members").select("user_id, display_name, email").in("user_id", list) : { data: [] };
    const label = new Map(rows({ data: m }).map((x) => [String(x.user_id), String(x.display_name || x.email || "")]));
    const out: { id: string; label: string }[] = [];
    for (const id of list) {
      let l = label.get(id) || "";
      if (!l) { const { data: u } = await admin.auth.admin.getUserById(id); l = String(u?.user?.email ?? "Team member"); }
      out.push({ id, label: l });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  } catch { return []; }
}
