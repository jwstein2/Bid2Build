import "server-only";
/**
 * Stripe Connect for contractor invoice payments: the server side. Talks to Stripe and writes the Connect tables
 * with the service-role client (those tables have no browser policies). Callers check Financials permissions first.
 */
import type Stripe from "stripe";
import { getStripe, assertModeAllowed } from "@/lib/billing/stripe";
import { createAdminClient } from "@/lib/supabase/server";
import { isLiveKey } from "@/lib/billing/test-mode";
import { serverEnv } from "@/lib/env";
import { checkoutParams, connectMode, fromCents, hashPayToken, methodFromType, newPayToken, surchargeAllowed, toCents, type AccountSnapshot } from "./connect";
import { capturePlan, disclosureText, normalizeState, settingsProblems, stateFromAddress, surchargeCents, surchargeDecision } from "./surcharge";

export interface PaymentAccountRow {
  book_id: string; stripe_account_id: string; livemode: boolean; charges_enabled: boolean; payouts_enabled: boolean; details_submitted: boolean;
  requirements_due: string[]; disabled_reason: string | null; card_enabled: boolean; ach_enabled: boolean; card_fee_payer: "contractor" | "customer";
  status_synced_at: string | null;
  surcharge_pct: number | string; card_cost_pct: number | string; card_cost_fixed_cents: number; surcharge_notice_date: string | null; surcharge_attested_at: string | null;
}

const COLS = "book_id, stripe_account_id, livemode, charges_enabled, payouts_enabled, details_submitted, requirements_due, disabled_reason, card_enabled, ach_enabled, card_fee_payer, status_synced_at, surcharge_pct, card_cost_pct, card_cost_fixed_cents, surcharge_notice_date, surcharge_attested_at";

/** The contractor's surcharge settings in engine form. */
export const surchargeSettingsOf = (a: PaymentAccountRow) => ({
  pct: Number(a.surcharge_pct) || 0, costPct: Number(a.card_cost_pct) || 0, costFixedCents: Number(a.card_cost_fixed_cents) || 0,
  noticeDate: a.surcharge_notice_date, attested: Boolean(a.surcharge_attested_at),
});

/** Is "customer pays the card fee" switched on AND ready on the contractor's side (rate, terms, 30-day notice)? */
// Bank (ACH) must be offered too, so the surcharge is always avoidable (all-in pricing laws in CO, VA, OR, RI, DC;
// Oklahoma requires another payment method).
export const surchargeActive = (a: PaymentAccountRow | null) =>
  Boolean(a && a.card_enabled && a.ach_enabled && a.card_fee_payer === "customer" && surchargeAllowed() && !settingsProblems(surchargeSettingsOf(a)).length);

/** The contractor's business state, from their tax profile (Financials → Tax). */
export async function businessState(bookId: string): Promise<string | null> {
  const { data } = await createAdminClient().from("fin_tax_profiles").select("primary_state, address").eq("book_id", bookId).maybeSingle();
  const r = data as { primary_state?: string | null; address?: { state?: string } | null } | null;
  return normalizeState(r?.primary_state ?? null) ?? normalizeState(r?.address?.state ?? null);
}
const liveKey = () => isLiveKey(serverEnv().stripeSecretKey);

export async function getPaymentAccount(bookId: string): Promise<PaymentAccountRow | null> {
  const { data, error } = await createAdminClient().from("fin_payment_accounts").select(COLS).eq("book_id", bookId).maybeSingle();
  if (error) throw error;
  const row = data as PaymentAccountRow | null;
  // A test-mode account is never used by a live deploy, and the other way round (every context shares one database).
  if (row && row.livemode !== liveKey()) return null;
  return row;
}

function snapshotColumns(a: Stripe.Account) {
  const req = a.requirements;
  const due = [...(req?.past_due ?? []), ...(req?.currently_due ?? [])];
  return {
    charges_enabled: Boolean(a.charges_enabled), payouts_enabled: Boolean(a.payouts_enabled), details_submitted: Boolean(a.details_submitted),
    requirements_due: Array.from(new Set(due)).slice(0, 50), disabled_reason: req?.disabled_reason ?? null, status_synced_at: new Date().toISOString(),
  };
}

