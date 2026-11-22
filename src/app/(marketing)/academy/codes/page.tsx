import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Container, Notice } from "@/components/ui/misc";
import { Disclaimer, LocalCard, ReportProblem, ResultCard, fmtDate } from "@/components/academy/kb/parts";
import { LocationForm } from "@/components/academy/kb/location-form";
import { trades } from "@/lib/trades/catalog";
import { coverageFor, type CoverageFamily, kbAccess, listFamilies, localAuthority, resolveLocation, searchKb } from "@/lib/academy/kb/server";
import { KB_STATES, locationQuery, stateForZip, stateName } from "@/lib/academy/kb/location";
import { CATEGORY_LABEL, CATEGORY_ORDER, GROUP_LABEL, groupResults, leadCategory, pickAnswer, searchOutcome, type CodeCategory } from "@/lib/academy/kb/answer";
import { examplesFor } from "@/lib/academy/kb/examples";
import { SearchBox } from "@/components/academy/kb/search-box";
import { KB_UNVERIFIED } from "@/lib/academy/kb/types";
import { saveLocation } from "./actions";

export const metadata: Metadata = {
  title: "Construction Code Search",
  description: "Search verified construction code citations by state and trade, with the edition, effective date, official source and last verified date.",
  robots: { index: false, follow: false },
};

