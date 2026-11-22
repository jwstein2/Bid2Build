import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui/misc";
import { Disclaimer, fmtDate } from "@/components/academy/kb/parts";
import { OpenHash } from "@/components/academy/kb/open-hash";
import { kbAccess, verifiedFederal } from "@/lib/academy/kb/server";
import { CODEBOOK, findPart, partKey } from "@/lib/academy/kb/codebook";
import { PartTree } from "@/components/academy/kb/codebook-tree";

export const metadata: Metadata = {
  title: "Browse the Codebook",
  description: "Browse federal construction safety, lead-safe renovation and DOT rules by title, part, subpart and section, with links to the official text.",
  robots: { index: false, follow: false },
};

/**
 * Codebook-style navigation of the contractor-relevant federal regulations (official eCFR hierarchy). Sections we
 * hold as verified text link to the Built2Bid section page; every section links to the official eCFR page.
 * State and model building codes are listed on the Codes page by state (copyrighted model codes are links only).
 */
export default async function BrowsePage({ searchParams }: PageProps<"/academy/codes/browse">) {
  const sp = await searchParams;
  const access = await kbAccess();
  if (!access.enabled && !access.staff) notFound();
  const key = typeof sp.part === "string" ? sp.part : null;
  const part = findPart(key);
  const verified = await verifiedFederal();

  return (
    <Container className="py-8">
      <nav className="text-sm text-ink-soft" aria-label="Breadcrumb">
        <Link href="/academy/codes" className="font-semibold text-brand hover:underline">Codes &amp; Regulations</Link>
        {" › "}<Link href="/academy/codes/browse" className={part ? "font-semibold text-brand hover:underline" : ""}>Browse the codebook</Link>
        {part && <>{" › "}{part.title} CFR Part {part.part}</>}
      </nav>
      <h1 className="mt-2 font-display text-3xl font-extrabold">{part ? `${part.title} CFR Part ${part.part}` : "Browse the codebook"}</h1>
      <p className="mt-1 max-w-2xl text-ink-soft">
        {part ? part.why : "Federal rules contractors run into most, laid out the way the official Code of Federal Regulations is: title, part, subpart, section."}
      </p>

      {!part && (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2" data-testid="cb-parts">
          {CODEBOOK.parts.map((p) => (
            <li key={partKey(p)}>
              <Link href={`/academy/codes/browse?part=${partKey(p)}`} className="block h-full rounded-xl border border-line bg-surface p-4 hover:border-line-strong" data-testid="cb-part">
                <span className="text-xs text-muted">{p.path.map((x) => x.label.trim()).join(" › ")}</span>
                <span className="mt-1 block font-semibold">{p.title} CFR Part {p.part}: {p.node.desc}</span>
                <span className="mt-1 block text-sm text-ink-soft">{p.why}</span>
                <span className="mt-2 block text-xs text-muted">Current as of {fmtDate(p.as_of)}{p.last_amended ? ` · last amended ${fmtDate(p.last_amended)}` : ""}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {part && <><PartTree part={part} verified={verified} /><OpenHash /></>}

      <section className="mt-8 rounded-xl border border-line bg-surface p-4 text-sm text-ink-soft">
        <p className="font-semibold text-ink">About this codebook</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Headings come from the official eCFR (snapshot {fmtDate(CODEBOOK.generated)}); the official page always has the current text.</li>
          <li>&quot;Verified text on Built2Bid&quot; means we hold that section&apos;s text and checked it against the official source.</li>
          <li>Building codes (IRC, IBC, NEC and state codes) depend on your state and are listed on the <Link href="/academy/codes" className="font-semibold text-brand hover:underline">Codes page</Link>. Copyrighted model codes are cited and linked, not reproduced.</li>
          <li>OSHA rules protect workers on the job. They don&apos;t set building code requirements for the finished work.</li>
        </ul>
      </section>
      <Disclaimer className="mt-6" />
    </Container>
  );
}