export const snapshotOf = (a: Stripe.Account): AccountSnapshot => ({
  charges_enabled: a.charges_enabled, payouts_enabled: a.payouts_enabled, details_submitted: a.details_submitted, requirements: a.requirements ?? null,
});

/** Create (once) the contractor's Stripe account and return a Stripe-hosted onboarding link. */
export async function startOnboarding(opts: { bookId: string; userId: string; email?: string | null; businessName: string; returnUrl: string; refreshUrl: string }) {
  if (connectMode() === "off") throw new Error("connect_off");
  assertModeAllowed();
  const stripe = getStripe();
  const admin = createAdminClient();
  let row = await getPaymentAccount(opts.bookId);
  if (!row) {
    const acct = await stripe.accounts.create({
      // Standard-style account: the contractor gets the full Stripe Dashboard, pays Stripe's fees, and Stripe carries
      // payment losses. Built2Bid never holds the contractor's funds and takes no fee.
      controller: { stripe_dashboard: { type: "full" }, fees: { payer: "account" }, losses: { payments: "stripe" }, requirement_collection: "stripe" },
      country: "US",
      email: opts.email || undefined,
      business_profile: { name: opts.businessName.slice(0, 100), mcc: "1520", product_description: "Construction and home improvement services" },
      metadata: { b2b_book_id: opts.bookId },
    // The key stops a double click from making two accounts. Stripe replays a saved result (errors included) for
    // 24 hours, so the hour bucket keeps a failed first try (e.g. platform setup unfinished) from blocking a retry all day.
    }, { idempotencyKey: `b2b-connect-acct-${opts.bookId}-${liveKey() ? "live" : "test"}-${new Date().toISOString().slice(0, 13)}` });
    const { error } = await admin.from("fin_payment_accounts").upsert({
      book_id: opts.bookId, stripe_account_id: acct.id, livemode: liveKey(), created_by: opts.userId, ...snapshotColumns(acct),
    }, { onConflict: "book_id" });
    if (error) throw error;
    row = await getPaymentAccount(opts.bookId);
    if (!row) throw new Error("account_store_failed");
  }
  const link = await stripe.accountLinks.create({ account: row.stripe_account_id, type: "account_onboarding", return_url: opts.returnUrl, refresh_url: opts.refreshUrl });
  return link.url;
}

/** Pull the account's current status from Stripe (after onboarding returns, or on demand). */
export async function refreshAccount(bookId: string) {
  const row = await getPaymentAccount(bookId);
  if (!row) return null;
  const acct = await getStripe().accounts.retrieve(row.stripe_account_id);
  await syncAccount(acct);
  return getPaymentAccount(bookId);
}

/** account.updated (Connect webhook) or a refresh: mirror the status columns. */
export async function syncAccount(acct: Stripe.Account) {
  const { error } = await createAdminClient().from("fin_payment_accounts").update(snapshotColumns(acct)).eq("stripe_account_id", acct.id);
  if (error) throw error;
}

/** One active pay link per invoice. Returns the raw token (shown once, then only its hash is kept). */
export async function createPayLink(bookId: string, invoiceId: string, userId: string) {
  const admin = createAdminClient();
  await admin.from("fin_invoice_pay_links").update({ revoked_at: new Date().toISOString(), revoked_by: userId }).eq("invoice_id", invoiceId).is("revoked_at", null);
  const token = newPayToken();
  const { error } = await admin.from("fin_invoice_pay_links").insert({ book_id: bookId, invoice_id: invoiceId, token_hash: hashPayToken(token), created_by: userId });
  if (error) throw error;
  return token;
}

export async function revokePayLinks(invoiceId: string, userId: string) {
  const { error } = await createAdminClient().from("fin_invoice_pay_links").update({ revoked_at: new Date().toISOString(), revoked_by: userId })
    .eq("invoice_id", invoiceId).is("revoked_at", null);
  if (error) throw error;
}

export interface PayPage {
  invoiceId: string; bookId: string; number: string; issueDate: string | null; dueDate: string | null; total: string; balance: string; status: string;
  billToName: string; billToEmail: string | null; businessName: string; account: PaymentAccountRow | null; pending: boolean;
  contractorState: string | null; customerState: string | null;
}

