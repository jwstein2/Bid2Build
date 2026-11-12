import Link from "next/link";
import { Check, Eye, FileText, Percent, Ruler, Sparkles } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/misc";
import { TradePicker } from "@/components/marketing/trade-picker";
import { ProposalSample } from "@/components/marketing/proposal-sample";
import { pickerTrades } from "@/lib/trades/picker";
import { plans, site } from "@/lib/site";

const steps = [
  { icon: Ruler, title: "Pick your trade", body: "Start with sections and suggested items made for your work, or a blank estimate. Nothing is priced for you." },
  { icon: Percent, title: "Enter your costs", body: "Add line items with your real costs. Choose markup or target margin and watch profit update instantly." },
  { icon: Eye, title: "Choose what the customer sees", body: "Show group totals, item names, full itemization, or one project price. Your costs stay private." },
  { icon: FileText, title: "Download a branded PDF", body: "Preview the full proposal, then export a polished PDF with your logo and colors to send from your own email." },
];

const faqs = [
  { q: "Is it really free?", a: `Yes. The free plan includes ${plans.freeMonthlyExports} finalized PDF exports every calendar month, unlimited drafts and previews, every trade, and your branding. No credit card required.` },
  { q: "Do I need to sign up before I can try it?", a: "No. Pick a trade and start building right away. Your draft is saved in your browser. You only create an account (with a one-time email link) when you are ready to download your first PDF or save to the cloud." },
  { q: "Will my customer see my costs or markup?", a: "Never. Customer-facing proposals are built only from customer prices. Internal costs, margins, and notes are not included in the preview or the PDF." },
  { q: "Do you provide local material prices?", a: "Only when a licensed pricing source is connected. We never show made-up prices. Until then, you enter your own costs, which is what accurate bids are built on anyway." },
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
      <section className="relative overflow-hidden border-b border-line">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgb(31_58_95/0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgb(31_58_95/0.05)_1px,transparent_1px)] bg-[size:32px_32px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" />
        <Container className="relative pb-14 pt-12 text-center sm:pt-16">
          <p className="mx-auto inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent-tint px-3 py-1 text-xs font-semibold text-accent-dark">
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> {plans.freeMonthlyExports} free bids every month · No credit card
          </p>
          <h1 className="mx-auto mt-5 max-w-3xl text-4xl font-extrabold tracking-tight text-ink sm:text-6xl">What Are You Bidding Today?</h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-ink-soft">
            Build professional estimates, calculate your profit, and create beautiful proposals in minutes. Three free bids every month. No credit card required.
          </p>
          <div className="mx-auto mt-10 max-w-5xl">
            <TradePicker trades={pickerTrades()} />
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <ButtonLink href="/start/general-contracting" variant="accent" size="lg">Start Building Your Bid</ButtonLink>
            <ButtonLink href="#how-it-works" variant="secondary" size="lg">See How It Works</ButtonLink>
          </div>
        </Container>
      </section>

      <section id="how-it-works" className="scroll-mt-20 py-20">
        <Container>
          <div className="max-w-2xl">
            <h2 className="text-3xl font-extrabold sm:text-4xl">From kitchen-table numbers to a proposal you are proud to send</h2>
            <p className="mt-3 text-lg text-ink-soft">No training, no project-management bloat. Just the fastest way to a correct, professional bid.</p>
          </div>
          <ol className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s, i) => (
              <li key={s.title} className="rounded-xl border border-line bg-surface p-5">
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-tint text-brand"><s.icon className="h-5 w-5" aria-hidden /></span>
                  <span className="text-xs font-bold uppercase tracking-wider text-muted">Step {i + 1}</span>
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
            <h2 className="text-3xl font-extrabold sm:text-4xl">Know your profit before you send the bid</h2>
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
          <h2 className="text-3xl font-extrabold sm:text-4xl">Show the customer exactly what you want them to see</h2>
          <p className="mt-3 max-w-2xl text-lg text-ink-soft">Mix display modes across sections. Totals are identical in every mode.</p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { t: "Group total only", d: "Decking Material Package: one price." },
              { t: "Item names, no prices", d: "List what is included under one package price." },
              { t: "Fully itemized", d: "Quantity, unit price, and amount for every line." },
              { t: "Single project total", d: "One number for the whole job." },
            ].map((m, i) => (
              <div key={m.t} className="rounded-xl border border-line bg-surface p-5">
                <span className="text-xs font-bold text-accent-dark">Mode {String.fromCharCode(65 + i)}</span>
                <h3 className="mt-1 font-bold">{m.t}</h3>
                <p className="mt-1 text-sm text-ink-soft">{m.d}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="border-y border-line bg-brand py-16 text-white">
        <Container className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div>
            <h2 className="text-3xl font-extrabold">Free to start. {plans.monthlyPriceLabel}/month when you need more.</h2>
            <p className="mt-2 text-white/80">{plans.freeMonthlyExports} finalized bids every month on the free plan. Unlimited for {plans.monthlyPriceLabel}/month or {plans.annualPriceLabel}/year.</p>
          </div>
          <div className="flex gap-3">
            <ButtonLink href="/bids" variant="accent" size="lg">Start Building Your Bid</ButtonLink>
            <ButtonLink href="/pricing" size="lg" className="bg-white/10 hover:bg-white/20">Compare plans</ButtonLink>
          </div>
        </Container>
      </section>

      <section className="py-20">
        <Container className="max-w-3xl">
          <h2 className="text-3xl font-extrabold">Questions contractors ask</h2>
          <div className="mt-8 divide-y divide-line rounded-xl border border-line bg-surface">
            {faqs.map((f) => (
              <details key={f.q} className="group p-5">
                <summary className="cursor-pointer list-none font-semibold marker:hidden">
                  <span className="flex items-center justify-between gap-4">{f.q}<span className="text-muted transition group-open:rotate-45" aria-hidden>+</span></span>
                </summary>
                <p className="mt-2 text-ink-soft">{f.a}</p>
              </details>
            ))}
          </div>
          <p className="mt-6 text-sm text-muted">More in our <Link href="/learn" className="text-brand underline">contractor guides</Link>.</p>
        </Container>
      </section>
    </>
  );
}
