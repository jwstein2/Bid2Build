import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Container, Notice } from "@/components/ui/misc";
import { ApplicabilityBadge, ApplicabilityNote, Disclaimer, OfficialLink, ReportProblem, StatusBadge, fmtDate } from "@/components/academy/kb/parts";
import { CopyCitation } from "@/components/academy/kb/copy-citation";
import { applicabilityFor, getSection, kbAccess, resolveLocation, trailFor } from "@/lib/academy/kb/server";
import { locationQuery, stateName } from "@/lib/academy/kb/location";
import { RIGHTS_LABEL, citationText } from "@/lib/academy/kb/types";

export const metadata: Metadata = { title: "Code Section", robots: { index: false, follow: false } };

const METHOD: Record<string, string> = { official_text: "Read in the official publication", url_check: "Official link checked", hash_check: "Official text compared", manual_review: "Reviewed by an Academy admin", research: "Staff research from the official source" };
const RESULT: Record<string, string> = { verified: "verified", unchanged: "unchanged", changed: "changed (queued for review)", unreachable: "source unreachable", rejected: "rejected", superseded: "superseded" };

export default async function SectionPage({ params, searchParams }: PageProps<"/academy/codes/section/[id]">) {
  const access = await kbAccess();
  if (!access.enabled && !access.staff) notFound();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const s = await getSection(id);
  if (!s) notFound();
  const loc = await resolveLocation(sp);
  const [a, trail, srcTrail] = await Promise.all([applicabilityFor(s.id, loc.state, loc.local), trailFor("section", s.id), trailFor("source", s.source.id)]);
  const verified = s.status === "verified" && s.body_kind !== "title_only";
  const returnTo = `/academy/codes/section/${s.id}${locationQuery(loc)}`;
  const reported = typeof sp.reported === "string" ? sp.reported : "";
  const cite = citationText({ citation: s.citation, source_short: s.source.short_title, edition: s.source.edition, page: s.page, official_url: s.official_url ?? s.source.official_url, last_verified_at: s.last_verified_at });

  return (
    <Container className="max-w-3xl py-8">
      <Link href={`/academy/codes${locationQuery(loc)}`} className="inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" aria-hidden />Code search</Link>
      {reported === "1" && <Notice className="mt-3" tone="ok" title="Thanks. Your report was sent to the reviewers." />}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ApplicabilityBadge a={a} />
        <StatusBadge status={s.status} />
        {s.amend_action && <span className="text-xs font-semibold text-brand">State amendment ({s.amend_action}{s.amends_section ? ` ${s.amends_section}` : ""})</span>}
      </div>
      <h1 className="mt-2 font-display text-2xl font-extrabold">{s.citation}: {s.title}</h1>
      {s.heading_path && <p className="mt-1 text-sm text-muted">{s.heading_path}</p>}
      <div className="mt-2"><ApplicabilityNote a={a} /></div>
      <p className="mt-1 text-xs text-muted">Applicability shown for {loc.local ?? stateName(loc.state) ?? "federal rules only (no state chosen)"}.</p>

      {verified ? (
        <>
          {s.summary && <section className="mt-5 rounded-xl border border-line bg-surface p-4"><h2 className="text-sm font-bold">In plain language</h2><p className="mt-1 text-sm">{s.summary}</p><p className="mt-2 text-xs text-muted">Staff explanation. The official text below governs.</p></section>}
          {s.body && (
            <section className="mt-4">
              <h2 className="text-sm font-bold">{s.body_kind === "full_text" ? "Official text" : s.body_kind === "excerpt" ? "Official text (excerpt)" : "Summary of the requirement"}</h2>
              <div className="mt-1 whitespace-pre-line rounded-xl border border-line bg-paper p-4 text-sm leading-relaxed">{s.body}</div>
            </section>
          )}
          {s.exceptions && <section className="mt-4"><h2 className="text-sm font-bold">Exceptions</h2><p className="mt-1 whitespace-pre-line text-sm">{s.exceptions}</p></section>}
        </>
      ) : (
        <Notice className="mt-5" tone="warn" title="Title only">The requirement text for this section has not been verified, so it isn&apos;t shown. Read it in the official source and confirm with your authority having jurisdiction.</Notice>
      )}

      <section className="mt-6 rounded-xl border border-line bg-surface p-4 text-sm">
        <h2 className="font-bold">Source</h2>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="font-semibold text-muted">Publication</dt><dd>{s.source.title}</dd>
          <dt className="font-semibold text-muted">Edition</dt><dd>{s.source.edition}</dd>
          <dt className="font-semibold text-muted">Publisher</dt><dd>{s.source.publisher}</dd>
          <dt className="font-semibold text-muted">Section</dt><dd>{s.citation}</dd>
          <dt className="font-semibold text-muted">Page</dt><dd>{s.page ?? s.source.pagination_note ?? "No page number (online publication)"}</dd>
          <dt className="font-semibold text-muted">Effective</dt><dd>{fmtDate(a?.effective_date ?? s.effective_date) ?? "Not on file"}</dd>
          <dt className="font-semibold text-muted">Last verified</dt><dd>{fmtDate(s.last_verified_at) ?? "Not verified yet"}</dd>
          <dt className="font-semibold text-muted">Rights</dt><dd>{RIGHTS_LABEL[s.source.rights] ?? s.source.rights}. {s.source.rights_note}</dd>
        </dl>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <CopyCitation text={cite} />
          <OfficialLink url={s.official_url ?? s.source.official_url} />
          {s.source.read_url && s.source.read_url !== (s.official_url ?? s.source.official_url) && <OfficialLink url={s.source.read_url} label="Free read-only copy" />}
        </div>
      </section>

      {(trail.length > 0 || srcTrail.length > 0) && (
        <section className="mt-4 text-sm">
          <h2 className="font-bold">Verification history</h2>
          <ul className="mt-2 space-y-1 text-xs text-ink-soft">
            {[...trail.map((t) => ({ ...t, what: "Section" })), ...srcTrail.map((t) => ({ ...t, what: "Publication" }))]
              .sort((x, y) => y.checked_at.localeCompare(x.checked_at)).slice(0, 8)
              .map((t, i) => <li key={i}>{fmtDate(t.checked_at)} · {t.what}: {METHOD[t.method] ?? t.method}, {RESULT[t.result] ?? t.result}{t.source_url ? <> · <a className="text-brand hover:underline" href={t.source_url} target="_blank" rel="noopener noreferrer">source</a></> : null}</li>)}
          </ul>
        </section>
      )}

      <div className="mt-4"><ReportProblem targetType="section" targetId={s.id} returnTo={returnTo} state={loc.state} /></div>
      <Disclaimer className="mt-6" />
    </Container>
  );
}
