import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/http/api";
import { serverEnv } from "@/lib/env";
import { isLiveKey } from "@/lib/billing/test-mode";
import { applySubscription } from "@/lib/billing/apply";
import { emailOwnerAlert } from "@/lib/payouts/notify";
import { autoSendBills, checkPaidBills, recordProviderPayouts } from "@/lib/quickbooks/platform";
import { salesChargeDispute, salesChargeRefunded, syncSalesBilling } from "@/lib/sales/billing-server";
import { affiliateChargeDispute, affiliateChargeRefunded, syncAffiliateBilling } from "@/lib/affiliates/billing-server";
import { alertDigest, type Finding, type StripeInvoiceLike } from "./facts";
import { recordChargeFact, recordInvoiceFact } from "./evidence";

export { recordChargeFact, recordInvoiceFact };

type Db = SupabaseClient;

export interface ReconResult { run?: string; skipped?: string; status?: string; steps: Record<string, unknown>; findings?: number; notified?: number }

const SWEEP_DAYS = 40;
const BUDGET_MS = 18_000;

/**
 * One reconciliation run (daily cron, or "Reconcile now"). Idempotent and safe to repeat; one run at a time.
 *  1. Stripe: every paid invoice (last 40 days), refund and dispute is recorded; anything the webhook missed is
 *     replayed through the existing Sales/Affiliate handlers. Commission invoices we haven't seen are fetched.
 *  2. QuickBooks: paid-bill check, then (only with the owner's standing authorization) automatic bills and
 *     bookkeeping for provider-settled payouts.
 *  3. Automatic statement approval (standing authorization), database checks, exception queue, month-end close.
 *  4. One email only when something needs the owner. A timeout or missing data is never treated as a payment.
 */
