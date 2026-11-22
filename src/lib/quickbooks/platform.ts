import "server-only";
/**
 * Built2Bid's own QuickBooks company (admin side): one connection, used to pay sales-rep commission statements and
 * affiliate commissions as QuickBooks bills. Tokens are encrypted with BANK_TOKEN_KEY in qb_platform_connection,
 * which only the service role can read. Callers must already have checked the owner (payouts.manage).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { openToken, sealToken } from "@/lib/tax-banking/bank/token-crypto";
import { logError } from "@/lib/http/api";
import { qbEnvironment, type QbEnvironment } from "./config";
import { QbError, companyName, createBill, createBillPayment, createVendor, findVendorByName, getBill, listBankAccounts, listExpenseAccounts, refreshTokens, revokeToken, type QbTokens } from "./client";
import { billPayload, billPaymentPayload, billState, isDuplicateName, qbQuote, vendorPayload, displayName, type Payee } from "./payout-bills";

type Db = SupabaseClient;

export interface PlatformConnection {
  realmId: string; companyName: string | null; environment: QbEnvironment; status: "active" | "needs_reauth";
  expenseAccountId: string | null; expenseAccountName: string | null; connectedAt: string; lastCheckAt: string | null; lastError: string | null;
}

export interface Candidate extends Payee {
  sourceKind: "sales_statement" | "affiliate_commission"; sourceId: string; payeeKind: "sales_rep" | "affiliate"; payeeId: string;
  amountCents: number; period: string; description: string; blockers: string[];
}

export interface BillRow {
  id: string; source_kind: string; payee_name: string | null; amount_cents: number; doc_number: string; description: string | null; status: string;
  environment: string; qb_bill_id: string | null; error: string | null; created_at: string; paid_at: string | null;
}

const COLS = "realm_id, company_name, environment, status, expense_account_id, expense_account_name, connected_at, last_check_at, last_error";

export async function platformConnection(db: Db): Promise<PlatformConnection | null> {
  const { data } = await db.from("qb_platform_connection").select(COLS).eq("id", true).maybeSingle();
  if (!data) return null;
  const r = data as Record<string, string | null>;
  return {
    realmId: String(r.realm_id), companyName: r.company_name, environment: r.environment === "production" ? "production" : "sandbox",
    status: r.status === "needs_reauth" ? "needs_reauth" : "active", expenseAccountId: r.expense_account_id, expenseAccountName: r.expense_account_name,
    connectedAt: String(r.connected_at), lastCheckAt: r.last_check_at, lastError: r.last_error,
  };
}

const tokenCols = (t: QbTokens) => ({
  access_ciphertext: sealToken(t.accessToken), refresh_ciphertext: sealToken(t.refreshToken),
  access_expires_at: t.accessExpiresAt.toISOString(), refresh_expires_at: t.refreshExpiresAt?.toISOString() ?? null, updated_at: new Date().toISOString(),
});

/** Saves Built2Bid's QuickBooks company after the Intuit callback, replacing any earlier connection. */
export async function savePlatformConnection(db: Db, userId: string, realmId: string, t: QbTokens): Promise<void> {
  const env = qbEnvironment();
  const name = await companyName(env, realmId, t.accessToken).catch(() => null);
  const old = await platformConnection(db);
  const keepAccount = old && old.realmId === realmId && old.environment === env;
  const { error } = await db.from("qb_platform_connection").upsert({
    id: true, realm_id: realmId, company_name: name, environment: env, status: "active", connected_by: userId, connected_at: new Date().toISOString(),
    expense_account_id: keepAccount ? old.expenseAccountId : null, expense_account_name: keepAccount ? old.expenseAccountName : null, last_error: null, ...tokenCols(t),
  });
  if (error) throw new Error(`qb_platform_save: ${error.message}`);
}

