import "server-only";
/**
 * Payout provider adapters (V8.1). Built2Bid never sees bank numbers: the recipient enters them on the provider's
 * hosted page and we keep the provider's ids plus bank name / last 4.
 *
 * - mock: in-app practice provider. Default. Moves no money; settlement is simulated by the owner in test mode.
 * - stripe_global_payouts: Stripe Global Payouts (v2 Accounts with the recipient configuration, hosted Account Links,
 *   OutboundPayments from Built2Bid's Stripe storage balance). Unreachable until the owner sets
 *   PAYOUTS_PROVIDER_KEY (a Stripe secret key for payouts) and, for live, PAYOUTS_ALLOW_LIVE=true + live activation.
 *
 * Live safety: a live key is refused unless the database mode is 'live' (owner activation) AND PAYOUTS_ALLOW_LIVE=true.
 * A test-mode payout is never sent with a live key, and a live payout never with a test key.
 */
import Stripe from "stripe";

export type ProviderName = "mock" | "stripe_global_payouts";
export type PayoutMode = "test" | "live";

export interface Destination { recipientRef: string; methodRef: string | null; institution: string | null; accountType: "checking" | "savings" | "card" | "unknown"; last4: string | null; status: "pending" | "verified" | "failed" }
export interface SendResult { providerRef: string; status: "processing" | "posted" | "failed" }
export class ProviderError extends Error { constructor(public code: string, message: string, public retryable: boolean) { super(message); } }

export interface PayoutProvider {
  name: ProviderName;
  mode: PayoutMode;
  /** Create (or reuse) the recipient and return the provider-hosted onboarding / update URL. */
  onboardingLink(i: { recipientRef: string | null; email: string; name: string; returnUrl: string; refreshUrl: string; staffId: string }): Promise<{ recipientRef: string; url: string }>;
  /** Read the recipient's default payout method (bank name, type, last 4, status). */
  destination(recipientRef: string): Promise<Destination | null>;
  /** Send one payout. The idempotency key is stable across retries, so a retry can never pay twice. */
  send(i: { amountCents: number; recipientRef: string; methodRef: string | null; idempotencyKey: string; ref: string; description: string }): Promise<SendResult>;
  /** Money available for payouts in the funding balance (cents), or null if unknown. */
  availableCents(): Promise<number | null>;
}

const keyMode = (k: string): PayoutMode | null => (/^(sk|rk)_live_/.test(k) ? "live" : /^(sk|rk)_test_/.test(k) ? "test" : null);

/** Resolve the provider for the database's mode. Throws a clear error instead of ever crossing test/live. */
export function payoutProvider(provider: ProviderName, mode: PayoutMode, env: NodeJS.ProcessEnv = process.env): PayoutProvider {
  if (provider === "mock") {
    if (mode === "live") throw new ProviderError("mock_in_live", "The practice provider can't send real payouts.", false);
    return mockProvider();
  }
  const key = env.PAYOUTS_PROVIDER_KEY ?? "";
  const km = keyMode(key);
  if (!km) throw new ProviderError("provider_not_configured", "Stripe Global Payouts isn't configured (PAYOUTS_PROVIDER_KEY).", false);
  if (km !== mode) throw new ProviderError("mode_mismatch", `The payout key is a ${km} key but payouts are in ${mode} mode.`, false);
  if (mode === "live" && env.PAYOUTS_ALLOW_LIVE !== "true") throw new ProviderError("live_not_allowed", "Live payouts need PAYOUTS_ALLOW_LIVE=true on the server.", false);
  const fa = env.PAYOUTS_FINANCIAL_ACCOUNT ?? "";
  return stripeGlobalPayouts(new Stripe(key, { appInfo: { name: "Built2Bid payouts" }, maxNetworkRetries: 2 }), mode, fa);
}

// --- Mock ---------------------------------------------------------------------------------------------------
export function mockProvider(): PayoutProvider {
  return {
    name: "mock", mode: "test",
    async onboardingLink(i) {
      const recipientRef = i.recipientRef ?? `mock_rcpt_${i.staffId.slice(0, 8)}`;
      return { recipientRef, url: `/staff/payouts/practice-bank?return=${encodeURIComponent(i.returnUrl)}` };
    },
    async destination(recipientRef) {
      return { recipientRef, methodRef: `mock_pm_${recipientRef.slice(-8)}`, institution: "STRIPE TEST BANK (practice)", accountType: "checking", last4: "6789", status: "verified" };
    },
    async send(i) {
      if (i.amountCents <= 0) throw new ProviderError("amount_invalid", "Amount must be positive.", false);
      return { providerRef: `mockpo_${i.idempotencyKey.replace(/-/g, "").slice(0, 20)}`, status: "processing" };
    },
    async availableCents() { return null; },
  };
}

