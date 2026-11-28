import { breadcrumbLd, ldJson } from "@/lib/seo/structured-data";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Check } from "lucide-react";
import { Container } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { COMPANY, FOUNDER, PROMISES } from "@/lib/marketing/about";
import { openGraphFor } from "@/lib/seo/open-graph";
import { plans, site } from "@/lib/site";

const description = `Who builds ${site.name}, how to reach us, and the promises we make about your data and billing.`;

export const metadata: Metadata = {
  title: "About",
  description,
  alternates: { canonical: "/about" },
  openGraph: openGraphFor({ title: `About ${site.name}`, description, path: "/about" }),
};

export default function AboutPage() {
  return (
    <Container className="py-12 sm:py-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(breadcrumbLd([{ name: "About", path: "/about" }])) }} />
      <div className="mx-auto max-w-3xl">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-accent-ink">About</p>
        <h1 className="mt-2 text-4xl font-extrabold text-navy">Estimating software built for the trades</h1>
        <p className="mt-4 text-lg text-ink-soft">
          {site.name} helps contractors in every trade build professional estimates, send proposals customers can sign
          online, and keep track of every bid. It&apos;s made by {COMPANY.legalName}, a {COMPANY.state} company.
        </p>

        {FOUNDER && (
          <section aria-labelledby="founder-h" className="mt-10 grid gap-6 rounded-2xl border border-line bg-surface p-6 sm:grid-cols-[160px_1fr]" data-testid="about-founder">
            {FOUNDER.photo && (
              <Image src={FOUNDER.photo} alt={FOUNDER.photoAlt ?? FOUNDER.name} width={160} height={160} className="h-40 w-40 rounded-xl object-cover" />
            )}
            <div className={FOUNDER.photo ? undefined : "sm:col-span-2"}>
              <h2 id="founder-h" className="text-2xl font-extrabold text-navy">Why we built it</h2>
              <div className="mt-3 space-y-3 text-ink-soft">{FOUNDER.story.map((p, i) => <p key={i}>{p}</p>)}</div>
              {FOUNDER.link && (
                <p className="mt-3"><a href={FOUNDER.link.href} target="_blank" rel="noopener noreferrer" className="font-semibold text-navy underline underline-offset-2 hover:text-ink" data-testid="founder-link">{FOUNDER.link.label}</a></p>
              )}
              <p className="mt-4 font-semibold text-ink">{FOUNDER.name}, {FOUNDER.role}</p>
            </div>
          </section>
        )}

        <section aria-labelledby="promises-h" className="mt-12">
          <h2 id="promises-h" className="text-2xl font-extrabold text-navy">What we promise</h2>
          <ul className="mt-5 grid gap-4 sm:grid-cols-2">
            {PROMISES.map((p) => (
              <li key={p.title} className="rounded-xl border border-line bg-surface p-5">
                <p className="flex items-center gap-2 font-semibold text-ink"><Check className="h-5 w-5 text-ok" aria-hidden />{p.title}</p>
                <p className="mt-2 text-sm text-ink-soft">{p.body}</p>
                {p.href && <Link href={p.href} className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-accent-ink underline-offset-4 hover:underline">{p.link}</Link>}
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="contact-h" className="mt-12 rounded-2xl border border-line bg-surface p-6">
          <h2 id="contact-h" className="text-2xl font-extrabold text-navy">Talk to us</h2>
          <p className="mt-2 text-ink-soft">
            Questions, feedback or a feature your trade needs? Email{" "}
            <a href={`mailto:${site.supportEmail}`} className="font-semibold text-accent-ink underline" data-testid="about-support-email">{site.supportEmail}</a>.
          </p>
        </section>

        <div className="mt-12 flex flex-wrap items-center gap-4">
          <ButtonLink href="/#trades" variant="accent" size="lg">Start Your {plans.starterCredits} Free Bids</ButtonLink>
          <Link href="/what-is-built2bid" className="inline-flex min-h-11 items-center font-semibold text-accent-ink underline-offset-4 hover:underline">Product facts and pricing</Link>
          <Link href="/#sample-proposal" className="inline-flex min-h-11 items-center font-semibold text-accent-ink underline-offset-4 hover:underline">See a sample proposal</Link>
        </div>
      </div>
    </Container>
  );
}
