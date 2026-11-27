import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Container, Notice } from "@/components/ui/misc";
import { MembershipActions } from "@/components/academy/advanced/membership-actions";
import { advancedState, listSubjects, loadMyAccess, myMemberships } from "@/lib/academy/advanced/server";
import { PLAN_META, usd } from "@/lib/academy/advanced/plans";
import { createAdminClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/billing/stripe";
import { reconcileUser } from "@/lib/billing/apply";
import { isStripeConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "Academy membership", robots: { index: false } };

const longDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { dateStyle: "long", timeZone: "America/Chicago" }) : "");
const STATUS: Record<string, string> = { active: "Active", trialing: "Active", past_due: "Payment problem: we're retrying your card", canceled: "Ended", unpaid: "Unpaid", incomplete: "Waiting for payment", incomplete_expired: "Checkout not completed", paused: "Paused" };

export default async function MembershipPage({ searchParams }: PageProps<"/academy/advanced/membership">) {
  const sp = await searchParams;
  const state = await advancedState();
  if (!state.user) redirect("/login?next=/academy/advanced/membership");
  // After Checkout, read Stripe's own state in case the webhook hasn't arrived yet. The redirect itself grants nothing.
  if ((sp.checkout === "success" || sp.upgraded) && isStripeConfigured()) {
    try { await reconcileUser(createAdminClient(), getStripe(), state.user.id); } catch { /* the webhook will catch up */ }
  }
  const [members, access, subjects] = await Promise.all([myMemberships(state.user.id), loadMyAccess(), listSubjects({ includeDraft: true })]);
  const title = new Map(subjects.map((s) => [s.slug, s.title]));
  const current = members.filter((m) => ["active", "trialing", "past_due", "incomplete"].includes(m.status));
  const past = members.filter((m) => !current.includes(m));
  return (
    <Container className="py-8">
      <Link href="/academy/advanced" className="text-sm font-semibold text-accent-ink hover:underline">← Advanced Learning</Link>
      <h1 className="mt-3 font-display text-3xl font-extrabold">Academy membership</h1>
      {sp.checkout === "success" && <Notice tone="ok" className="mt-4" title="Thanks for joining">Your access appears here as soon as Stripe confirms the payment, usually within a few seconds. Refresh if it isn&apos;t showing yet.</Notice>}
      {sp.upgraded && <Notice tone="ok" className="mt-4" title="Upgrade complete">Your new package is active.</Notice>}
      {!current.length && (
        <div className="mt-6 max-w-2xl">
          <Notice title="You don't have a paid Academy membership">{access.all_access || access.subjects.length ? "You have complimentary or staff access to Advanced Learning." : "Free Classroom courses are always open."} <Link href="/academy/advanced" className="font-semibold underline">Browse Advanced Learning</Link></Notice>
        </div>
      )}
      <div className="mt-6 grid gap-4">
        {current.map((m) => (
          <section key={m.id} className="rounded-xl border border-line bg-surface p-5 shadow-card" data-testid="membership-card">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-xl font-bold">{PLAN_META[m.plan].name}</h2>
              <p className="font-display text-xl font-extrabold">{m.amount_cents ? usd(m.amount_cents) : "—"}<span className="text-sm font-semibold text-ink-soft">/month + tax</span></p>
            </div>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-muted">Status</dt><dd className="font-semibold">{STATUS[m.status] ?? m.status}{m.cancel_at_period_end ? " · cancels at the end of this period" : ""}</dd></div>
              <div><dt className="text-muted">{m.cancel_at_period_end ? "Access until" : "Renews"}</dt><dd className="font-semibold">{longDate(m.current_period_end)}</dd></div>
              <div><dt className="text-muted">Subjects</dt><dd className="font-semibold">{m.plan === "all_access" ? "Every advanced subject" : m.subjects.map((s) => title.get(s) ?? s).join(", ")}</dd></div>
              <div><dt className="text-muted">Built2Bid software</dt><dd className="font-semibold">{m.plan === "all_access" ? (access.software ? "Individual Unlimited included (1 seat)" : "Included once payment is confirmed") : "Not included in this package"}</dd></div>
              {m.stage && <div><dt className="text-muted">Founding rate</dt><dd className="font-semibold">Stage {m.stage} rate, kept while you stay on this package</dd></div>}
              {m.mode === "test" && <div><dt className="text-muted">Mode</dt><dd className="font-semibold text-warn">Test mode (nothing real was charged)</dd></div>}
            </dl>
            <MembershipActions id={m.id} canceling={m.cancel_at_period_end} canUpgrade={m.plan !== "all_access"} />
            <p className="mt-3 text-xs text-muted">Canceling keeps your access until the date above. Your lesson progress, badges, free Academy membership and everything in Built2Bid (bids, customers, records) are never deleted. You can rejoin later at the price available then.</p>
          </section>
        ))}
      </div>
      {past.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-bold">Past memberships</h2>
          <ul className="mt-2 space-y-1 text-sm text-ink-soft">{past.map((m) => <li key={m.id}>{PLAN_META[m.plan].name}, {STATUS[m.status] ?? m.status}{m.current_period_end ? ` (${longDate(m.current_period_end)})` : ""}</li>)}</ul>
        </section>
      )}
      {!state.billing && current.length === 0 && <p className="mt-6 text-sm text-muted">Paid memberships open soon.</p>}
    </Container>
  );
}