/** Everything the public pay page shows, looked up by the link token. Null when the link is unknown or revoked. */
export async function loadPayPage(token: string): Promise<PayPage | null> {
  const admin = createAdminClient();
  const { data: link } = await admin.from("fin_invoice_pay_links").select("id, book_id, invoice_id").eq("token_hash", hashPayToken(token)).is("revoked_at", null).maybeSingle();
  if (!link) return null;
  const l = link as { id: string; book_id: string; invoice_id: string };
  const [{ data: inv }, { data: bal }, { data: book }, account, { data: pending }, contractorState] = await Promise.all([
    admin.from("fin_invoices").select("id, number, issue_date, due_date, total, status, bill_to").eq("id", l.invoice_id).maybeSingle(),
    admin.from("fin_invoice_balances_v").select("balance").eq("invoice_id", l.invoice_id).maybeSingle(),
    admin.from("fin_books").select("name").eq("id", l.book_id).maybeSingle(),
    getPaymentAccount(l.book_id),
    admin.from("fin_online_payments").select("id").eq("invoice_id", l.invoice_id).eq("status", "processing").limit(1),
    businessState(l.book_id).catch(() => null),
  ]);
  if (!inv) return null;
  await admin.from("fin_invoice_pay_links").update({ last_viewed_at: new Date().toISOString() }).eq("id", l.id);
  const i = inv as { id: string; number: string | null; issue_date: string | null; due_date: string | null; total: string; status: string; bill_to: Record<string, string> | null };
  return {
    invoiceId: i.id, bookId: l.book_id, number: i.number ?? "", issueDate: i.issue_date, dueDate: i.due_date, total: String(i.total),
    balance: String((bal as { balance?: string } | null)?.balance ?? i.total), status: i.status,
    billToName: i.bill_to?.name ?? "", billToEmail: i.bill_to?.email ?? null, businessName: (book as { name?: string } | null)?.name ?? "Your contractor",
    account, pending: Boolean((pending as unknown[] | null)?.length),
    contractorState, customerState: stateFromAddress(i.bill_to?.address ?? null),
  };
}

/**
 * The card surcharge line printed on the customer's invoice, or null. Shown only when the contractor surcharges, the
 * contractor's state allows it, and the invoice's customer state (when known) allows it too.
 */
export async function invoiceSurchargeNote(bookId: string, billToAddress: string | null | undefined, balance?: string): Promise<string | null> {
  if (connectMode() === "off") return null;
  const a = await getPaymentAccount(bookId).catch(() => null);
  if (!a || !a.charges_enabled || !surchargeActive(a)) return null;
  const home = await businessState(bookId).catch(() => null);
  const cust = stateFromAddress(billToAddress ?? null);
  const d = surchargeDecision(home, cust ?? home, surchargeSettingsOf(a).pct);
  if (!d.ok) return null;
  const st = surchargeSettingsOf(a);
  const baseCents = toCents(balance ?? "0");
  const sc = baseCents > 0 ? surchargeCents(baseCents, d.pct, st.costPct, st.costFixedCents) : 0;
  const usd = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  const totals = sc > 0 ? ` Amount due by bank (ACH) or debit card: ${usd(baseCents)}. Amount due by credit card: ${usd(baseCents + sc)} (includes a ${usd(sc)} surcharge).` : "";
  return `Online card payments: ${disclosureText(d.pct, d.disclosures)}${totals}${cust ? "" : " Surcharges are never added where state law prohibits them."}`;
}

export interface PayOffer {
  /** Surcharge shown and charged on a credit card, or null when the contractor pays the fee / it isn't allowed. */
  surcharge: { pct: number; cents: number; disclosure: string } | null;
  /** The customer's state is needed before we can say (the contractor surcharges and the address has no state). */
  needsState: boolean;
  /** Why no surcharge applies here (for the contractor-facing note; empty when it does). */
  reasons: string[];
}

