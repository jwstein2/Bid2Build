import type { Metadata } from "next";
import Link from "next/link";
import { Container, Notice } from "@/components/ui/misc";
import { GuideView } from "@/components/academy/startup/guide-view";
import { KB_STATES, stateName } from "@/lib/academy/kb/location";
import { resolveLocation } from "@/lib/academy/kb/server";
import { guideFor, startingCourseSlug } from "@/lib/academy/startup/data";
import { trades } from "@/lib/trades/catalog";

export const metadata: Metadata = {
  title: "Start Your Contracting Business: Steps and Licenses by State and Trade",
  description: "Free step-by-step guide to starting a contracting business in your state: what licenses and certifications your trade needs first, then registration, taxes, insurance and hiring, with links to every official agency.",
};

const select = "w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm";
const TRADES = trades.filter((t) => t.slug !== "other").map((t) => ({ slug: t.slug, name: t.name }));

export default async function StartBusinessPage({ searchParams }: PageProps<"/academy/start">) {
  const sp = await searchParams;
  const loc = await resolveLocation(sp);
  const state = loc.state;
  const trade = loc.trade && TRADES.some((t) => t.slug === loc.trade) ? loc.trade : null;
  const tradeLabel = TRADES.find((t) => t.slug === trade)?.name ?? null;
  const guide = state ? guideFor(state, trade) : null;
  const label = stateName(state) ?? state ?? "";

  return (
    <Container className="py-8">
      <h1 className="font-display text-3xl font-extrabold">Start your contracting business</h1>
      <p className="mt-1 max-w-3xl text-ink-soft">
        Pick your state and trade. We show what you need before you can start (licenses, exams, certificates), then every step in order, with a link to the official agency for each one. Free, no sign-in needed.
      </p>

      <form id="startup-form" method="get" action="/academy/start" className="mt-5 grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end" data-testid="startup-form">
        <label className="grid gap-1 text-sm font-semibold">
          State
          <select name="state" defaultValue={state ?? ""} className={select} required>
            <option value="" disabled>Choose your state</option>
            {KB_STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Type of business
          <select name="trade" defaultValue={trade ?? ""} className={select}>
            <option value="">General contracting (no specific trade)</option>
            {TRADES.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
          </select>
        </label>
        <button type="submit" className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy/90">Show my steps</button>
      </form>

      {!state ? (
        <Notice className="mt-6" tone="neutral" title="Choose your state to begin">Licensing, registration and workers&apos; comp rules are set state by state, so the steps start with where your business is based.</Notice>
      ) : !guide ? (
        <Notice className="mt-6" tone="neutral" title={`We're still researching ${label}`}>We verify every step against official government pages before showing it. {label} isn&apos;t finished yet. In the meantime, check your state&apos;s contractor licensing agency and secretary of state.</Notice>
      ) : (
        <>
          <h2 className="mt-8 text-2xl font-bold">Starting a {tradeLabel ? tradeLabel.toLowerCase() : "contracting"} business in {label}</h2>
          <GuideView guide={guide} stateLabel={label} tradeLabel={tradeLabel} />
          <section className="mt-8 rounded-xl border border-line bg-surface p-4" aria-labelledby="next-h">
            <h2 id="next-h" className="font-bold">Keep going</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {trade && <li><Link className="font-semibold text-brand hover:underline" href={`/academy/courses/${startingCourseSlug(trade)}`}>Starting a {tradeLabel?.toLowerCase()} business</Link> course in the Classroom</li>}
              <li><Link className="font-semibold text-brand hover:underline" href={`/academy/study?exam=business-law-practice${state ? `&state=${state}` : ""}`}>Business and law practice exam</Link></li>
              <li><Link className="font-semibold text-brand hover:underline" href={`/academy/codes?state=${state}${trade ? `&trade=${trade}` : ""}`}>Building codes for {label}</Link></li>
              <li><Link className="font-semibold text-brand hover:underline" href="/login">Set up Built2Bid</Link> to send your first estimate once you&apos;re licensed</li>
            </ul>
          </section>
        </>
      )}

      <p className="mt-8 text-xs text-muted">This guide is general education, not legal or tax advice. Requirements change and cities and counties add their own. Confirm with each agency before you apply or start work.</p>
    </Container>
  );
}