const input = "w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm";
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
  const section = one("section") || null;
  const history = one("history") === "1";
  const loc = await resolveLocation(sp);
  const [families, localInfo, coverage] = await Promise.all([listFamilies(), localAuthority(loc.local), coverageFor(loc.state)]);
  const search = q || section ? await searchKb({ q, state: loc.state, local: loc.local, trade: loc.trade, family, section, history }) : null;
  const outcome = searchOutcome(search);
  const answer = search ? pickAnswer(search.results) : null;
  const rest = search ? search.results.filter((r) => r.section_id !== answer?.section_id) : [];
  const groups = groupResults(rest);
  const returnTo = `/academy/codes${locationQuery(loc, { q: q || null, family, history: history ? "1" : null })}`;
  const zipState = stateForZip(loc.zip);
  const reported = one("reported");
  const stateLabel = stateName(loc.state);
  const stateCodes = coverage.families;
  const hasStateText = stateCodes.some((f) => f.searchable_sections > 0 && f.category !== "safety" && f.category !== "other");
  const examples = examplesFor(loc.trade, hasStateText);
  const topic = search ? leadCategory(search.results) : null;
  const topicCodes = topic && topic !== "safety" ? stateCodes.filter((f) => f.category === topic) : [];
  const hidden = { zip: loc.zip, state: loc.state, local: loc.local, trade: loc.trade };

  return (
    <Container className="py-8">
      {!access.migrated && <Notice tone="warn" title="Code library is being set up">Staff preview: the knowledge-engine SQL has not been applied yet, so there is nothing to search.</Notice>}
      {access.migrated && !access.enabled && <Notice tone="neutral" title="Staff preview">Only Academy staff can see this page. Turn it on for everyone in Manage → Codes.</Notice>}
      {reported === "1" && <Notice tone="ok" title="Thanks. Your report was sent to the reviewers.">Nothing changes until an Academy reviewer checks it against the official source.</Notice>}
      {reported === "limit" && <Notice tone="neutral" title="You've sent a lot of reports today">Please try again tomorrow.</Notice>}

      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold">Codes &amp; Regulations</h1>
          <p className="mt-1 max-w-2xl text-ink-soft">Find the codes that apply to your project, with the source, edition and when we last checked it.</p>
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
        ].filter(Boolean).join(" ")}
      />
      {loc.local && <LocalCard id={loc.local} info={localInfo} state={loc.state} />}

      <SearchBox key={`${q}|${section ?? ""}`} q={q} hidden={hidden}>
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-semibold text-muted">Advanced filters</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-semibold text-muted">Code family
              <select name="family" defaultValue={family ?? ""} className={`mt-1 ${input}`}>
                <option value="">All</option>
                {families.map((f) => <option key={f.slug} value={f.slug}>{f.short}: {f.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-muted">Exact section
              <input name="section" defaultValue={section ?? ""} maxLength={60} placeholder="R311.7.5.1" className={`mt-1 ${input}`} />
            </label>
            <label className="mt-5 flex items-center gap-2 text-sm"><input type="checkbox" name="history" value="1" defaultChecked={history} /> Include older editions</label>
          </div>
        </details>
      </SearchBox>

      {outcome === "idle" && (
        <section className="mt-5" data-testid="kb-start">
          <p className="font-semibold">Search construction codes by topic, trade, or code section.</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {examples.map((e) => <li key={e}><Link href={`/academy/codes${locationQuery(loc, { q: e })}`} className="inline-block min-h-10 rounded-full border border-line bg-surface px-3 py-2 text-sm hover:border-line-strong">{e}</Link></li>)}
          </ul>
        </section>
      )}

      <section className="mt-6" aria-live="polite">
        {outcome === "error" && (
          <div className="rounded-xl border border-line bg-surface p-4" data-testid="kb-error">
            <p className="font-semibold">Code search didn&apos;t respond.</p>
            <p className="mt-1 text-sm text-ink-soft">This is on our side, not your question. <Link href={returnTo} className="font-semibold text-brand hover:underline">Try again</Link></p>
          </div>
        )}

        {outcome === "no_match" && (
          <div className="rounded-xl border border-line bg-surface p-4" data-testid="kb-no-match">
            <p className="font-semibold">No match in the sources we can search yet.</p>
            <p className="mt-1 text-sm text-ink-soft">Try different words or a section number, or use the official codes listed below.</p>
          </div>
        )}

        {outcome === "answer" && answer && (
          <div data-testid="kb-answer">
            <h2 className="text-sm font-bold tracking-wide text-muted uppercase">Quick answer</h2>
            <ul className="mt-2"><ResultCard r={answer} returnTo={returnTo} state={loc.state} strong staff={access.staff} /></ul>
          </div>
        )}

        {outcome === "reference" && (
          <div className="rounded-xl border border-line bg-surface p-4" data-testid="kb-reference">
            <p className="font-semibold">We can&apos;t give a verified answer to this yet.</p>
            <p className="mt-1 text-sm text-ink-soft" data-testid="kb-unverified">{KB_UNVERIFIED}</p>
            {loc.state && topicCodes.length > 0 && (
              <div className="mt-3">
                <p className="text-sm font-semibold">{CATEGORY_LABEL[topic as CodeCategory]} code in force in {stateLabel}</p>
                <ul className="mt-1 grid gap-2 sm:grid-cols-2">{topicCodes.map((f) => <CodeRow key={`${f.family}-${f.edition}-${f.name}`} f={f} q={q} loc={loc} compact />)}</ul>
                {!loc.local && <p className="mt-2 text-xs text-muted">Statewide code references are available. Confirm your local jurisdiction to check for additional requirements or amendments.</p>}
              </div>
            )}
            {!loc.state && <p className="mt-2 text-xs text-muted">Pick a state above to see which code is in force there.</p>}
          </div>
        )}

        {search?.ok && search.suggestions.length > 0 && (
          <div className="mt-4 rounded-lg border border-line bg-surface p-3 text-sm">
            <p className="font-semibold">Related searches</p>
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

        {search?.ok && groups.map((g) => (
          <div key={g.group} className="mt-6">
            <h2 className="text-lg font-bold">{GROUP_LABEL[g.group].title}</h2>
            <p className="text-xs text-muted">{GROUP_LABEL[g.group].note}</p>
            <ul className="mt-3 grid gap-3 lg:grid-cols-2">{g.items.map((r) => <ResultCard key={r.section_id} r={r} returnTo={returnTo} state={loc.state} staff={access.staff} />)}</ul>
          </div>
        ))}
        {search?.ok && <div className="mt-4"><ReportProblem targetType="search" targetId={q.slice(0, 120) || "search"} returnTo={returnTo} state={loc.state} /></div>}
      </section>

      <AvailableCodes codes={stateCodes} stateLabel={stateLabel} loc={loc} note={coverage.note ?? null} />

      <section className="mt-8 rounded-xl border border-line bg-surface p-4 text-sm">
        <p className="font-semibold">Learn it</p>
        <p className="mt-1 text-ink-soft"><Link href="/academy/study" className="font-semibold text-brand hover:underline">Flashcards, quizzes and practice exams</Link> on jobsite safety, codebook navigation{loc.state === "MN" ? ", Minnesota permits and the Minnesota Residential Code" : ""} and running a contracting business.</p>
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold text-muted">How answers work</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-soft">
            <li>Answers come only from official sources we have checked. We never make up code text, section numbers, page numbers or dates.</li>
            <li>Copyrighted model codes (like the IRC and IBC) are cited by section and linked to the official copy. We don&apos;t reproduce them.</li>
            <li>A statewide result is not a full local compliance check. Your city, township or county can add requirements.</li>
          </ul>
        </details>
      </section>

      <Disclaimer className="mt-8" />
    </Container>
  );
}

function CodeRow({ f, q, loc, compact }: { f: CoverageFamily; q?: string; loc: Parameters<typeof locationQuery>[0]; compact?: boolean }) {
  const searchable = f.searchable_sections > 0;
  return (
    <li className="rounded-lg border border-line bg-surface p-3 text-sm" data-testid="kb-code-row">
      <p className="font-semibold">{f.name}</p>
      <p className="text-xs text-ink-soft">{f.edition}{f.effective_date ? ` · in effect ${fmtDate(f.effective_date)}` : ""}</p>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className={searchable ? "font-semibold text-ok" : "text-muted"}>{f.status !== "verified" ? "Under review" : searchable ? "Searchable here" : "Official reference available"}</span>
        {f.official_url && <a href={f.official_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-brand hover:underline">Official source<ExternalLink className="h-3 w-3" aria-hidden /></a>}
        {searchable && !compact && <Link href={`/academy/codes${locationQuery(loc, { q: q || null, family: f.family })}`} className="font-semibold text-brand hover:underline">Search this code</Link>}
      </p>
    </li>
  );
}

function AvailableCodes({ codes, stateLabel, loc, note }: { codes: CoverageFamily[]; stateLabel: string | null; loc: Parameters<typeof locationQuery>[0]; note: string | null }) {
  const byCat = CATEGORY_ORDER.map((c) => ({ c, items: codes.filter((f) => f.category === c) })).filter((x) => x.items.length);
  const missing = stateLabel ? CATEGORY_ORDER.filter((c) => !["safety", "other", "green", "existing"].includes(c) && !codes.some((f) => f.category === c)) : [];
  return (
    <section className="mt-10" aria-labelledby="kb-available" data-testid="kb-available">
      <h2 id="kb-available" className="text-lg font-bold">{stateLabel ? `Available ${stateLabel} codes` : "Federal rules on file"}</h2>
      {note && <p className="mt-1 max-w-3xl text-xs text-ink-soft">{note}</p>}
      {byCat.length ? (
        <div className="mt-3 grid gap-4">
          {byCat.map(({ c, items }) => (
            <div key={c}>
              <h3 className="text-xs font-bold tracking-wide text-muted uppercase">{CATEGORY_LABEL[c]}</h3>
              <ul className="mt-1 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{items.map((f) => <CodeRow key={`${f.family}-${f.edition}-${f.name}-${f.authority}`} f={f} loc={loc} />)}</ul>
            </div>
          ))}
        </div>
      ) : <p className="mt-2 text-sm text-ink-soft">{stateLabel ? `No ${stateLabel} codes are on file yet. Federal rules still show in search.` : "Pick a state to see its codes."}</p>}
      {missing.length > 0 && <p className="mt-3 text-xs text-muted">More sources being verified{missing.length < 6 ? ` (${missing.map((c) => CATEGORY_LABEL[c].toLowerCase()).join(", ")})` : ""}. Some states leave these codes to cities and counties.</p>}
    </section>
  );
}
