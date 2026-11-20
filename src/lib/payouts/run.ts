import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/http/api";
import { payoutProvider, ProviderError, type PayoutProvider, type ProviderName, type PayoutMode } from "./provider";
import { emailOwnerAlert, emailPayoutResult } from "./notify";

type Claimed = { id: string; ref: string; net_cents: number; idempotency_key: string; provider: ProviderName; mode: PayoutMode; recipient_ref: string; payout_method_ref: string | null; attempts: number };

export interface RunResult { plan: unknown; claimed: number; submitted: number; retry: number; failed: number; skipped?: string; error?: string }

/**
 * One automatic payout run (daily cron, or the owner's "Run now"). Steps, all idempotent:
 *  1. payout_plan: approved Sales Hub statements -> one batched payout per person, prerequisites checked.
 *  2. Funding check: if the provider reports a balance lower than what's due, nothing is sent and the owner is alerted.
 *  3. payout_claim_due: locks due payouts (SKIP LOCKED) and enforces pause, live activation and limits.
 *  4. send each with its stable idempotency key; record the provider reference or the error (retry/backoff).
 * Status after submission only changes from verified provider events (webhook) - never from this run.
 */
export async function runPayouts(db: SupabaseClient, opts: { provider?: (name: ProviderName, mode: PayoutMode) => PayoutProvider; now?: Date } = {}): Promise<RunResult> {
  const plan = await db.rpc("payout_plan", opts.now ? { p_now: opts.now.toISOString() } : {});
  if (plan.error) return { plan: null, claimed: 0, submitted: 0, retry: 0, failed: 0, error: plan.error.message };
  const planned = plan.data as { skipped?: string } | null;
  if (planned?.skipped === "automation_off") return { plan: planned, claimed: 0, submitted: 0, retry: 0, failed: 0, skipped: "automation_off" };

  const { data: settings } = await db.from("payout_settings").select("mode, provider, paused, live_activated_at").eq("id", true).maybeSingle();
  if (!settings || settings.mode === "off") return { plan: planned, claimed: 0, submitted: 0, retry: 0, failed: 0, skipped: "automation_off" };
  if (settings.paused) return { plan: planned, claimed: 0, submitted: 0, retry: 0, failed: 0, skipped: "paused" };

  let provider: PayoutProvider;
  try {
    provider = (opts.provider ?? payoutProvider)(settings.provider as ProviderName, settings.mode as PayoutMode);
  } catch (e) {
    const msg = (e as Error).message;
    await emailOwnerAlert("Payouts can't run", msg, `payout-config/${new Date().toISOString().slice(0, 10)}`);
    return { plan: planned, claimed: 0, submitted: 0, retry: 0, failed: 0, skipped: "provider_unavailable", error: msg };
  }

  // Funding: compare the provider's available balance with what is due today (live only reports a real balance).
  const { data: due } = await db.from("payouts").select("net_cents").eq("mode", settings.mode).eq("status", "scheduled")
    .lte("scheduled_for", new Date((opts.now ?? new Date()).getTime()).toISOString().slice(0, 10));
  const dueCents = (due ?? []).reduce((n, r) => n + (r.net_cents as number), 0);
  const available = await provider.availableCents().catch(() => null);
  if (available != null && dueCents > available) {
    await emailOwnerAlert("Payouts waiting: funding balance too low", `Due today: ${dueCents / 100} USD. Available: ${available / 100} USD. Add funds to the payout balance; nothing was sent.`,
      `payout-funding/${new Date().toISOString().slice(0, 10)}`);
    return { plan: planned, claimed: 0, submitted: 0, retry: 0, failed: 0, skipped: "insufficient_funds" };
  }

  const claim = await db.rpc("payout_claim_due", { p_limit: 25, ...(opts.now ? { p_now: opts.now.toISOString() } : {}) });
  if (claim.error) return { plan: planned, claimed: 0, submitted: 0, retry: 0, failed: 0, error: claim.error.message };
  const c = claim.data as { skipped?: string; payouts: Claimed[] };
  if (c.skipped) return { plan: planned, claimed: 0, submitted: 0, retry: 0, failed: 0, skipped: c.skipped };

  let submitted = 0, retry = 0, failed = 0;
  for (const p of c.payouts) {
    if (p.provider !== provider.name || p.mode !== settings.mode) {
      await db.rpc("payout_mark_submit_error", { p_id: p.id, p_code: "provider_mismatch", p_message: "Provider or mode changed since scheduling", p_retryable: false });
      failed++; continue;
    }
    try {
      const r = await provider.send({ amountCents: p.net_cents, recipientRef: p.recipient_ref, methodRef: p.payout_method_ref, idempotencyKey: p.idempotency_key, ref: p.ref, description: `Built2Bid payout ${p.ref}` });
      await db.rpc("payout_mark_submitted", { p_id: p.id, p_provider_ref: r.providerRef });
      submitted++;
    } catch (e) {
      const err = e instanceof ProviderError ? e : new ProviderError("unexpected", (e as Error).message ?? "error", true);
      const { data: outcome } = await db.rpc("payout_mark_submit_error", { p_id: p.id, p_code: err.code, p_message: err.message, p_retryable: err.retryable });
      if (outcome === "failed") {
        failed++;
        await emailOwnerAlert(`Payout failed: ${p.ref}`, `${p.ref} (${p.net_cents / 100} USD) failed: ${err.message}`, `payout-failed/${p.ref}`);
      } else retry++;
      logError("payouts.send", err, { ref: p.ref, code: err.code });
    }
  }
  return { plan: planned, claimed: c.payouts.length, submitted, retry, failed };
}

/** After a verified provider event: notify the person (live only) and the owner on failures. */
export async function afterPayoutEvent(db: SupabaseClient, applied: { status: string; payout_id?: string; kind?: string; mode?: string }) {
  if (applied.status !== "applied" || !applied.payout_id) return;
  const { data: p } = await db.from("payouts").select("ref, net_cents, gross_cents, fee_cents, fee_bearer, mode, staff_members(email, display_name, preferred_name)").eq("id", applied.payout_id).maybeSingle();
  if (!p) return;
  const m = (p as unknown as { staff_members: { email: string; display_name: string; preferred_name: string | null } }).staff_members;
  const kind = applied.kind === "posted" ? "paid" : applied.kind === "returned" ? "returned" : applied.kind === "failed" ? "failed" : null;
  if (!kind) return;
  if (p.mode === "live") await emailPayoutResult(m.email, m.preferred_name ?? m.display_name, kind, p as never);
  if (kind !== "paid") await emailOwnerAlert(`Payout ${kind}: ${p.ref}`, `${p.ref} to ${m.display_name} (${(p.net_cents as number) / 100} USD) was ${kind}.`, `payout-${kind}/${p.ref}`);
}
