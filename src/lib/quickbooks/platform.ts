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
import { QbError, companyName, createBill, createVendor, findVendorByName, getBill, listExpenseAccounts, refreshTokens, revokeToken, type QbTokens } from "./client";
import { billPayload, billState, isDuplicateName, qbQuote, vendorPayload, displayName, type Payee } from "./payout-bills";

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
async function vendorFor(db: Db, c: PlatformConnection, t: string, item: Candidate): Promise<string> {
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