async function token(db: Db, c: PlatformConnection): Promise<string> {
  const { data } = await db.from("qb_platform_connection").select("access_ciphertext, refresh_ciphertext, access_expires_at").eq("id", true).maybeSingle();
  if (!data) throw new QbError("Connect QuickBooks to continue.", 401, true);
  const row = data as Record<string, string>;
  if (Date.parse(row.access_expires_at) - Date.now() > 120_000) return openToken(row.access_ciphertext);
  try {
    const t = await refreshTokens(openToken(row.refresh_ciphertext), c.environment);
    await db.from("qb_platform_connection").update(tokenCols(t)).eq("id", true);
    return t.accessToken;
  } catch (e) {
    if (e instanceof QbError && e.reauth) await needsReauth(db);
    throw e;
  }
}

const needsReauth = (db: Db) => db.from("qb_platform_connection").update({ status: "needs_reauth", last_error: "QuickBooks asked to sign in again.", updated_at: new Date().toISOString() }).eq("id", true);

async function withToken<T>(db: Db, c: PlatformConnection, fn: (t: string) => Promise<T>): Promise<T> {
  const t = await token(db, c);
  try { return await fn(t); } catch (e) {
    if (e instanceof QbError && e.reauth) await needsReauth(db);
    throw e;
  }
}

export async function disconnectPlatform(db: Db): Promise<void> {
  const { data } = await db.from("qb_platform_connection").select("refresh_ciphertext, environment").eq("id", true).maybeSingle();
  if (data) {
    const r = data as { refresh_ciphertext: string; environment: string };
    try { await revokeToken(openToken(r.refresh_ciphertext), r.environment === "production" ? "production" : "sandbox"); } catch { /* best effort */ }
  }
  await db.from("qb_platform_connection").delete().eq("id", true);
}

export const expenseAccounts = (db: Db, c: PlatformConnection) => withToken(db, c, (t) => listExpenseAccounts(c.environment, c.realmId, t));
export const bankAccounts = (db: Db, c: PlatformConnection) => withToken(db, c, (t) => listBankAccounts(c.environment, c.realmId, t));

export async function setExpenseAccount(db: Db, c: PlatformConnection, id: string): Promise<boolean> {
  const acct = (await expenseAccounts(db, c)).find((a) => a.id === id);
  if (!acct) return false;
  await db.from("qb_platform_connection").update({ expense_account_id: acct.id, expense_account_name: acct.name, updated_at: new Date().toISOString() }).eq("id", true);
  return true;
}

export async function candidates(db: Db, env: QbEnvironment): Promise<{ automationLive: boolean; items: Candidate[] } | null> {
  const { data, error } = await db.rpc("qb_payout_candidates", { p_env: env });
  if (error || !data) return null;
  const d = data as { automation_live: boolean; items: Record<string, unknown>[] };
  const s = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    automationLive: d.automation_live === true,
    items: d.items.map((x) => ({
      sourceKind: x.source_kind as Candidate["sourceKind"], sourceId: String(x.source_id), payeeKind: x.payee_kind as Candidate["payeeKind"], payeeId: String(x.payee_id),
      payeeName: String(x.payee_name ?? ""), givenName: s(x.given_name), familyName: s(x.family_name), email: s(x.email), phone: s(x.phone),
      line1: s(x.line1), line2: s(x.line2), city: s(x.city), state: s(x.state), postalCode: s(x.postal_code),
      amountCents: Number(x.amount_cents), period: String(x.period ?? ""), description: String(x.description ?? ""), blockers: (x.blockers as string[]) ?? [],
    })),
  };
}

export async function recentBills(db: Db, limit = 100): Promise<BillRow[]> {
  const { data } = await db.from("qb_payout_bills").select("id, source_kind, payee_name, amount_cents, doc_number, description, status, environment, qb_bill_id, error, created_at, paid_at")
    .order("created_at", { ascending: false }).limit(limit);
  return (data as BillRow[] | null) ?? [];
}

