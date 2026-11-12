import type { Metadata } from "next";
import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { isStripeConfigured } from "@/lib/env";
import { getStripe } from "@/lib/billing/stripe";
import { reconcileUser } from "@/lib/billing/apply";
import { CheckoutButton, PortalButton } from "@/components/billing/checkout-button";
import { Badge, Card, Notice } from "@/components/ui/misc";
import { plans } from "@/lib/site";
import { CreditBalances } from "@/components/billing/credits";
import { loadCreditStatus } from "@/lib/credits/server";

export const metadata: Metadata = { title: "Subscription", robots: { index: false } };

export default async function BillingPage({ searchParams }: PageProps<"/settings/billing">) {
  const sp = await searchParams;
  const user = (await getUser())!;
  const stripeReady = isStripeConfigured();
  // After checkout, pull the truth from Stripe in case the webhook hasn't arrived yet.
  // Access is still granted only from Stripe's own subscription state, never from the redirect itself.
  if (sp.checkout === "success" && stripeReady) {
    try { await reconcileUser(createAdminClient(), getStripe(), user.id); } catch { /* webhook will catch up */ }
  }
  const supabase = await createClient();
  const [{ data: subs }, credits, { data: bc }] = await Promise.all([
    supabase.from("subscriptions").select("*").order("updated_at", { ascending: false }),
    loadCreditStatus(supabase),
    supabase.from("billing_customers").select("stripe_customer_id").maybeSingle(),
  ]);
  const q = credits ? { unlimited: credits.unlimited } : null;
  const current = subs?.find((s) => ["active", "trialing", "past_due"].includes(s.status)) ?? subs?.[0];
  const end = current?.current_period_end ? new Date(current.current_period_end).toLocaleDateString(undefined, { dateStyle: "long" }) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-3xl font-extrabold">Subscription</h1>
      {sp.checkout === "success" && (q?.unlimited
        ? <Notice tone="ok" title="You're on Unlimited">Thanks! Payment confirmed by Stripe. Unlimited exports are active.</Notice>
        : <Notice tone="warn" title="Confirming your payment">We haven&apos;t received confirmation from Stripe yet. This usually takes a few seconds; refresh this page shortly.</Notice>)}
      {!stripeReady && <Notice tone="warn" title="Billing not configured">Stripe keys are not set on this server. See docs/SETUP.md.</Notice>}
      {current?.status === "past_due" && <Notice tone="danger" title="Payment failed">Your last payment didn&apos;t go through. Stripe will retry automatically; update your payment method to keep Unlimited.</Notice>}

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted">Current plan</p>
            <p className="text-2xl font-extrabold">{q?.unlimited ? (current?.plan === "annual" ? "Unlimited Annual" : "Unlimited Monthly") : "Free"}</p>
            {q?.unlimited && end && <p className="text-sm text-ink-soft">{current?.cancel_at_period_end ? `Cancels on ${end}. You keep Unlimited until then.` : `Renews on ${end}.`}</p>}
            {!q?.unlimited && <p className="text-sm text-ink-soft">{plans.starterCredits} starter credits to begin, then {plans.monthlyCredits} free bid every month.</p>}
          </div>
          {current && <Badge tone={q?.unlimited ? "ok" : "neutral"}>{current.status.replace("_", " ")}</Badge>}
        </div>
        {bc && <div className="mt-5 border-t border-line pt-4"><PortalButton label="Manage subscription, payment method & billing history" /><p className="mt-2 text-xs text-muted">Opens Stripe&apos;s secure customer portal, where you can change plans, cancel, update your card, and download invoices.</p></div>}
      </Card>

      {credits && !credits.unlimited && <CreditBalances credits={credits} showUpgrade={false} />}

      {!q?.unlimited && stripeReady && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="p-5"><p className="font-bold">Unlimited Monthly</p><p className="mb-4 text-2xl font-extrabold">{plans.monthlyPriceLabel}<span className="text-sm text-muted">/mo</span></p><CheckoutButton plan="monthly" signedIn label="Upgrade monthly" variant="primary" /></Card>
          <Card className="border-accent p-5"><p className="font-bold">Unlimited Annual <Badge tone="accent">Best value</Badge></p><p className="mb-4 text-2xl font-extrabold">{plans.annualPriceLabel}<span className="text-sm text-muted">/yr</span></p><CheckoutButton plan="annual" signedIn label="Upgrade annually" /></Card>
        </div>
      )}
    </div>
  );
}
