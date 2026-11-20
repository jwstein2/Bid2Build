import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui/misc";
import { LegalStatusBadge } from "@/components/legal/legal-status";
import { LEGAL_CATEGORY_LABELS, LEGAL_DOCUMENTS, PRIMARY_STATUS_LINE, REVIEW_DISCLOSURE, legalDate, type LegalCategory } from "@/lib/legal/registry";
import { getLegalStatuses } from "@/lib/legal/status.server";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Legal Document Status",
  description: "The current published versions of Built2Bid's terms, policies and disclosures, and their legal review status.",
  alternates: { canonical: "/legal" },
};

const ORDER: LegalCategory[] = ["core", "program", "disclosure", "in_product"];

/**
 * Central explanation of legal-document status (footer link "Legal Document Status"). Lists every current
 * published document from the registry with its version, dates and public status. No internal notes.
 */
export default async function LegalStatusPage() {
  const statuses = await getLegalStatuses();
  return (
    <Container className="py-12">
      <article className="mx-auto max-w-3xl space-y-6 leading-relaxed text-ink-soft">
        <div>
          <h1 className="text-4xl font-extrabold text-ink">Legal Document Status</h1>
          <p className="mt-2 font-semibold text-ink">{PRIMARY_STATUS_LINE}</p>
        </div>
        <section aria-labelledby="about-status" className="space-y-2 rounded-lg border border-line bg-surface px-4 py-4 text-sm">
          <h2 id="about-status" className="text-base font-bold text-ink">About these documents</h2>
          {REVIEW_DISCLOSURE.map((p) => <p key={p}>{p}</p>)}
          <p>The terms and policies below are in effect as published. Showing a review status doesn&apos;t change them, and it doesn&apos;t change any agreement you&apos;ve already made with us. Questions: <a className="underline" href={`mailto:${site.supportEmail}`}>{site.supportEmail}</a>.</p>
        </section>

        {ORDER.map((cat) => {
          const docs = LEGAL_DOCUMENTS.filter((d) => d.category === cat);
          if (!docs.length) return null;
          return (
            <section key={cat} aria-labelledby={`cat-${cat}`} className="space-y-3">
              <h2 id={`cat-${cat}`} className="text-xl font-bold text-ink">{LEGAL_CATEGORY_LABELS[cat]}</h2>
              <ul className="space-y-3">
                {docs.map((d) => {
                  const rec = statuses[d.key];
                  return (
                    <li key={d.key} className="rounded-lg border border-line bg-surface p-4" data-testid={`legal-doc-${d.key}`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <h3 className="font-bold text-ink">
                          {d.public ? <Link href={d.href} className="underline">{d.name}</Link> : d.name}
                        </h3>
                        <LegalStatusBadge record={rec} />
                      </div>
                      <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                        <div><dt className="inline font-semibold text-ink">Version: </dt><dd className="inline">{d.version}</dd></div>
                        <div><dt className="inline font-semibold text-ink">Last revised: </dt><dd className="inline">{legalDate(d.lastRevised)}</dd></div>
                        <div><dt className="inline font-semibold text-ink">Effective date: </dt><dd className="inline">{d.effectiveDate ? legalDate(d.effectiveDate) : "As published (no separate date stated)"}</dd></div>
                        {rec.status === "reviewed" && rec.reviewCompletedOn && <div><dt className="inline font-semibold text-ink">Legal review completed: </dt><dd className="inline">{legalDate(rec.reviewCompletedOn)}</dd></div>}
                        {d.location && <div className="sm:col-span-2"><dt className="inline font-semibold text-ink">Where it appears: </dt><dd className="inline">{d.location}</dd></div>}
                      </dl>
                      {d.history.length > 1 && (
                        <details className="mt-2 text-xs">
                          <summary className="cursor-pointer font-semibold text-ink">Version history</summary>
                          <ul className="mt-1 list-disc space-y-0.5 pl-5">
                            {d.history.map((h) => <li key={h.version}>{h.version}: {h.summary}{h.supersededOn ? ` Superseded ${legalDate(h.supersededOn)}.` : " Current."}</li>)}
                          </ul>
                        </details>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </article>
    </Container>
  );
}
