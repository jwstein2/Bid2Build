import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { isPmBillingConfigured, isPmEnabled, isStripeConfigured } from "@/lib/env";
import { loadPmAccess } from "@/lib/pm/server";
import { PmAddonCard } from "@/components/billing/pm-addon";
import { getStripe } from "@/lib/billing/stripe";
import { reconcileUser } from "@/lib/billing/apply";
import { CheckoutButton, PortalButton } from "@/components/billing/checkout-button";
import { Badge, Card, Notice } from "@/components/ui/misc";
import { plans } from "@/lib/site";
import { CreditBalances } from "@/components/billing/credits";
import { loadCreditStatus } from "@/lib/credits/server";
import { ANNUAL, ANNUAL_MONTHLY_EQUIVALENT, MONTHLY, isPlanId, planDisplay } from "@/lib/billing/plans";
import { ClearCheckoutIntent, ConfirmingPayment } from "@/components/billing/checkout-return";
import { can, loadMyCompany } from "@/lib/enterprise/server";
import Link from "next/link";

export const metadata: Metadata = { title: "Subscription", robots: { index: false } };

interface CompAccess { plan: "unlimited" | "enterprise"; state: string; starts_at: string | null; expires_at: string | null }

const longDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" }) : "");

export default async function BillingPage({ searchParams }: PageProps<"/settings/billing">) {
  const sp = await searchParams;
  const user = await getUser();
  // The layout redirects too, but pages render in parallel with it: never assume a session here.
  if (!user) redirect("/login?next=/settings/billing");
  const stripeReady = isStripeConfigured();
  // After checkout, pull the truth from Stripe in case the webhook hasn't arrived yet.
  // Access is still granted only from Stripe's own subscription state, never from the redirect itself.
  if (sp.checkout === "success" && stripeReady) {
    try { await reconcileUser(createAdminClient(), getStripe(), user.id); } catch { /* webhook will catch up */ }
  }
  const supabase = await createClient();
  const [{ data: subs }, credits, { data: bc }, { data: compRows }, company] = await Promise.all([
    supabase.from("subscriptions").select("*").order("updated_at", { ascending: false }),
    loadCreditStatus(supabase),
    supabase.from("billing_customers").select("stripe_customer_id").maybeSingle(),
    supabase.rpc("my_comp_access"), // errors (migration not applied yet) just mean "no complimentary access"
    loadMyCompany(supabase),
  ]);
  const q = credits ? { unlimited: credits.unlimited } : null;
  const pm = isPmEnabled() && credits?.unlimited ? await loadPmAccess(supabase) : null;
  const current = subs?.find((s) => ["active", "trialing", "past_due"].includes(s.status)) ?? subs?.[0];
  const paidActive = Boolean(current && ["active", "trialing", "past_due"].includes(current.status) && (!current.current_period_end || new Date(current.current_period_end) > new Date()));
  const comp = (Array.isArray(compRows) ? compRows[0] : null) as CompAccess | null;
  const compActive = comp?.state === "active";
  // Unlimited only because of a complimentary grant: show that, never a made-up paid plan.
  const compOnly = Boolean(q?.unlimited && compActive && !paidActive);
  // Unlimited only because of an Enterprise seat: the company pays, so never show a personal Unlimited price.
  const seatOnly = Boolean(q?.unlimited && company?.entitlement.active && !paidActive && !compOnly);
  const companyBilling = company ? (can(company, "manage_billing") ? "/company/billing" : null) : null;
  const compEnded = !q?.unlimited && comp && ["expired", "revoked"].includes(comp.state) ? (comp.state === "revoked" ? null : comp.expires_at) : null;
  const ended = !q?.unlimited && current && ["canceled", "unpaid", "incomplete_expired"].includes(current.status) ? (current.ended_at ?? current.current_period_end) : null;
  const end = current?.current_period_end ? new Date(current.current_period_end).toLocaleDateString(undefined, { dateStyle: "long" }) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6" data-guide-page="settings.billing">
      <h1 className="text-3xl font-extrabold">Subscription</h1>
      {sp.checkout === "success" && <ClearCheckoutIntent />}
      {sp.checkout === "success" && (q?.unlimited
        ? <Notice tone="ok" title="You're on Unlimited">Thanks! Payment confirmed by Stripe. Unlimited exports are active.</Notice>
        : <ConfirmingPayment planName={isPlanId(sp.plan) ? planDisplay(sp.plan).name : "Unlimited"} />)}
      {sp.notice === "already_subscribed" && q?.unlimited && <Notice tone="ok" title="You already have Unlimited">We didn&apos;t start a new checkout, so you won&apos;t be charged twice. Change or cancel your plan below.</Notice>}
      {!stripeReady && <Notice tone="warn" title="Billing not configured">Stripe keys are not set on this server. See docs/SETUP.md.</Notice>}
      {current?.status === "past_due" && <Notice tone="danger" title="Payment failed">Your last payment didn&apos;t go through. Stripe will retry automatically; update your payment method to keep Unlimited.</Notice>}

      {compEnded && <Notice tone="neutral" title="Your complimentary access has ended">Complimentary {comp!.plan === "enterprise" ? "Enterprise" : "Unlimited"} access ended on {longDate(compEnded)}. All your bids and customers are still here, and your free credits apply again. Nothing was charged. Subscribe below to keep unlimited bidding.</Notice>}
      {compActive && paidActive && <Notice tone="neutral" title="Complimentary access">You also have complimentary {comp!.plan === "enterprise" ? "Enterprise" : "Unlimited"} access until {longDate(comp!.expires_at)}. Your paid plan below continues exactly as before.</Notice>}

      {ended && <Notice tone="neutral" title="Your Unlimited plan has ended">Unlimited ended on {new Date(ended).toLocaleDateString(undefined, { dateStyle: "long" })}. All your bids are still here, and your free credits apply again. Resubscribe any time below.</Notice>}

      <Card className="p-5" data-guide="billing.plan">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted">Current plan</p>
            <p className="text-2xl font-extrabold">{seatOnly ? "Enterprise" : compOnly ? `Complimentary ${comp!.plan === "enterprise" ? "Enterprise" : "Unlimited"}` : q?.unlimited ? (current?.plan === "annual" ? ANNUAL.name : MONTHLY.name) : "Free"}</p>
            {compOnly && <p className="text-sm text-ink-soft">Free until {longDate(comp!.expires_at)}. No payment details are on file and nothing is charged when it ends; you&apos;ll simply return to the Free plan unless you subscribe.</p>}
            {seatOnly && <p className="text-sm text-ink-soft" data-testid="seat-plan">Your licensed seat is part of {company!.name}&apos;s Enterprise plan. You aren&apos;t billed personally.</p>}
            {q?.unlimited && !compOnly && !seatOnly && <p className="text-sm text-ink-soft">{current?.plan === "annual" ? `${ANNUAL.price}/year, billed annually` : `${MONTHLY.price}/month, billed monthly`}</p>}
            {q?.unlimited && !compOnly && !seatOnly && end && <p className="text-sm text-ink-soft">{current?.cancel_at_period_end ? `Cancels on ${end}. You keep Unlimited until then.` : `Renews on ${end}.`}</p>}
            {!q?.unlimited && <p className="text-sm text-ink-soft">{plans.starterCredits} starter credits to begin, then {plans.monthlyCredits} free bid every month.</p>}
          </div>
          {seatOnly ? <Badge tone="ok">company plan</Badge> : compOnly ? <Badge tone="ok">complimentary</Badge> : current && <Badge tone={q?.unlimited ? "ok" : "neutral"}>{current.status.replace("_", " ")}</Badge>}
        </div>
        {bc && <div className="mt-5 border-t border-line pt-4" data-guide="billing.manage"><PortalButton label="Manage subscription, payment method & billing history" /><p className="mt-2 text-xs text-muted">Opens Stripe&apos;s secure customer portal, where you can change plans, cancel, update your card, and download invoices.</p></div>}
      </Card>

      {company && (
        <Card className="p-5" data-testid="company-billing-pointer">
          <p className="text-sm text-muted">Company plan</p>
          <p className="font-bold">{company.name} · Enterprise{company.entitlement.active ? "" : " (paused)"}</p>
          <p className="mt-1 text-sm text-ink-soft">{companyBilling
            ? "Your company plan, licensed users, schedule editors, invoices and payment method are all on Billing & Licenses."
            : `Licensed users, schedule editors and company invoices are managed by ${company.name}'s owner.`}</p>
          {companyBilling && <Link href={companyBilling} className="mt-3 inline-flex min-h-11 items-center font-semibold text-brand underline">Open Billing &amp; Licenses</Link>}
          {paidActive && <p className="mt-2 text-xs text-muted">You also have a personal subscription (above). It&apos;s billed separately from your company plan.</p>}
        </Card>
      )}

      {pm && pm.scope !== "company" && (paidActive || pm.source === "complimentary") && (
        <div id="project-command-center" className="scroll-mt-20" data-guide="billing.pm-addon"><PmAddonCard state={pm} periodEnd={current?.current_period_end ?? null} annual={current?.plan === "annual" && !process.env.STRIPE_PRICE_PM_ADDON_ANNUAL} yearly={current?.plan === "annual" && Boolean(process.env.STRIPE_PRICE_PM_ADDON_ANNUAL)} purchasable={isPmBillingConfigured("addon")} /></div>
      )}
      {credits && !credits.unlimited && <div data-guide="billing.credits"><CreditBalances credits={credits} showUpgrade={false} /></div>}

      {(!q?.unlimited || compOnly) && stripeReady && (
        <div className="grid gap-4 sm:grid-cols-2" data-guide="billing.upgrade">
          {compOnly && <p className="text-sm text-ink-soft sm:col-span-2">Want to keep Unlimited after your complimentary access ends? Subscribing starts billing today.</p>}
          <Card className="flex flex-col p-5"><p className="font-bold">{MONTHLY.name}</p><p className="text-2xl font-extrabold">{MONTHLY.price}<span className="text-sm font-semibold text-muted">/month</span></p><p className="mb-4 flex-1 text-sm text-ink-soft">Billed monthly. Cancel anytime.</p><CheckoutButton plan="monthly" signedIn label="Choose Monthly" variant="primary" /></Card>
          <Card className="flex flex-col border-accent p-5"><p className="font-bold">{ANNUAL.name} <Badge tone="accent">Best value</Badge></p><p className="text-2xl font-extrabold">{ANNUAL.price}<span className="text-sm font-semibold text-muted">/year</span></p><p className="mb-4 flex-1 text-sm text-ink-soft">Billed annually. Equivalent to {ANNUAL_MONTHLY_EQUIVALENT}/month.</p><CheckoutButton plan="annual" signedIn label="Choose Annual" /></Card>
          <p className="text-sm text-muted sm:col-span-2">Both plans include exactly the same Unlimited features.</p>
        </div>
      )}
    </div>
  );
}
