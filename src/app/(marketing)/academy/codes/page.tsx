import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Search } from "lucide-react";
import { Container, Notice } from "@/components/ui/misc";
import { Disclaimer, LocalCard, ReportProblem, ResultCard } from "@/components/academy/kb/parts";
import { LocationForm } from "@/components/academy/kb/location-form";
import { trades } from "@/lib/trades/catalog";
import { coverageFor, kbAccess, listFamilies, localAuthority, resolveLocation, searchKb } from "@/lib/academy/kb/server";
import { KB_STATES, locationQuery, stateForZip, stateName } from "@/lib/academy/kb/location";
import { GROUP_LABEL, groupResults, pickAnswer } from "@/lib/academy/kb/answer";
import { KB_UNVERIFIED } from "@/lib/academy/kb/types";
import { saveLocation } from "./actions";

export const metadata: Metadata = {
  title: "Construction Code Search",
  description: "Search verified construction code citations by state and trade, with the edition, effective date, official source and last verified date.",
  robots: { index: false, follow: false },
};

const input = "w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm";
const EXAMPLES = ["deck stair riser height", "stair headroom", "fall protection 6 feet", "electrical code edition", "trench protective system", "lead-safe renovation"];
const FROM_TEXT: Record<string, string> = {
  saved: "your saved Academy location", business: "your business address", academy_profile: "your Academy profile", none: "",
};

