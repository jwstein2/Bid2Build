import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Container } from "@/components/ui/misc";
import { Disclaimer, StatusBadge, fmtDate } from "@/components/academy/kb/parts";
import { coverageFor, kbAccess, resolveLocation, verifiedStates } from "@/lib/academy/kb/server";
import { KB_STATES, locationQuery, stateName } from "@/lib/academy/kb/location";

export const metadata: Metadata = { title: "Code Library Coverage", robots: { index: false, follow: false } };

export default async function CoveragePage({ searchParams }: PageProps<"/academy/codes/coverage">) {
  const access = await kbAccess();
  if (!access.enabled && !access.staff) notFound();
  const loc = await resolveLocation(await searchParams);
  const [states, federal, mine] = await Promise.all([verifiedStates(), coverageFor(null), loc.state ? coverageFor(loc.state) : Promise.resolve(null)]);
  const covered = KB_STATES.filter((s) => states.has(s.code));
  return (
    <Container className="max-w-4xl py-8">
      <Link href={`/academy/codes${locationQuery(loc)}`} className="inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" aria-hidden />Code search</Link>
      <h1 className="mt-3 font-display text-2xl font-extrabold">What&apos;s covered</h1>
      <p className="mt-1 text-ink-soft">We add a state only after its adopted codes, editions and effective dates are checked against official sources. Until then, a state shows federal rules only and says so.</p>

      <section className="mt-6">
        <h2 className="text-lg font-bold">States with verified building code adoptions ({covered.length} of {KB_STATES.length})</h2>
        {covered.length ? (
          <ul className="mt-2 flex flex-wrap gap-2">{covered.map((s) => <li key={s.code}><Link href={`/academy/codes/coverage${locationQuery({ ...loc, state: s.code, local: null, zip: null })}`} className="inline-block rounded-full bg-ok-tint px-3 py-1 text-sm font-semibold text-ok">{s.name}</Link></li>)}</ul>
        ) : <p className="mt-2 text-sm text-ink-soft">None yet.</p>}
        <p className="mt-2 text-xs text-muted">Every other state and DC: awaiting verification. Federal OSHA, EPA and DOT rules apply everywhere (State Plan states are marked).</p>
      </section>

      {mine && (
        <section className="mt-6">
          <h2 className="text-lg font-bold">{stateName(mine.state)}</h2>
          <CoverageTable rows={mine.families} empty="Nothing verified for this state yet." />
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-lg font-bold">Federal</h2>
        <CoverageTable rows={federal.families} empty="Nothing on file yet." />
      </section>
      <Disclaimer className="mt-8" />
    </Container>
  );
}

function CoverageTable({ rows, empty }: { rows: Awaited<ReturnType<typeof coverageFor>>["families"]; empty: string }) {
  if (!rows.length) return <p className="mt-2 text-sm text-ink-soft">{empty}</p>;
  return (
    <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-surface">
      {rows.map((f) => (
        <li key={`${f.authority}-${f.edition}`} className="p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{f.name}</span><StatusBadge status={f.status} /></div>
          <p className="text-xs text-ink-soft">{f.edition} · {f.authority}{f.effective_date ? ` · effective ${fmtDate(f.effective_date)}` : ""}{f.expiration_date ? ` · until ${fmtDate(f.expiration_date)}` : ""}</p>
          {f.local_confirmation_required && <p className="text-xs text-muted">Local adoption or enforcement can differ. Confirm with your city or county.</p>}
        </li>
      ))}
    </ul>
  );
}