/** What the customer is offered on the pay page, for a given customer state (from the invoice or their choice). */
export function payOffer(page: PayPage, customerState: string | null): PayOffer {
  const a = page.account;
  if (!surchargeActive(a) || !a) return { surcharge: null, needsState: false, reasons: [] };
  if (!customerState) return { surcharge: null, needsState: true, reasons: [] };
  const st = surchargeSettingsOf(a);
  const d = surchargeDecision(page.contractorState, customerState, st.pct);
  if (!d.ok) return { surcharge: null, needsState: false, reasons: d.reasons };
  const cents = surchargeCents(toCents(page.balance), d.pct, st.costPct, st.costFixedCents);
  if (cents <= 0) return { surcharge: null, needsState: false, reasons: ["Surcharge rounds to zero."] };
  return { surcharge: { pct: d.pct, cents, disclosure: disclosureText(d.pct, d.disclosures) }, needsState: false, reasons: [] };
}

/**
 * Start a Stripe Checkout session on the contractor's account for the invoice's open balance.
 * choice.method: "any" (contractor pays the fee: card and bank on one page), "card" (credit card surcharge may
 * apply) or "ach" (bank, never surcharged). choice.state: the customer's state when the invoice address has none.
 */
export async function startInvoiceCheckout(page: PayPage, returnUrl: string, choice: { method?: "any" | "card" | "ach"; state?: string | null } = {}) {
  if (connectMode() === "off") throw new Error("connect_off");
  assertModeAllowed();
  const a = page.account;
  if (!a || !a.charges_enabled) throw new Error("not_ready");
  if (page.status !== "issued" || Number(page.balance) <= 0) throw new Error("nothing_due");
  const method = choice.method ?? "any";
  if (method === "card" && !a.card_enabled) throw new Error("method_off");
  if (method === "ach" && !a.ach_enabled) throw new Error("method_off");
  const customerState = page.customerState ?? normalizeState(choice.state ?? null);
  const offer = method === "card" ? payOffer(page, customerState) : null;
  if (offer?.needsState) throw new Error("state_needed");
  const sc = offer?.surcharge && page.contractorState && customerState
    ? { cents: offer.surcharge.cents, pct: offer.surcharge.pct, contractorState: page.contractorState, customerState, disclosure: offer.surcharge.disclosure } : null;
  const params = checkoutParams({
    invoiceId: page.invoiceId, bookId: page.bookId, invoiceNumber: page.number, businessName: page.businessName, amountDue: page.balance,
    customerEmail: page.billToEmail, card: method !== "ach" && a.card_enabled, ach: method !== "card" && a.ach_enabled, returnUrl, surcharge: sc,
  });
  const session = await getStripe().checkout.sessions.create(params as Stripe.Checkout.SessionCreateParams, { stripeAccount: a.stripe_account_id });
  const { error } = await createAdminClient().from("fin_online_payments").insert({
    book_id: page.bookId, invoice_id: page.invoiceId, stripe_account_id: a.stripe_account_id, checkout_session_id: session.id,
    livemode: Boolean(session.livemode), amount: page.balance, status: "open",
    surcharge_offered: sc ? fromCents(sc.cents) : 0, surcharge_pct: sc ? sc.pct : null, payer_state: customerState,
  });
  if (error) throw error;
  return session.url;
}

const surchargeMeta = (s: Stripe.Checkout.Session) => {
  const m = s.metadata ?? {};
  const surcharge = Number(m.b2b_surcharge_cents ?? 0);
  const base = Number(m.b2b_base_cents ?? 0);
  return surcharge > 0 && base > 0 ? { surcharge, base, pct: Number(m.b2b_surcharge_pct ?? 0), contractorState: normalizeState(m.b2b_contractor_state) } : null;
};

/** Is this a surcharge session whose card payment is authorized and waiting for our capture decision? */
export const needsCaptureDecision = (s: Stripe.Checkout.Session) => Boolean(surchargeMeta(s)) && s.payment_status === "unpaid" && s.status === "complete";

/**
 * Surcharge sessions are authorized for invoice + surcharge but not captured. Here we look at the card Stripe
 * actually saw (funding type, billing state) and capture the full amount only when the surcharge is allowed;
 * otherwise we capture just the invoice amount, so a debit / prepaid card or a banned-state billing address is
 * never surcharged. Then the payment is recorded at the invoice amount. Idempotent (a captured PI is re-read).
 */
