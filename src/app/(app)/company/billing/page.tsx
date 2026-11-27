import type { Metadata } from "next";
import Link from "next/link";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { isEnterpriseConfigured, isPmBillingConfigured, isPmEnabled } from "@/lib/env";
import { loadSeatCard } from "@/lib/pm/server";
import { PmEditorsCard } from "@/components/company/pm-editors";
import { getStripe } from "@/lib/billing/stripe";
import { reconcileUser } from "@/lib/billing/apply";
import { can, companySubscription, loadMyCompany } from "@/lib/enterprise/server";
import { enterpriseQuote, formatCents } from "@/lib/enterprise/pricing";
import { PortalButton } from "@/components/billing/checkout-button";
import { SeatChanger } from "@/components/company/seat-changer";
import { Badge, Card, Notice } from "@/components/ui/misc";
import { MetricCard } from "@/components/ui/metric-card";
import { ButtonLink } from "@/components/ui/button";

import { InstallDesktopCard } from "@/components/pwa/install-desktop-card";

export const metadata: Metadata = { title: "Billing & Licenses", robots: { index: false } };

type InvoiceRow = { id: string; created: number; total: number; status: string | null; url: string | null; number: string | null };

export default async function CompanyBillingPage({ searchParams }: PageProps<"/company/billing">) {
  const sp = await searchParams;
  const supabase = await createClient();
  const admin = createAdminClient();
  let company = await loadMyCompany(supabase);
  const ready = isEnterpriseConfigured();

  // Back from Checkout: pull Stripe's truth now in case the webhook hasn't arrived (access still comes
  // only from Stripe's subscription state, never from this redirect).
  if (sp.checkout === "success" && ready) {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      try { await reconcileUser(admin, getStripe(), user.id); } catch { /* the webhook will catch up */ }
      company = await loadMyCompany(supabase);
    }
  }

  if (!company) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <h1 className="text-3xl font-extrabold">Billing & Licenses</h1>
        {sp.checkout === "success"
          ? <Notice tone="neutral" title="Confirming your payment…">Stripe is confirming your Team subscription. This page updates within a minute; refresh if it doesn&apos;t.</Notice>
          : <Notice tone="neutral" title="No company account">The Team plan gives your crew a shared company account. <Link className="underline" href="/pricing#enterprise">See Team pricing</Link>.</Notice>}
      </div>
    );
  }
  if (!can(company, "manage_billing")) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <h1 className="text-3xl font-extrabold">Billing & Licenses</h1>
        <Notice tone="neutral" title="Billing is managed by your company owner">Ask {company.name}&apos;s owner if your team needs more licenses.</Notice>
      </div>
    );
  }

  const row = await companySubscription(admin, company.id);
  const licensed = row?.seat_quantity ?? company.entitlement.seatLimit;
  const { data: summary } = await supabase.rpc("company_billing_summary");
  const activeMembers = (summary as { activeMembers?: number } | null)?.activeMembers ?? null;
  const quote = enterpriseQuote(Math.max(3, licensed || 3));
  let invoices: InvoiceRow[] = [];
  if (row && ready) {
    try {
      const list = await getStripe().invoices.list({ customer: row.stripe_customer_id, subscription: row.stripe_subscription_id, limit: 12 });
      invoices = list.data.map((i) => ({ id: i.id ?? "", created: i.created, total: i.total, status: i.status, url: i.hosted_invoice_url ?? null, number: i.number }));
    } catch { /* invoices are optional on this page */ }
  }
  const end = row?.current_period_end ? new Date(row.current_period_end).toLocaleDateString(undefined, { dateStyle: "long" }) : null;
  const comp = company.entitlement.source === "complimentary";
  const canChangeSeats = Boolean(row && !comp && ready && (row.status === "active" || row.status === "trialing"));
  // Project scheduling editor seats (shown only once scheduling is switched on). Phase 9: managing who holds
  // a seat needs manage_pm_seats; buying seats needs manage_pm_addons (both owner-level by default).
  let pmCard: Awaited<ReturnType<typeof loadSeatCard>> & { extra: number } | null = null;
  if (isPmEnabled() && company.entitlement.active && (can(company, "manage_pm_seats") || can(company, "manage_pm_addons"))) {
    const { data: subRow } = row ? await admin.from("subscriptions").select("pm_extra_editors").eq("stripe_subscription_id", row.stripe_subscription_id).maybeSingle() : { data: null };
    const extra = (subRow as { pm_extra_editors?: number } | null)?.pm_extra_editors ?? 0;
    const card = await loadSeatCard(supabase, extra);
    if (card) pmCard = { ...card, extra };
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6" data-guide-page="company.billing">
      <div>
        <h1 className="text-3xl font-extrabold">Billing & Licenses</h1>
        <p className="text-ink-soft">{company.name}</p>
      </div>
      {sp.checkout === "success" && company.entitlement.active && <Notice tone="ok" title="Team plan is active">Payment confirmed by Stripe. Your company has {licensed} licensed users. Invite your team from Team & Access.</Notice>}
      {sp.checkout === "success" && company.entitlement.active && <InstallDesktopCard dismissible />}
      {row?.status === "past_due" && <Notice tone="danger" title="Payment failed">Your last Team payment didn&apos;t go through. Stripe retries automatically and your team keeps access meanwhile. Update your payment method to avoid losing access.</Notice>}
      {!company.entitlement.active && <Notice tone="warn" title="Team plan isn't active">Your team&apos;s bids and customers are safe, but licensed access is paused until the subscription is active again.</Notice>}

      <Card className="p-5" data-guide="company.licenses">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted">Plan</p>
            <p className="text-2xl font-extrabold">Team{comp && " (complimentary)"}</p>
            {!comp && <p className="text-sm text-ink-soft">{formatCents(quote.monthlyCents)}/month for {quote.totalUsers} licensed users</p>}
            {end && !comp && <p className="text-sm text-ink-soft">{row?.cancel_at_period_end ? `Cancels on ${end}. Your team keeps access until then.` : `Renews on ${end}.`}</p>}
            {comp && company.entitlement.expiresAt && <p className="text-sm text-ink-soft">Complimentary access until {new Date(company.entitlement.expiresAt).toLocaleDateString(undefined, { dateStyle: "long" })}. Nothing is charged.</p>}
          </div>
          <Badge tone={company.entitlement.active ? "ok" : "warn"}>{row?.status?.replace("_", " ") ?? (company.entitlement.active ? "active" : "inactive")}</Badge>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
          <MetricCard size="sm" className="bg-paper shadow-none" title="Licensed users" value={<span data-testid="licensed">{licensed}</span>} href={canChangeSeats ? "#seats" : "/company/users"} action={canChangeSeats ? "Add or remove licenses" : "View your team"} testId="kpi-licensed" />
          <MetricCard size="sm" className="bg-paper shadow-none" title="Active users" value={activeMembers ?? "—"} href="/company/users" action="View active users" testId="kpi-active-users" />
          <MetricCard size="sm" className="bg-paper shadow-none" title="Seats free" value={Math.max(0, licensed - company.seatsUsed)} href="/company/users" action="Invite a teammate" testId="kpi-seats-free" />
        </div>
        {!comp && (
          <dl className="mt-4 space-y-1 border-t border-line pt-3 text-sm">
            {quote.lines.map((l) => <div key={l.label} className="flex justify-between gap-3"><dt className="text-ink-soft">{l.label}{l.label.startsWith("Users") ? ` × ${formatCents(l.unitCents)}` : ""}</dt><dd>{formatCents(l.totalCents)}</dd></div>)}
            <div className="flex justify-between gap-3 font-bold"><dt>Monthly total</dt><dd>{formatCents(quote.monthlyCents)}</dd></div>
          </dl>
        )}
      </Card>

      {canChangeSeats && (
        <Card className="scroll-mt-24 p-5" id="seats" data-guide="company.seats">
          <h2 className="font-display text-lg font-bold">Add or remove licensed users</h2>
          <p className="mb-3 text-sm text-ink-soft">Each person on your team needs their own license. Inviting someone uses a free license; it never buys one. Buy licenses here first, and you&apos;ll see the exact charge before confirming.</p>
          <SeatChanger current={licensed} seatsInUse={company.seatsUsed} />
        </Card>
      )}
      {pmCard && <PmEditorsCard {...pmCard} comp={comp} canManage={can(company, "manage_pm_seats")} canBuy={Boolean(can(company, "manage_pm_addons") && row && !comp && isPmBillingConfigured("editor") && (row.status === "active" || row.status === "trialing"))} />}
      {comp && <Notice tone="neutral" title="Need more users?">Complimentary accounts include 3 users. Contact Built2Bid to arrange more.</Notice>}

      {row && (
        <Card className="p-5" data-guide="company.portal">
          <h2 className="font-display text-lg font-bold">Payment method, invoices & cancellation</h2>
          <div className="mt-3"><PortalButton label="Manage payment method & subscription" /></div>
          <p className="mt-2 text-xs text-muted">Opens Stripe&apos;s secure portal to update your card, download invoices, or cancel. Canceling never deletes your company&apos;s bids or customers.</p>
          {invoices.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Recent Team invoices</caption>
                <thead><tr className="border-b border-line text-left"><th className="py-2">Date</th><th className="py-2">Invoice</th><th className="py-2">Status</th><th className="py-2 text-right">Amount</th></tr></thead>
                <tbody>{invoices.map((i) => (
                  <tr key={i.id} className="border-b border-line last:border-0">
                    <td className="py-2">{new Date(i.created * 1000).toLocaleDateString()}</td>
                    <td className="py-2">{i.url ? <a className="underline" href={i.url} target="_blank" rel="noreferrer">{i.number ?? "View"}</a> : i.number ?? "—"}</td>
                    <td className="py-2 capitalize">{i.status ?? "—"}</td>
                    <td className="py-2 text-right">{formatCents(i.total)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      <ButtonLink href="/pricing#enterprise" variant="secondary">See Team pricing</ButtonLink>
    </div>
  );
}
