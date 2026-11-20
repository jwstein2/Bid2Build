import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, LineChart, ShieldCheck, Link2, BadgeDollarSign, Repeat } from "lucide-react";
import { Container } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { PROGRAM } from "@/lib/affiliates/content";

export const metadata: Metadata = {
  title: "Affiliate Program",
  description: "Refer contractors to Built2Bid and earn one month of their subscription value once a year, for up to 10 years while they stay paying customers.",
  alternates: { canonical: "/affiliates" },
};

const STEPS = [
  { icon: Link2, title: "Share your link", body: "Apply, get approved, and share your permanent link in your videos, posts or newsletter. Add campaign tags to see what works." },
  { icon: BadgeDollarSign, title: "A contractor subscribes", body: "When someone signs up through your link within 90 days and pays their first subscription invoice, your first annual commission is created." },
  { icon: Repeat, title: "Earn again each anniversary", body: "Every year they're still a paying customer, you earn one month of their subscription value again, for up to 10 years." },
];

const FAQ = [
  { q: "Is this paid monthly?", a: "No. You earn one month of the customer's eligible subscription value once a year, on the anniversary of their first payment. It's never paid monthly and never paid up front for future years." },
  { q: "What if the customer upgrades or switches to annual?", a: "Upgrades raise the next anniversary's amount; downgrades lower it. Annual plans count as the annual price divided by 12. The 10-year term never restarts." },
  { q: "What doesn't count?", a: "Sales tax, failed payments, refunds and chargebacks. Each commission waits 30 days before it can be paid, so a refund in that window cancels or reduces it." },
  { q: "How do I get paid?", a: "By ACH to a U.S. bank account you connect on our payment provider's secure page. We need a W-9 first. The first release supports U.S. affiliates only." },
  { q: "Who can join?", a: "Creators and publishers who serve contractors and the trades. Every application is reviewed by hand. You'll need to follow our disclosure rules (FTC) and the affiliate agreement." },
  { q: "Can I refer myself or my own company?", a: "No. Self-referrals, fake accounts and misleading promotion aren't allowed and end commissions." },
];

/** Public Affiliate Program page. Separate from the staff-only Sales Portal (never linked from here). */
export default function AffiliatesPage() {
  return (
    <>
      <section className="border-b border-line bg-paper">
        <Container className="py-16 sm:py-20">
          <p className="text-sm font-bold uppercase tracking-wide text-brand">Built2Bid Affiliate Program</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-extrabold leading-tight text-ink sm:text-5xl">{PROGRAM.headline}</h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-soft">{PROGRAM.short}</p>
          <p className="mt-3 max-w-2xl rounded-lg border border-line bg-surface px-4 py-3 text-sm text-ink"><strong>{PROGRAM.annual}</strong></p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/affiliates/apply" data-testid="affiliate-apply-cta">Apply to join</ButtonLink>
            <ButtonLink href="/affiliate-hub/login" variant="secondary">Affiliate sign in</ButtonLink>
          </div>
          <p className="mt-4 max-w-2xl text-xs text-muted">{PROGRAM.noGuarantee}</p>
        </Container>
      </section>

      <Container className="py-14">
        <h2 className="text-2xl font-extrabold text-ink">How it works</h2>
        <ol className="mt-6 grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-xl border border-line bg-surface p-5 shadow-card">
              <s.icon className="h-6 w-6 text-brand" aria-hidden />
              <p className="mt-3 text-xs font-bold uppercase text-muted">Step {i + 1}</p>
              <h3 className="mt-1 text-lg font-bold text-ink">{s.title}</h3>
              <p className="mt-2 text-sm text-ink-soft">{s.body}</p>
            </li>
          ))}
        </ol>
      </Container>

      <section className="border-y border-line bg-paper">
        <Container className="grid gap-8 py-14 lg:grid-cols-2">
          <div>
            <h2 className="text-2xl font-extrabold text-ink">An illustration, not a promise</h2>
            <p className="mt-3 text-ink-soft">Say you refer one contractor who subscribes at $19.99 a month and stays a paying customer for 10 years, upgrading to $29.99 a month in year 4.</p>
            <ul className="mt-4 space-y-2 text-sm text-ink">
              <li><strong>Years 1 to 3:</strong> about $19.99 once each year</li>
              <li><strong>Years 4 to 10:</strong> about $29.99 once each year</li>
              <li><strong>Total over 10 years:</strong> about $269.90 from that one customer, paid as 10 annual payments</li>
            </ul>
            <p className="mt-4 text-xs text-muted">Hypothetical example for explanation only. Most referred customers won&apos;t stay 10 years; many cancel earlier, and then commissions stop. Your results depend on your audience and effort.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[{ icon: CalendarClock, t: "Commission calendar", b: "See every confirmed and forecast annual payment by month." },
              { icon: LineChart, t: "10-year portfolio", b: "Track each referred customer's term, status and earnings by year." },
              { icon: ShieldCheck, t: "Transparent ledger", b: "Every commission shows the invoice it came from and why it was paid, held or not earned." },
              { icon: Link2, t: "Links and QR codes", b: "Campaign links, QR codes, talking points, screenshots and disclosure templates." }].map((c) => (
              <div key={c.t} className="rounded-xl border border-line bg-surface p-4">
                <c.icon className="h-5 w-5 text-brand" aria-hidden />
                <p className="mt-2 font-bold text-ink">{c.t}</p>
                <p className="mt-1 text-sm text-ink-soft">{c.b}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <Container className="py-14">
        <h2 className="text-2xl font-extrabold text-ink">Questions</h2>
        <dl className="mt-6 grid gap-4 md:grid-cols-2">
          {FAQ.map((f) => (
            <div key={f.q} className="rounded-xl border border-line bg-surface p-5">
              <dt className="font-bold text-ink">{f.q}</dt>
              <dd className="mt-2 text-sm text-ink-soft">{f.a}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-10 rounded-xl border border-line bg-paper p-6">
          <h2 className="text-xl font-extrabold text-ink">Ready to apply?</h2>
          <p className="mt-2 text-sm text-ink-soft">Applications take about five minutes. Read the <Link className="underline" href="/affiliates/terms">program terms</Link> first.</p>
          <ButtonLink className="mt-4" href="/affiliates/apply">Apply to join</ButtonLink>
        </div>
        <p className="mt-6 text-xs text-muted">Built2Bid affiliates are independent partners, not employees or agents of Built2Bid L.L.C. Affiliates must clearly disclose that they earn a commission. {PROGRAM.noGuarantee}</p>
      </Container>
    </>
  );
}