/** The payee's QuickBooks vendor: the saved match, else an existing vendor with the same name, else a new 1099 vendor. */
async function vendorFor(db: Db, c: PlatformConnection, t: string, item: Payee & { payeeKind: string; payeeId: string }): Promise<string> {
  const { data } = await db.from("qb_payee_vendors").select("qb_vendor_id").eq("payee_kind", item.payeeKind).eq("payee_id", item.payeeId).eq("realm_id", c.realmId).maybeSingle();
  if (data) return String((data as { qb_vendor_id: string }).qb_vendor_id);
  const name = displayName(item.payeeName);
  let id = (await findVendorByName(c.environment, c.realmId, t, qbQuote(name)))?.id ?? null;
  if (!id) {
    try {
      id = await createVendor(c.environment, c.realmId, t, vendorPayload(item), `b2b-vendor-${item.payeeKind}-${item.payeeId}`.slice(0, 50));
    } catch (e) {
      // The name is taken by a customer or employee: use a distinct vendor name.
      if (!(e instanceof QbError) || !isDuplicateName(e.message)) throw e;
      const alt = displayName(item.payeeName, " (Built2Bid)");
      id = (await findVendorByName(c.environment, c.realmId, t, qbQuote(alt)))?.id
        ?? await createVendor(c.environment, c.realmId, t, vendorPayload(item, " (Built2Bid)"), `b2b-vendor2-${item.payeeKind}-${item.payeeId}`.slice(0, 50));
    }
  }
  await db.from("qb_payee_vendors").upsert({ payee_kind: item.payeeKind, payee_id: item.payeeId, realm_id: c.realmId, qb_vendor_id: id, qb_name: name });
  return id;
}

export interface SendSummary { created: number; failed: number; skipped: number; errors: string[] }