export async function runReconciliation(db: Db, opts: { kind: "daily" | "manual"; caller?: string | null; stripe?: Stripe | null; now?: Date } = { kind: "daily" }): Promise<ReconResult> {
  const steps: Record<string, unknown> = {};
  const { data: run, error: beginErr } = await db.rpc("recon_run_begin", { p_kind: opts.kind, p_caller: opts.caller ?? null });
  if (beginErr) return { skipped: "not_installed", steps };
  if (!run) return { skipped: "busy", steps };
  const runId = String(run);
  const started = Date.now();
  const findings: Finding[] = [];
  const scopes = new Set<string>(["db", "approve", "close"]);
  try {
    // 1. Stripe
    let stripeOk = false;
    const key = serverEnv().stripeSecretKey;
    if (!opts.stripe) {
      steps.stripe = { skipped: "not_configured" };
    } else if (!isLiveKey(key) && process.env.RECON_ALLOW_TEST !== "true") {
      // Every Netlify context shares one database: only the live key may write live evidence.
      steps.stripe = { skipped: "not_live_key" };
    } else {
      try {
        steps.stripe = await stripeSweep(db, opts.stripe, started);
        stripeOk = (steps.stripe as { complete: boolean }).complete;
        if (!stripeOk) findings.push({ fingerprint: "stripe_incomplete", scope: "stripe", kind: "stripe_unavailable", severity: "action", summary: "The Stripe check didn't finish in time; it continues tomorrow." });
      } catch (e) {
        logError("recon.stripe", e);
        steps.stripe = { error: (e as Error).message?.slice(0, 200) };
        findings.push({ fingerprint: "stripe_unavailable", scope: "stripe", kind: "stripe_unavailable", severity: "action", summary: `Stripe couldn't be checked: ${(e as Error).message?.slice(0, 150)}` });
      }
      scopes.add("stripe");
      if (stripeOk) scopes.add("verify");
    }
    steps.stripe_ok = stripeOk;

    // 2. QuickBooks
    const { data: settings } = await db.from("recon_settings").select("*").eq("id", true).maybeSingle();
    const s = (settings ?? {}) as { qb_auto_bills?: boolean; qb_record_provider_payouts?: boolean; qb_payment_account_id?: string | null; authorized_by?: string | null };
    try {
      steps.qb_paid_check = await checkPaidBills(db);
      if (s.qb_auto_bills && s.authorized_by) steps.qb_auto_bills = await autoSendBills(db, s.authorized_by);
      if (s.qb_record_provider_payouts && s.qb_payment_account_id) steps.qb_provider_payouts = await recordProviderPayouts(db, s.qb_payment_account_id);
      scopes.add("quickbooks");
      for (const st of [steps.qb_auto_bills, steps.qb_provider_payouts] as ({ failed?: number; errors?: string[] } | undefined)[]) {
        if (st?.failed) findings.push({ fingerprint: `quickbooks_write_failed:${new Date().toISOString().slice(0, 10)}`, scope: "quickbooks", kind: "quickbooks_write_failed", severity: "action", summary: `QuickBooks entries failed: ${(st.errors ?? []).slice(0, 2).join(" · ")}`.slice(0, 480) });
      }
    } catch (e) {
      logError("recon.quickbooks", e);
      steps.qb_error = (e as Error).message?.slice(0, 200);
      findings.push({ fingerprint: "quickbooks_unavailable", scope: "quickbooks", kind: "quickbooks_unavailable", severity: "action", summary: `QuickBooks couldn't be checked: ${(e as Error).message?.slice(0, 150)}` });
    }

    // 3. Automatic approval, database checks, exceptions, close
    const now = (opts.now ?? new Date()).toISOString();
    const approve = await db.rpc("recon_auto_approve", { p_now: now });
    if (approve.error) throw new Error(`auto_approve: ${approve.error.message}`);
    const ap = approve.data as { approved?: number; skipped?: string; findings?: Finding[] };
    steps.auto_approve = { approved: ap.approved ?? 0, skipped: ap.skipped ?? null };
    if (ap.skipped === "locked") scopes.delete("approve");
    findings.push(...(ap.findings ?? []));

    const checks = await db.rpc("recon_db_findings", { p_now: now, p_stripe_ok: stripeOk });
    if (checks.error) throw new Error(`checks: ${checks.error.message}`);
    findings.push(...((checks.data as Finding[]) ?? []));

    // Exceptions first (the close looks at open material ones), then the close's own findings.
    const sync1 = await db.rpc("recon_exceptions_sync", { p_run: runId, p_findings: findings, p_scopes: [...scopes].filter((x) => x !== "close") });
    if (sync1.error) throw new Error(`exceptions: ${sync1.error.message}`);
    const close = await db.rpc("recon_close_due", { p_run: runId, p_now: now, p_stripe_ok: stripeOk });
    if (close.error) throw new Error(`close: ${close.error.message}`);
    const cl = close.data as { closed?: number; blocked?: number; skipped?: string; findings?: Finding[] };
    steps.close = { closed: cl.closed ?? 0, blocked: cl.blocked ?? 0, skipped: cl.skipped ?? null };
    const sync2 = await db.rpc("recon_exceptions_sync", { p_run: runId, p_findings: cl.findings ?? [], p_scopes: cl.skipped ? [] : ["close"] });
    if (sync2.error) throw new Error(`exceptions: ${sync2.error.message}`);
    const out = sync2.data as { new: number; resolved: number; open_material: number; notify: { id: string; kind: string; severity: string; summary: string; amount_cents: number | null; repeat?: boolean }[] };
    steps.exceptions = { new: (sync1.data as { new: number }).new + out.new, resolved: (sync1.data as { resolved: number }).resolved + out.resolved, open_material: out.open_material };

    // 4. Exception-only email
    let notified = 0;
    const digest = alertDigest(out.notify ?? []);
    if (digest) {
      await emailOwnerAlert(digest.subject, digest.body, `recon/${runId}`);
      await db.rpc("recon_exceptions_mark_notified", { p_ids: out.notify.map((n) => n.id) });
      notified = out.notify.length;
    }
    const status = out.open_material > 0 || findings.some((f) => f.severity !== "info") ? "exceptions" : "passed";
    steps.duration_ms = Date.now() - started;
    await db.rpc("recon_run_finish", { p_run: runId, p_status: status, p_steps: steps, p_error: null });
    return { run: runId, status, steps, findings: findings.length, notified };
  } catch (e) {
    const msg = (e as Error).message?.slice(0, 500) ?? "error";
    logError("recon.run", e);
    await db.rpc("recon_run_finish", { p_run: runId, p_status: "failed", p_steps: steps, p_error: msg });
    // A failed run is itself worth one email a day.
    await emailOwnerAlert("Reconciliation run failed", `The ${opts.kind} reconciliation stopped: ${msg}\nIt retries automatically on the next run.`, `recon-failed/${new Date().toISOString().slice(0, 10)}`);
    return { run: runId, status: "failed", steps };
  }
}

