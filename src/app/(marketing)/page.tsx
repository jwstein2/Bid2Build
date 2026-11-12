import Link from "next/link";
import { ArrowRight, Check, ClipboardList, Download, FileText, LayoutGrid, Ruler, Timer, TrendingUp } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/misc";
import { TradePicker } from "@/components/marketing/trade-picker";
import { ProposalSample } from "@/components/marketing/proposal-sample";
import { SampleProposal } from "@/components/marketing/sample-proposal";
import { pickerTrades } from "@/lib/trades/picker";
import { trades } from "@/lib/trades/catalog";
import { plans, site } from "@/lib/site";

const steps = [
  { icon: LayoutGrid, title: "Choose your trade", body: "Start from sections made for your work (roofing, decks, kitchens and 30+ more) or a blank estimate. Nothing is pre-priced." },
  { icon: Ruler, title: "Scope the project", body: "Add your company details once, then the customer, address and scope. Your draft saves as you go." },
  { icon: ClipboardList, title: "Build the estimate", body: "Enter quantities and your own costs. Pick markup or target margin and see price, profit and tax update live." },
  { icon: Download, title: "Review and export", body: "Choose what the customer sees, preview the proposal, then download a branded PDF to send from your own email." },
];

const faqs = [
  { q: "Is it really free?", a: `Yes. The free plan includes ${plans.freeMonthlyExports} finalized PDF exports every calendar month, unlimited drafts and previews, every trade, and your branding. No credit card required.` },
  { q: "Do I need to sign up before I can try it?", a: "No. Pick a trade and start building right away. Your draft is saved in your browser. You only create an account (with a one-time email link) when you are ready to download your first PDF or save to the cloud." },
  { q: "Will my customer see my costs or markup?", a: "Never. Customer-facing proposals are built only from customer prices. Internal costs, margins, and notes are not included in the preview or the PDF." },
  { q: "Do you provide local material prices?", a: "Only when a licensed pricing source is connected. We never show made-up prices. Until then, you enter your own costs, which is what accurate bids are built on anyway." },
  { q: "Where is my draft saved?", a: "Before you sign in, drafts are saved in this browser on this device. After you sign in, they autosave to your account so you can pick them up on any device." },
  { q: "What counts as one of my free bids?", a: "A bid is used the first time a new finalized proposal version is exported. Re-downloading the same version is free, and editing drafts never uses a bid." },
];