export default async function CodesPage({ searchParams }: PageProps<"/academy/codes">) {
  // Read the request first so the page is always rendered per request (never prerendered as a 404).
  const sp = await searchParams;
  const access = await kbAccess();
  if (!access.enabled && !access.staff) notFound();
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const q = one("q").slice(0, 300);
  const family = one("family") || null;
  const history = one("history") === "1";
  const loc = await resolveLocation(sp);
  const [families, localInfo, coverage] = await Promise.all([listFamilies(), localAuthority(loc.local), q ? Promise.resolve(null) : coverageFor(loc.state)]);
  const search = q || one("section") ? await searchKb({ q, state: loc.state, local: loc.local, trade: loc.trade, family, section: one("section") || null, history }) : null;
  const answer = search ? pickAnswer(search.results) : null;
  const rest = search ? search.results.filter((r) => r.section_id !== answer?.section_id) : [];
  const groups = groupResults(rest);
  const returnTo = `/academy/codes${locationQuery(loc, { q: q || null, family, history: history ? "1" : null })}`;
  const zipState = stateForZip(loc.zip);
  const reported = one("reported");

  return (
    <Container className="py-8">
      {!access.migrated && <Notice tone="warn" title="Code library is being set up">Staff preview: the knowledge-engine SQL has not been applied yet, so there is nothing to search.</Notice>}
      {access.migrated && !access.enabled && <Notice tone="neutral" title="Staff preview">Only Academy staff can see this page. Turn it on for everyone in Manage → Codes.</Notice>}
      {reported === "1" && <Notice tone="ok" title="Thanks. Your report was sent to the reviewers.">Nothing changes until an Academy reviewer checks it against the official source.</Notice>}
      {reported === "limit" && <Notice tone="neutral" title="You've sent a lot of reports today">Please try again tomorrow.</Notice>}

      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold">Codes &amp; Regulations</h1>
          <p className="mt-1 max-w-2xl text-ink-soft">Search verified construction code citations for your state and trade. Every answer shows its source, edition and when it was last checked. If we can&apos;t verify it, we say so.</p>
        </div>
        <div className="flex gap-4">
          <Link href="/academy/study" className="text-sm font-semibold text-brand hover:underline">Flashcards &amp; quizzes</Link>
          <Link href={`/academy/codes/coverage${locationQuery(loc)}`} className="text-sm font-semibold text-brand hover:underline">What&apos;s covered</Link>
        </div>
      </div>

      <LocationForm
        action={saveLocation}
        q={q}
        initial={{ zip: loc.zip, state: loc.state, local: loc.local, trade: loc.trade }}
        states={KB_STATES}
        trades={trades.filter((t) => t.slug !== "other").map((t) => ({ slug: t.slug, name: t.name }))}
        note={[
          loc.from !== "none" && FROM_TEXT[loc.from] ? `Started from ${FROM_TEXT[loc.from]}.` : "",
          loc.zip && zipState && zipState !== loc.state ? `ZIP ${loc.zip} is in ${stateName(zipState)}; you're researching ${stateName(loc.state) ?? "federal rules"}.` : "",
          "A ZIP code alone never decides who issues your permit.",
        ].filter(Boolean).join(" ")}
      />
      {loc.local && <LocalCard id={loc.local} info={localInfo} state={loc.state} />}

      <form action="/academy/codes" role="search" className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
        {loc.zip && <input type="hidden" name="zip" value={loc.zip} />}
        {loc.state && <input type="hidden" name="state" value={loc.state} />}
        {loc.local && <input type="hidden" name="local" value={loc.local} />}
        {loc.trade && <input type="hidden" name="trade" value={loc.trade} />}
        <div className="relative">
          <label htmlFor="kb-q" className="sr-only">Ask a code question or enter a section number</label>
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input id="kb-q" name="q" defaultValue={q} maxLength={300} placeholder="e.g. deck stair riser height, or R311.7, or 1926.501" className={`${input} py-3 pl-9 text-base`} />
        </div>
        <button type="submit" className="rounded-md bg-navy px-5 py-3 text-sm font-semibold text-white">Search</button>
        <details className="sm:col-span-2">
          <summary className="cursor-pointer text-xs font-semibold text-muted">Filters</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-semibold text-muted">Code family
              <select name="family" defaultValue={family ?? ""} className={`mt-1 ${input}`}>
                <option value="">All</option>
                {families.map((f) => <option key={f.slug} value={f.slug}>{f.short}: {f.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-muted">Exact section
              <input name="section" defaultValue={one("section")} maxLength={60} placeholder="R311.7.5.1" className={`mt-1 ${input}`} />
            </label>
            <label className="mt-5 flex items-center gap-2 text-sm"><input type="checkbox" name="history" value="1" defaultChecked={history} /> Include superseded editions</label>
          </div>
        </details>
      </form>

      {search && !search.ok && <Notice className="mt-6" tone="neutral" title="Code search is taking a break">Please try again in a few minutes.</Notice>}

      {search?.ok && (
        <section className="mt-6" aria-live="polite">
          {answer ? (
            <div data-testid="kb-answer">
              <h2 className="text-sm font-bold tracking-wide text-muted uppercase">Quick answer</h2>
              <ul className="mt-2"><ResultCard r={answer} returnTo={returnTo} state={loc.state} strong /></ul>
            </div>
          ) : (
            <Notice tone="warn" title="No verified answer" className="mt-2">
              <span data-testid="kb-unverified">{KB_UNVERIFIED}</span>
            </Notice>
          )}

          {search.suggestions.length > 0 && (
            <div className="mt-4 rounded-lg border border-line bg-surface p-3 text-sm">
              <p className="font-semibold">Related terms</p>
              <ul className="mt-1 space-y-1">
                {search.suggestions.slice(0, 4).map((s) => (
                  <li key={s.term} className="text-ink-soft">
                    <span className="font-semibold text-ink">{s.term}</span>
                    {s.related.length > 0 && <> · try {s.related.slice(0, 4).map((t, i) => <span key={t}>{i ? ", " : ""}<Link className="text-brand hover:underline" href={`/academy/codes${locationQuery(loc, { q: t })}`}>{t}</Link></span>)}</>}
                    {s.note && <span className="block text-xs text-muted">{s.note}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {groups.map((g) => (
            <div key={g.group} className="mt-6">
              <h2 className="text-lg font-bold">{GROUP_LABEL[g.group].title}</h2>
              <p className="text-xs text-muted">{GROUP_LABEL[g.group].note}</p>
              <ul className="mt-3 grid gap-3 lg:grid-cols-2">{g.items.map((r) => <ResultCard key={r.section_id} r={r} returnTo={returnTo} state={loc.state} />)}</ul>
            </div>
          ))}
          {search.results.length === 0 && <p className="mt-4 text-sm text-ink-soft">Nothing on file matches that yet. Try a section number or different words, or check <Link className="text-brand hover:underline" href={`/academy/codes/coverage${locationQuery(loc)}`}>what&apos;s covered</Link>.</p>}
          <div className="mt-4"><ReportProblem targetType="search" targetId={q.slice(0, 120) || "search"} returnTo={returnTo} state={loc.state} /></div>
        </section>
      )}

      {!search && (
        <section className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div>
            <h2 className="text-lg font-bold">Try a search</h2>
            <ul className="mt-2 flex flex-wrap gap-2">
              {EXAMPLES.map((e) => <li key={e}><Link href={`/academy/codes${locationQuery(loc, { q: e })}`} className="inline-block rounded-full border border-line bg-surface px-3 py-1.5 text-sm hover:border-line-strong">{e}</Link></li>)}
            </ul>
            <div className="mt-6 rounded-xl border border-line bg-surface p-4 text-sm text-ink-soft">
              <p className="font-semibold text-ink">How answers work</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Answers come only from official sources we have checked. We never make up code text, section numbers, page numbers or dates.</li>
                <li>Copyrighted model codes (like the IRC and IBC) are cited by section and linked to the publisher&apos;s free read-only copy. We don&apos;t reproduce them.</li>
                <li>Each result says whether it is verified for your state, or whether your local authority still needs to confirm it.</li>
              </ul>
            </div>
          </div>
          {coverage && (
            <aside className="rounded-xl border border-line bg-surface p-4">
              <h2 className="text-sm font-bold">{coverage.state ? `On file for ${stateName(coverage.state)}` : "Federal rules on file"}</h2>
              {coverage.note && <p className="mt-1 text-xs text-ink-soft">{coverage.note}</p>}
              {coverage.families.length ? (
                <ul className="mt-2 space-y-2 text-sm">
                  {coverage.families.slice(0, 10).map((f) => (
                    <li key={`${f.authority}-${f.edition}`}>
                      <span className="font-semibold">{f.name}</span> <span className="text-ink-soft">({f.edition})</span>
                      <span className="block text-xs text-muted">{f.status === "verified" ? "Verified" : "Pending review"}{f.local_confirmation_required ? " · confirm locally" : ""}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-2 text-sm text-ink-soft">Nothing verified for this state yet. Federal rules still show, and we&apos;ll tell you when state codes are added.</p>}
            </aside>
          )}
        </section>
      )}

      <Disclaimer className="mt-8" />
    </Container>
  );
}