// --- Stripe Global Payouts -------------------------------------------------------------------------------------
export function stripeGlobalPayouts(stripe: Stripe, mode: PayoutMode, financialAccount: string): PayoutProvider {
  const v2 = stripe.v2;
  const fa = async () => {
    if (financialAccount) return financialAccount;
    const list = await v2.moneyManagement.financialAccounts.list({});
    const storage = list.data.find((f) => f.type === "storage" && f.status === "open");
    if (!storage) throw new ProviderError("no_financial_account", "No open Stripe storage balance to pay from.", false);
    return storage.id;
  };
  const wrap = async <T,>(fn: () => Promise<T>): Promise<T> => {
    try { return await fn(); } catch (e) {
      if (e instanceof ProviderError) throw e;
      const err = e as { type?: string; code?: string; statusCode?: number; message?: string };
      const retryable = err.type === "StripeConnectionError" || err.type === "StripeAPIError" || err.statusCode === 429 || (err.statusCode ?? 0) >= 500;
      throw new ProviderError(err.code ?? err.type ?? "stripe_error", (err.message ?? "Stripe error").slice(0, 300), retryable);
    }
  };
  return {
    name: "stripe_global_payouts", mode,
    onboardingLink: (i) => wrap(async () => {
      let recipientRef = i.recipientRef;
      if (!recipientRef) {
        const acct = await v2.core.accounts.create({
          contact_email: i.email, display_name: i.name.slice(0, 100),
          identity: { country: "us", entity_type: "individual" },
          configuration: { recipient: { capabilities: { bank_accounts: { local: { requested: true } } } } },
          include: ["configuration.recipient", "requirements"],
          metadata: { b2b_staff_id: i.staffId },
        } as Stripe.V2.Core.AccountCreateParams, { idempotencyKey: `b2b-recipient-${i.staffId}` });
        recipientRef = acct.id;
      }
      const link = await v2.core.accountLinks.create({
        account: recipientRef,
        use_case: { type: "account_onboarding", account_onboarding: { configurations: ["recipient"], refresh_url: i.refreshUrl, return_url: i.returnUrl } },
      } as Stripe.V2.Core.AccountLinkCreateParams);
      return { recipientRef, url: link.url };
    }),
    destination: (recipientRef) => wrap(async () => {
      const methods = await v2.moneyManagement.payoutMethods.list({}, { stripeContext: recipientRef } as Stripe.RequestOptions);
      const m = methods.data.find((x) => !x.archived && x.type === "bank_account") ?? methods.data.find((x) => !x.archived);
      if (!m) return null;
      const bank = m.bank_account;
      return {
        recipientRef, methodRef: m.id, institution: bank?.bank_name ?? (m.card ? "Debit card" : null),
        accountType: bank ? (bank.bank_account_type === "savings" ? "savings" : "checking") : m.card ? "card" : "unknown",
        last4: (bank?.last4 ?? m.card?.last4 ?? null) as string | null,
        status: m.restricted ? "pending" : "verified",
      };
    }),
    send: (i) => wrap(async () => {
      const op = await v2.moneyManagement.outboundPayments.create({
        from: { financial_account: await fa(), currency: "usd" },
        to: { recipient: i.recipientRef, currency: "usd", ...(i.methodRef ? { payout_method: i.methodRef } : {}) },
        amount: { value: i.amountCents, currency: "usd" },
        description: i.description.slice(0, 100),
        metadata: { b2b_payout_ref: i.ref },
      } as Stripe.V2.MoneyManagement.OutboundPaymentCreateParams, { idempotencyKey: i.idempotencyKey });
      return { providerRef: op.id, status: op.status === "posted" ? "posted" : op.status === "failed" || op.status === "canceled" ? "failed" : "processing" };
    }),
    availableCents: () => wrap(async () => {
      const acct = await v2.moneyManagement.financialAccounts.retrieve(await fa());
      const usd = (acct.balance?.available as Record<string, { value?: number }> | undefined)?.usd;
      return typeof usd?.value === "number" ? usd.value : null;
    }),
  };
}