export default function HomePage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: site.name,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: site.description,
    offers: [
      { "@type": "Offer", price: "0", priceCurrency: "USD", name: "Free" },
      { "@type": "Offer", price: "19.99", priceCurrency: "USD", name: "Unlimited Monthly" },
      { "@type": "Offer", price: "149", priceCurrency: "USD", name: "Unlimited Annual" },
    ],
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <section className="on-dark relative overflow-hidden bg-navy text-white">
        <div aria-hidden className="blueprint-grid-dark pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_95%)]" />
        <Container className="relative grid items-center gap-12 pb-16 pt-12 sm:pt-16 lg:grid-cols-[1.05fr_1fr] lg:gap-14 lg:pb-20">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-3 py-1 text-xs font-semibold text-[#D5DFE9]">
              <span className="h-1.5 w-1.5 rounded-full bg-teal" aria-hidden /> For contractors in every trade · {plans.freeMonthlyExports} free bids a month
            </p>
            <h1 className="mt-5 max-w-xl text-4xl font-extrabold leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-[3.5rem]">
              Professional bids, <span className="relative inline-block text-cyan">without the busywork.<svg aria-hidden viewBox="0 0 300 12" preserveAspectRatio="none" className="absolute -bottom-2 left-0 h-2.5 w-full"><path d="M3 9C80 3 200 2 297 6" fill="none" stroke="#14B8A6" strokeWidth="4" strokeLinecap="round" /></svg></span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-[#D5DFE9]">
              Build polished estimates and proposals for your trade without starting from scratch every time. Price with markup or margin, choose what your customer sees, and download a branded PDF.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <ButtonLink href="/bids" variant="accent" size="lg">Create a free bid <ArrowRight className="h-4 w-4" aria-hidden /></ButtonLink>
              <ButtonLink href="#how-it-works" size="lg" className="border border-white/40 bg-transparent text-white hover:bg-white/10">See how it works</ButtonLink>
            </div>
            <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-[#D5DFE9]">
              {["No sign-up until you download", "No credit card", "Your costs stay private"].map((x) => (
                <li key={x} className="flex items-center gap-1.5"><Check className="h-4 w-4 text-teal" aria-hidden />{x}</li>
              ))}
            </ul>
          </div>
          <SampleProposal className="mx-auto w-full max-w-xl lg:max-w-none" dark />
        </Container>
        <div className="relative border-t border-white/10">
          <Container className="grid grid-cols-2 gap-4 py-5 text-sm font-semibold text-white md:grid-cols-4">
            {[
              { icon: LayoutGrid, t: `${trades.length} trade templates` },
              { icon: FileText, t: "Professional proposals" },
              { icon: Timer, t: "Saves as you go" },
              { icon: TrendingUp, t: "Know your profit" },
            ].map((f) => (
              <p key={f.t} className="flex items-center gap-2.5"><f.icon className="h-5 w-5 text-cyan" aria-hidden /> {f.t}</p>
            ))}
          </Container>
        </div>
      </section>

      <section id="trades" className="scroll-mt-20 border-b border-line py-16 sm:py-20">
        <Container>
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-accent-ink">Start here</p>
            <h2 className="mt-2 text-3xl font-extrabold text-navy sm:text-4xl">What are you bidding today?</h2>
            <p className="mt-3 text-lg text-ink-soft">Pick a trade to open a bid with sections ready for that kind of work.</p>
          </div>
          <div className="mx-auto mt-10 max-w-5xl">
            <TradePicker trades={pickerTrades()} />
          </div>
        </Container>
      </section>

      <section id="how-it-works" className="scroll-mt-20 py-20">
        <Container>
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-accent-ink">How it works</p>
            <h2 className="mt-2 text-3xl font-extrabold text-navy sm:text-4xl">From project details to a proposal you&apos;re proud to send</h2>
            <p className="mt-3 text-lg text-ink-soft">Four steps, no training, no project-management bloat.</p>
          </div>
          <ol className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s, i) => (
              <li key={s.title} className="relative rounded-xl border border-line bg-surface p-5 shadow-card">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-lg bg-navy text-cyan"><s.icon className="h-5 w-5" aria-hidden /></span>
                  <span className="font-display text-xs font-bold uppercase tracking-wider text-muted">Step {i + 1} of {steps.length}</span>
                </div>
                <h3 className="mt-4 text-lg font-bold">{s.title}</h3>
                <p className="mt-1.5 text-sm text-ink-soft">{s.body}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <section className="border-y border-line bg-surface py-20">
        <Container className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <h2 className="text-3xl font-extrabold text-navy sm:text-4xl">Know your profit before you send the bid</h2>
            <p className="mt-3 text-lg text-ink-soft">
              Markup and margin are not the same thing. A 25% markup is a 20% gross margin. {site.name} lets you price either way and always shows
              both, so you never under-price a job by mixing them up.
            </p>
            <ul className="mt-6 space-y-3 text-ink-soft">
              {[
                "Markup or target-margin pricing, with per-group and per-item overrides",
                "Separate sales tax from revenue, with taxable and non-taxable items",
                "Overhead, contingency, permits, and delivery as costs or pass-through charges",
                "Precise decimal math: every printed line multiplies out exactly",
              ].map((x) => (
                <li key={x} className="flex gap-2"><Check className="mt-0.5 h-5 w-5 shrink-0 text-ok" aria-hidden />{x}</li>
              ))}
            </ul>
          </div>
          <ProposalSample />
        </Container>
      </section>

      <section className="py-20">
        <Container>
          <h2 className="text-3xl font-extrabold text-navy sm:text-4xl">Show the customer exactly what you want them to see</h2>
          <p className="mt-3 max-w-2xl text-lg text-ink-soft">Mix display modes across sections. Totals are identical in every mode.</p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { t: "Group total only", d: "Decking Material Package: one price." },
              { t: "Item names, no prices", d: "List what is included under one package price." },
              { t: "Fully itemized", d: "Quantity, unit price, and amount for every line." },
              { t: "Single project total", d: "One number for the whole job." },
            ].map((m, i) => (
              <div key={m.t} className="rounded-xl border border-line bg-surface p-5 shadow-card">
                <span className="font-display text-xs font-bold text-accent-ink">Mode {String.fromCharCode(65 + i)}</span>
                <h3 className="mt-1 font-bold">{m.t}</h3>
                <p className="mt-1 text-sm text-ink-soft">{m.d}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="on-dark relative overflow-hidden bg-navy py-16 text-white">
        <div aria-hidden className="blueprint-grid-dark pointer-events-none absolute inset-0" />
        <Container className="relative flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div>
            <h2 className="text-3xl font-extrabold">Free to start. {plans.monthlyPriceLabel}/month when you need more.</h2>
            <p className="mt-2 text-[#D5DFE9]">{plans.freeMonthlyExports} finalized bids every month on the free plan. Unlimited for {plans.monthlyPriceLabel}/month or {plans.annualPriceLabel}/year.</p>
          </div>
          <div className="flex gap-3">
            <ButtonLink href="/bids" variant="accent" size="lg">Create a free bid</ButtonLink>
            <ButtonLink href="/pricing" size="lg" className="border border-white/30 bg-transparent hover:bg-white/10">Compare plans</ButtonLink>
          </div>
        </Container>
      </section>

      <section className="py-20">
        <Container className="max-w-3xl">
          <h2 className="text-3xl font-extrabold text-navy">Questions contractors ask</h2>
          <div className="mt-8 divide-y divide-line rounded-xl border border-line bg-surface">
            {faqs.map((f) => (
              <details key={f.q} className="group p-5">
                <summary className="cursor-pointer list-none font-semibold marker:hidden [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center justify-between gap-4">{f.q}<span className="text-muted transition group-open:rotate-45" aria-hidden>+</span></span>
                </summary>
                <p className="mt-2 text-ink-soft">{f.a}</p>
              </details>
            ))}
          </div>
          <p className="mt-6 text-sm text-muted">More in our <Link href="/learn" className="text-accent-ink underline">contractor guides</Link>, or <a href={`mailto:${site.supportEmail}`} className="text-accent-ink underline">email support</a>.</p>
        </Container>
      </section>
    </>
  );
}
