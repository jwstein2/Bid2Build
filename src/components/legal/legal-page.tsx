import type { ReactNode } from "react";
import { Container } from "@/components/ui/misc";

/** Shared layout for the public legal pages (Terms, Privacy, cookie policy, program terms). */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <Container className="py-12">
      <article className="mx-auto max-w-2xl space-y-4 leading-relaxed text-ink-soft">
        <h1 className="text-4xl font-extrabold text-ink">{title}</h1>
        <p className="text-sm text-muted">Last updated {updated}</p>
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