/** Records Stripe's view of the last 40 days and replays anything our webhook missed. */
async function stripeSweep(db: Db, stripe: Stripe, started: number) {
  const since = Math.floor(Date.now() / 1000) - SWEEP_DAYS * 86400;
  const out = { invoices: 0, new_invoices: 0, replayed: 0, fetched: 0, refunds: 0, disputes: 0, complete: false };
  const timeLeft = () => Date.now() - started < BUDGET_MS;

  for await (const inv of stripe.invoices.list({ status: "paid", created: { gte: since }, limit: 100 })) {
    if (!timeLeft()) return out;
    out.invoices++;
    const action = await recordInvoiceFact(db, inv as unknown as StripeInvoiceLike, { source: "reconcile" });
    if (action === "inserted" || action === "updated") {
      out.new_invoices++;
      if (await replayInvoice(db, stripe, inv)) out.replayed++;
    }
    if (out.invoices >= 2000) break;
  }
  // Invoices a commission points at that are older than the sweep window (or were never sent to us).
  const { data: missing } = await db.rpc("recon_unverified_invoice_ids", { p_limit: 100 });
  for (const id of (missing as string[] | null) ?? []) {
    if (!timeLeft()) return out;
    const inv = await stripe.invoices.retrieve(id).catch((e: { statusCode?: number }) => { if (e?.statusCode === 404) return null; throw e; });
    if (inv) { await recordInvoiceFact(db, inv as unknown as StripeInvoiceLike, { source: "reconcile" }); out.fetched++; }
  }
  for await (const r of stripe.refunds.list({ created: { gte: since }, limit: 100 })) {
    if (!timeLeft()) return out;
    const chargeId = typeof r.charge === "string" ? r.charge : r.charge?.id;
    if (!chargeId || r.status === "failed" || r.status === "canceled") continue;
    const charge = await stripe.charges.retrieve(chargeId);
    if ((await recordChargeFact(db, stripe, charge)) === "changed") {
      out.refunds++;
      // Missed webhook: replay the existing handlers (full refunds only; a partial refund is flagged for review).
      if (charge.refunded === true || (charge.amount_refunded ?? 0) >= (charge.amount ?? 0)) {
        await salesChargeRefunded(db, stripe, charge);
        await affiliateChargeRefunded(db, stripe, charge);
      }
    }
  }
  for await (const d of stripe.disputes.list({ created: { gte: since }, limit: 100 })) {
    if (!timeLeft()) return out;
    const chargeId = typeof d.charge === "string" ? d.charge : d.charge?.id;
    if (!chargeId) continue;
    const status = d.status === "won" ? "won" : d.status === "lost" ? "lost" : "open";
    const charge = await stripe.charges.retrieve(chargeId);
    if ((await recordChargeFact(db, stripe, charge, { status })) === "changed") {
      out.disputes++;
      const closed = status !== "open";
      await salesChargeDispute(db, stripe, d, closed);
      await affiliateChargeDispute(db, stripe, d, closed);
    }
  }
  out.complete = true;
  return out;
}

/** A paid subscription invoice we hadn't recorded: run it through the same commission handlers the webhook uses. */
async function replayInvoice(db: Db, stripe: Stripe, inv: Stripe.Invoice): Promise<boolean> {
  const i = inv as unknown as StripeInvoiceLike;
  const subRef = i.parent?.subscription_details?.subscription ?? i.subscription ?? null;
  const subId = subRef ? (typeof subRef === "string" ? subRef : subRef.id) : null;
  if (!subId) return false;
  const sub = await stripe.subscriptions.retrieve(subId);
  const { data: owner } = await db.from("subscriptions").select("user_id").eq("stripe_subscription_id", subId).maybeSingle();
  let userId = (owner as { user_id?: string } | null)?.user_id ?? null;
  let plan: string | null = null, companyId: string | null = null;
  if (!userId) {
    // Not even the subscription is known: apply it exactly as the webhook would (out-of-order safe).
    const res = await applySubscription(db, sub, inv.created ?? Math.floor(Date.now() / 1000));
    userId = res.userId ?? null; plan = res.plan ?? null; companyId = res.companyId ?? null;
  }
  if (!userId) return false;
  await syncSalesBilling(db, stripe, sub, userId, { plan, companyId, invoice: inv as never });
  await syncAffiliateBilling(db, stripe, sub, userId, { plan, invoice: inv as never });
  return true;
}
