import type { ReactNode } from "react";
import { Container } from "@/components/ui/misc";
import { LegalStatusNotice } from "./legal-status";
import { legalDocument } from "@/lib/legal/registry";
import { getLegalStatus } from "@/lib/legal/status.server";

/**
 * Shared layout for the public legal pages (Terms, Privacy, cookie policy, program terms). docKey ties the
 * page to the legal document registry (src/lib/legal/registry.ts), which drives the status notice.
 * The notice never changes the page's "Last updated" date.
 */
export async function LegalPage({ title, updated, docKey, children }: { title: string; updated: string; docKey?: string; children: ReactNode }) {
  // Pages that use this layout but aren't legal documents (the /verify tool) pass no docKey and get no notice.
  const doc = docKey ? legalDocument(docKey) : undefined;
  const record = doc ? await getLegalStatus(doc.key) : null;
  return (
    <Container className="py-12">
      <article className="mx-auto max-w-2xl space-y-4 leading-relaxed text-ink-soft">
        <h1 className="text-4xl font-extrabold text-ink">{title}</h1>
        <p className="text-sm text-muted">Last updated {updated}</p>
        {record && <LegalStatusNotice record={record} version={doc?.version} />}
        {children}
      </article>
    </Container>
  );
}

export const H2 = ({ id, children }: { id?: string; children: ReactNode }) => <h2 id={id} className="scroll-mt-24 pt-2 text-xl font-bold text-ink">{children}</h2>;
export const UL = ({ children }: { children: ReactNode }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>;
export const A = ({ href, children }: { href: string; children: ReactNode }) => <a className="underline" href={href}>{children}</a>;

/** One date for every page changed in the legal update, so they stay in step. */
export const LEGAL_UPDATED = "November 19, 2026";
