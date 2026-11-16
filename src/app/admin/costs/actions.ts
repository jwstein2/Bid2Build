"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit, requireAdmin } from "@/lib/admin/server";
import { CATALOG, CATEGORIES, COST_TYPES, INTERVALS, SOURCES, STATUSES, dedupeAgainst, parseExpenseCsv } from "@/lib/admin/costs";

/**
 * Owner cost records (admin_services, admin_expenses). Owner-only (requireAdmin) and audited. These
 * only record numbers: nothing here contacts a provider, buys credits, changes a plan or a budget at
 * a provider, or touches Stripe.
 */
const keys = <T extends Record<string, string>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const back = (q: string) => redirect(`/admin/costs?${q}`);
const dollarsToCents = (v: unknown) => {
  const s = String(v ?? "").replace(/[$,\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= 1_000_000 ? Math.round(n * 100) : NaN;
};

const Service = z.object({
  provider_key: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/, "Key: 2–40 lowercase letters, numbers, - or _"),
  name: z.string().trim().min(1, "Name is required").max(80),
  purpose: z.string().trim().max(200).optional(),
  category: z.enum(keys(CATEGORIES)),
  status: z.enum(keys(STATUSES)),
  plan: z.string().trim().max(80).optional(),
  cost_type: z.enum(keys(COST_TYPES)),
  billing_interval: z.enum(keys(INTERVALS)),
  cost_source: z.enum(keys(SOURCES)),
  next_renewal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  allocation_pct: z.coerce.number().int().min(0).max(100),
  dashboard_url: z.string().trim().max(300).regex(/^https:\/\/[^\s]+$/, "Dashboard link must start with https://").optional(),
  invoice_ref: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function saveService(form: FormData) {
  const { user, db } = await requireAdmin();
  const get = (k: string) => { const v = form.get(k); return typeof v === "string" && v.trim() !== "" ? v : undefined; };
  const p = Service.safeParse({
    provider_key: get("provider_key"), name: get("name"), purpose: get("purpose"), category: get("category"), status: get("status"), plan: get("plan"),
    cost_type: get("cost_type"), billing_interval: get("billing_interval"), cost_source: get("cost_source"), next_renewal: get("next_renewal"),
    allocation_pct: get("allocation_pct") ?? "100", dashboard_url: get("dashboard_url"), invoice_ref: get("invoice_ref"), notes: get("notes"),
  });
  if (!p.success) back(`error=${encodeURIComponent(p.error.issues[0]?.message ?? "Check the service fields")}#edit`);
  const amount = dollarsToCents(form.get("amount"));
  const budget = dollarsToCents(form.get("budget"));
  if (Number.isNaN(amount) || Number.isNaN(budget)) back(`error=${encodeURIComponent("Amounts must be dollars between 0 and 1,000,000")}#edit`);
  const v = p.data!;
  // An empty amount means "unknown" and stays NULL, unless the service has no charge at all.
  const amount_cents = v.billing_interval === "none" ? 0 : amount;
  const source = amount_cents == null && v.billing_interval !== "none" ? "unknown" : v.cost_source === "unknown" && amount_cents != null ? "manual" : v.cost_source;
  const catalog = CATALOG.find((c) => c.key === v.provider_key);
  const row = {
    ...v, purpose: v.purpose ?? catalog?.purpose ?? null, plan: v.plan ?? null, next_renewal: v.next_renewal ?? null,
    dashboard_url: v.dashboard_url ?? catalog?.dashboard ?? null, invoice_ref: v.invoice_ref ?? null, notes: v.notes ?? null,
    amount_cents, budget_monthly_cents: budget, cost_source: source, updated_by: user.id,
  };
  const { data: before } = await db.from("admin_services").select("amount_cents,billing_interval,allocation_pct,status,budget_monthly_cents,cost_source").eq("provider_key", v.provider_key).maybeSingle();
  const { error } = await db.from("admin_services").upsert(row, { onConflict: "provider_key" });
  if (error) back(`error=${encodeURIComponent("Could not save. Is migration 20261115003000 installed?")}#edit`);
  await audit(db, user.id, before ? "cost_service.update" : "cost_service.add", "admin_service", v.provider_key, {
    before: before ?? null, after: { amount_cents, billing_interval: v.billing_interval, allocation_pct: v.allocation_pct, status: v.status, budget_monthly_cents: budget, cost_source: source },
  });
  revalidatePath("/admin/costs");
  back(`saved=${encodeURIComponent(v.name)}#services`);
}

const Expense = z.object({
  service_key: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/),
  incurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  amount: z.string().trim().regex(/^-?\$?[\d,]+(\.\d{1,2})?$/, "Amount in dollars, e.g. 25 or 12.50 (negative for a credit)"),
  kind: z.enum(keys(COST_TYPES)),
  external_id: z.string().trim().max(120).optional(),
  note: z.string().trim().max(300).optional(),
});

export async function addExpense(form: FormData) {
  const { user, db } = await requireAdmin();
  const get = (k: string) => { const v = form.get(k); return typeof v === "string" && v.trim() !== "" ? v : undefined; };
  const p = Expense.safeParse({ service_key: get("service_key"), incurred_on: get("incurred_on"), amount: get("amount"), kind: get("kind") ?? "fixed", external_id: get("external_id"), note: get("note") });
  if (!p.success) back(`error=${encodeURIComponent(p.error.issues[0]?.message ?? "Check the charge fields")}#ledger`);
  const v = p.data!;
  const cents = Math.round(Number(v.amount.replace(/[$,]/g, "")) * 100);
  if (!Number.isFinite(cents) || Math.abs(cents) > 100_000_000) back(`error=${encodeURIComponent("Amount out of range")}#ledger`);
  const { data, error } = await db.from("admin_expenses").insert({ service_key: v.service_key, incurred_on: v.incurred_on, amount_cents: cents, kind: v.kind, source: "manual", external_id: v.external_id ?? null, note: v.note ?? null, created_by: user.id }).select("id").single();
  if (error) back(`error=${encodeURIComponent(error.code === "23505" ? "That invoice id is already recorded for this provider." : "Could not save. Is migration 20261115003000 installed?")}#ledger`);
  await audit(db, user.id, "cost_expense.add", "admin_expense", String(data!.id), { service_key: v.service_key, incurred_on: v.incurred_on, amount_cents: cents, external_id: v.external_id ?? null });
  revalidatePath("/admin/costs");
  back("expense_saved=1#ledger");
}

export async function deleteExpense(form: FormData) {
  const { user, db } = await requireAdmin();
  const id = Number(form.get("id"));
  if (!Number.isInteger(id) || id <= 0) back("#ledger");
  const { data } = await db.from("admin_expenses").select("service_key,incurred_on,amount_cents,external_id,source").eq("id", id).maybeSingle();
  if (data) {
    await audit(db, user.id, "cost_expense.delete", "admin_expense", String(id), data as Record<string, unknown>);
    await db.from("admin_expenses").delete().eq("id", id);
  }
  revalidatePath("/admin/costs");
  back("#ledger");
}

/** Import charges from a provider billing export pasted as CSV. Duplicates are skipped, never double counted. */
export async function importExpenses(form: FormData) {
  const { user, db } = await requireAdmin();
  const text = String(form.get("csv") ?? "").slice(0, 100_000);
  const { data: svc } = await db.from("admin_services").select("provider_key");
  const known = new Set([...CATALOG.map((c) => c.key), ...((svc ?? []) as { provider_key: string }[]).map((s) => s.provider_key)]);
  const parsed = parseExpenseCsv(text, known);
  if (!parsed.rows.length) back(`import_error=${encodeURIComponent(parsed.errors.slice(0, 3).join(" · ") || "Nothing to import")}#import`);
  const { data: existing, error: readErr } = await db.from("admin_expenses").select("service_key,incurred_on,amount_cents,external_id");
  if (readErr) back(`import_error=${encodeURIComponent("Run migration 20261115003000 first.")}#import`);
  const { fresh, skipped } = dedupeAgainst(parsed.rows, (existing ?? []) as never[]);
  if (fresh.length) {
    const { error } = await db.from("admin_expenses").upsert(fresh.map((r) => ({ ...r, kind: "fixed", source: "invoice", created_by: user.id })), { onConflict: "service_key,external_id", ignoreDuplicates: true });
    if (error) back(`import_error=${encodeURIComponent("Import failed; nothing was saved.")}#import`);
  }
  await audit(db, user.id, "cost_expense.import", "admin_expense", "csv", { imported: fresh.length, skipped_duplicates: skipped, rejected: parsed.errors.length });
  revalidatePath("/admin/costs");
  back(`imported=${fresh.length}&skipped=${skipped}&rejected=${parsed.errors.length}#import`);
}