/** Creates one QuickBooks bill per selected statement / commission. Each is reserved first, so a repeat never doubles. */
export async function sendBills(db: Db, c: PlatformConnection, userId: string, sourceIds: string[]): Promise<SendSummary> {
  const out: SendSummary = { created: 0, failed: 0, skipped: 0, errors: [] };
  if (!c.expenseAccountId) { out.errors.push("Choose the expense account first."); return out; }
  const list = await candidates(db, c.environment);
  if (!list) { out.errors.push("The database update for QuickBooks payouts hasn't been applied yet."); return out; }
  if (list.automationLive) { out.errors.push("Automatic payouts are live. Turn them off before paying through QuickBooks."); return out; }
  const wanted = new Set(sourceIds);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const t = await token(db, c);
  for (const item of list.items.filter((i) => wanted.has(i.sourceId))) {
    if (item.blockers.length) { out.skipped++; continue; }
    const { data: billId, error } = await db.rpc("qb_payout_bill_reserve", { p_caller: userId, p_source_kind: item.sourceKind, p_source_id: item.sourceId, p_realm: c.realmId, p_env: c.environment });
    if (error || !billId) { out.skipped++; out.errors.push(`${item.payeeName}: ${(error?.message ?? "not payable").replace(/^[\s\S]*?(already_billed|automation_live|blocked:[\w,]+|not_payable|owner_only)[\s\S]*$/, "$1")}`); continue; }
    const { data: row } = await db.from("qb_payout_bills").select("doc_number, description, amount_cents").eq("id", billId).single();
    const r = row as { doc_number: string; description: string; amount_cents: number };
    try {
      const vendorId = await vendorFor(db, c, t, item);
      const qbId = await createBill(c.environment, c.realmId, t, billPayload({ vendorId, accountId: c.expenseAccountId, amountCents: r.amount_cents, docNumber: r.doc_number, description: `${r.description} - ${item.payeeName}`, txnDate: today }), String(billId));
      await db.from("qb_payout_bills").update({ status: "open", qb_bill_id: qbId, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", billId);
      out.created++;
    } catch (e) {
      const msg = (e as Error).message.slice(0, 300);
      await db.from("qb_payout_bills").update({ status: "failed", error: msg, updated_at: new Date().toISOString() }).eq("id", billId);
      logError("quickbooks.payout_bill", e, { intuit_tid: e instanceof QbError ? e.tid ?? undefined : undefined });
      out.failed++; out.errors.push(`${item.payeeName}: ${msg}`);
      if (e instanceof QbError && e.reauth) break;
    }
  }
  return out;
}

/** Checks open bills in QuickBooks. A bill with nothing left to pay marks its statement / commission paid. */
export async function checkPaidBills(db: Db): Promise<{ checked: number; paid: number; voided: number; skipped?: string }> {
  const c = await platformConnection(db);
  if (!c || c.status !== "active") return { checked: 0, paid: 0, voided: 0, skipped: "not_connected" };
  const { data } = await db.from("qb_payout_bills").select("id, qb_bill_id").eq("status", "open").eq("realm_id", c.realmId).eq("environment", c.environment).limit(200);
  const open = (data as { id: string; qb_bill_id: string }[] | null) ?? [];
  let paid = 0, voided = 0;
  if (open.length) {
    await withToken(db, c, async (t) => {
      for (const b of open) {
        const bill = await getBill(c.environment, c.realmId, t, b.qb_bill_id);
        const now = new Date().toISOString();
        if (!bill) {
          // Deleted in QuickBooks: release the statement / commission so it can be billed again.
          await db.from("qb_payout_bills").update({ status: "voided", error: "Bill deleted in QuickBooks", last_check_at: now, updated_at: now }).eq("id", b.id).eq("status", "open");
          voided++;
        } else if (billState(bill) === "paid") {
          const { data: r } = await db.rpc("qb_payout_bill_paid", { p_bill: b.id, p_paid_at: now });
          if (r === "paid") paid++;
        } else {
          await db.from("qb_payout_bills").update({ last_check_at: now }).eq("id", b.id);
        }
      }
    });
  }
  await db.from("qb_platform_connection").update({ last_check_at: new Date().toISOString() }).eq("id", true);
  return { checked: open.length, paid, voided };
}

/**
 * Standing authorization (Reconciliation settings → "Create QuickBooks bills automatically"): bills every obligation that is
 * ready (payment verified, compliance complete), as the owner who authorized it. Same guards as the manual button.
 */
export async function autoSendBills(db: Db, authorizedBy: string): Promise<SendSummary & { skipped_reason?: string }> {
  const c = await platformConnection(db);
  if (!c || c.status !== "active") return { created: 0, failed: 0, skipped: 0, errors: [], skipped_reason: "not_connected" };
  if (!c.expenseAccountId) return { created: 0, failed: 0, skipped: 0, errors: [], skipped_reason: "no_expense_account" };
  const list = await candidates(db, c.environment);
  if (!list) return { created: 0, failed: 0, skipped: 0, errors: [], skipped_reason: "not_installed" };
  if (list.automationLive) return { created: 0, failed: 0, skipped: 0, errors: [], skipped_reason: "automatic_payouts_live" };
  const ids = list.items.filter((i) => i.blockers.length === 0).map((i) => i.sourceId);
  if (!ids.length) return { created: 0, failed: 0, skipped: 0, errors: [] };
  return sendBills(db, c, authorizedBy, ids);
}

async function payeeFor(db: Db, kind: string, id: string): Promise<Payee | null> {
  if (kind === "sales_rep") {
    const { data } = await db.from("sales_reps").select("full_name, email, phone, staff_members(legal_first_name, legal_last_name, email, phone, address_line1, address_line2, city, state, postal_code)").eq("id", id).maybeSingle();
    if (!data) return null;
    const r = data as unknown as { full_name: string; email: string | null; phone: string | null; staff_members: Record<string, string | null> | Record<string, string | null>[] | null };
    const sm = (Array.isArray(r.staff_members) ? r.staff_members[0] : r.staff_members) ?? {};
    const legal = [sm.legal_first_name, sm.legal_last_name].filter(Boolean).join(" ").trim();
    return { payeeName: legal || r.full_name, givenName: sm.legal_first_name, familyName: sm.legal_last_name, email: sm.email ?? r.email, phone: sm.phone ?? r.phone,
      line1: sm.address_line1, line2: sm.address_line2, city: sm.city, state: sm.state, postalCode: sm.postal_code };
  }
  const { data } = await db.from("affiliates").select("business_name, legal_name, display_name, email, phone, address_line1, address_line2, city, state, postal_code").eq("id", id).maybeSingle();
  if (!data) return null;
  const a = data as Record<string, string | null>;
  return { payeeName: (a.business_name || a.legal_name || a.display_name || a.email || "Affiliate").trim(), email: a.email, phone: a.phone,
    line1: a.address_line1, line2: a.address_line2, city: a.city, state: a.state, postalCode: a.postal_code };
}

/**
 * Books payouts the payment provider settled (verified) into Built2Bid's live QuickBooks: one bill per obligation plus a
 * bill payment from the chosen bank account. Bookkeeping only; reserved first so a repeat never doubles. Production only.
 */
export async function recordProviderPayouts(db: Db, bankAccountId: string): Promise<{ recorded: number; failed: number; errors: string[]; skipped_reason?: string }> {
  const out = { recorded: 0, failed: 0, errors: [] as string[] };
  const c = await platformConnection(db);
  if (!c || c.status !== "active") return { ...out, skipped_reason: "not_connected" };
  if (c.environment !== "production") return { ...out, skipped_reason: "sandbox" };
  if (!c.expenseAccountId || !/^\d{1,32}$/.test(bankAccountId)) return { ...out, skipped_reason: "accounts_not_chosen" };
  const { data, error } = await db.rpc("qb_provider_items", { p_env: c.environment });
  if (error) return { ...out, skipped_reason: "not_installed" };
  const items = (data as { payout_id: string; payout_ref: string; settled_at: string; source_kind: string; source_id: string; amount_cents: number; payee_kind: string; payee_id: string; bill_id: string | null }[]).slice(0, 50);
  if (!items.length) return out;
  const t = await token(db, c);
  for (const it of items) {
    try {
      let billId = it.bill_id;
      if (!billId) {
        const r = await db.rpc("qb_provider_bill_reserve", { p_payout: it.payout_id, p_source_kind: it.source_kind, p_source_id: it.source_id, p_realm: c.realmId, p_env: c.environment });
        if (r.error || !r.data) { out.errors.push(`${it.payout_ref}: ${r.error?.message ?? "not reserved"}`.slice(0, 200)); continue; }
        billId = String(r.data);
      }
      const { data: row } = await db.from("qb_payout_bills").select("doc_number, description, amount_cents, qb_bill_id").eq("id", billId).single();
      const b = row as { doc_number: string; description: string; amount_cents: number; qb_bill_id: string | null };
      const payee = await payeeFor(db, it.payee_kind, it.payee_id);
      if (!payee) throw new Error("payee_not_found");
      const vendorId = await vendorFor(db, c, t, { ...payee, payeeKind: it.payee_kind, payeeId: it.payee_id });
      const day = new Date(it.settled_at ?? Date.now()).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
      let qbBill = b.qb_bill_id;
      if (!qbBill) {
        qbBill = await createBill(c.environment, c.realmId, t, billPayload({ vendorId, accountId: c.expenseAccountId, amountCents: b.amount_cents, docNumber: b.doc_number, description: `${b.description} - ${payee.payeeName}`, txnDate: day }), billId);
        await db.from("qb_payout_bills").update({ status: "open", qb_bill_id: qbBill, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", billId);
      }
      const payId = await createBillPayment(c.environment, c.realmId, t, billPaymentPayload({ vendorId, bankAccountId, billId: qbBill, amountCents: b.amount_cents, txnDate: day, note: `Built2Bid ${b.doc_number}: paid by payout ${it.payout_ref}` }), `${billId}-pay`.slice(0, 50));
      await db.rpc("qb_provider_bill_paid", { p_bill: billId, p_payment_id: payId });
      out.recorded++;
    } catch (e) {
      out.failed++; out.errors.push(`${it.payout_ref}: ${(e as Error).message}`.slice(0, 200));
      logError("quickbooks.provider_payout", e, { intuit_tid: e instanceof QbError ? e.tid ?? undefined : undefined });
      if (e instanceof QbError && e.reauth) break;
    }
  }
  return out;
}