export async function captureAndSettle(session: Stripe.Checkout.Session, stripeAccount: string) {
  const sm = surchargeMeta(session);
  const piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
  if (!sm || !piId) return settleSession(session, stripeAccount);
  const stripe = getStripe();
  let pi = await stripe.paymentIntents.retrieve(piId, { expand: ["latest_charge"] }, { stripeAccount });
  const charge = (typeof pi.latest_charge === "object" ? pi.latest_charge : null) as Stripe.Charge | null;
  const facts = {
    funding: charge?.payment_method_details?.card?.funding, pmType: charge?.payment_method_details?.type,
    billingState: charge?.billing_details?.address?.state, billingCountry: charge?.billing_details?.address?.country,
  };
  const plan = capturePlan(sm.base, sm.surcharge, sm.contractorState, facts, sm.pct || undefined);
  if (pi.status === "requires_capture") {
    pi = await stripe.paymentIntents.capture(piId, { amount_to_capture: plan.captureCents }, { stripeAccount, idempotencyKey: `b2b-capture-${piId}` });
  }
  if (pi.status !== "succeeded") return { skipped: pi.status };
  const kept = Math.max(0, Math.min(sm.surcharge, (pi.amount_received ?? plan.captureCents) - sm.base));
  const f = facts.funding;
  const result = await settleSession(session, stripeAccount, { amountCents: sm.base });
  await createAdminClient().from("fin_online_payments").update({
    surcharge_amount: fromCents(kept), card_funding: f === "credit" || f === "debit" || f === "prepaid" ? f : "unknown",
    payer_state: normalizeState(facts.billingState) ?? undefined, surcharge_note: kept > 0 ? null : plan.reason,
  }).eq("checkout_session_id", session.id);
  return result;
}

/** Settle a paid Checkout session (card right away; ACH once the bank debit succeeds). Idempotent. */
export async function settleSession(session: Stripe.Checkout.Session, stripeAccount: string, opts: { amountCents?: number } = {}) {
  const piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
  let method: "card" | "ach" | null = null;
  if (piId) {
    const pi = await getStripe().paymentIntents.retrieve(piId, { expand: ["payment_method"] }, { stripeAccount });
    const pm = pi.payment_method as Stripe.PaymentMethod | string | null;
    method = methodFromType(typeof pm === "object" && pm ? pm.type : pi.payment_method_types?.[0]);
  }
  // A surcharge is never part of the invoice payment: it's recorded on the online payment row (surcharge_amount).
  const amount = fromCents(opts.amountCents ?? surchargeMeta(session)?.base ?? session.amount_total ?? 0);
  const { data, error } = await createAdminClient().rpc("fin_online_payment_settle", {
    p_checkout_session_id: session.id, p_payment_intent_id: piId, p_method: method ?? "card", p_amount: amount,
  });
  if (error) throw error;
  return data;
}

export async function markSession(sessionId: string, status: "processing" | "failed" | "expired", reason?: string) {
  const { error } = await createAdminClient().from("fin_online_payments").update({ status, failure_reason: reason?.slice(0, 300) ?? null })
    .eq("checkout_session_id", sessionId).is("payment_id", null);
  if (error) throw error;
}

/** charge.refunded / charge.dispute.*: flag the online payment so the contractor records the refund or sees the dispute. */
export async function flagByPaymentIntent(piId: string, patch: { status: "refunded" | "partially_refunded" | "disputed" | "succeeded"; refunded_amount?: string }) {
  const admin = createAdminClient();
  const { data } = await admin.from("fin_online_payments").select("id, book_id, payment_id").eq("payment_intent_id", piId).maybeSingle();
  if (!data) return false;
  const row = data as { id: string; book_id: string; payment_id: string | null };
  const { error } = await admin.from("fin_online_payments").update(patch).eq("id", row.id);
  if (error) throw error;
  // Audit trail (append-only). The Payments page lists refunded / disputed online payments as "Needs attention".
  await admin.from("fin_audit_log").insert({ book_id: row.book_id, action: `payment.online_${patch.status}`, entity_type: "payment", entity_id: row.payment_id,
    details: { paymentIntent: piId, refunded: patch.refunded_amount ?? null } });
  return true;
}
