import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui/misc";
import { COMPARISONS } from "@/lib/marketing/comparisons";
import { openGraphFor } from "@/lib/seo/open-graph";
import { breadcrumbLd, ldJson } from "@/lib/seo/structured-data";
import { site } from "@/lib/site";

const title = `Compare ${site.name} with other contractor software`;
const description = `Side-by-side comparisons of ${site.name} and other estimating and contractor software, with sources, prices and when each one fits better.`;

export const metadata: Metadata = { title, description, alternates: { canonical: "/compare" }, openGraph: openGraphFor({ title, description, path: "/compare" }) };

export default function CompareIndex() {
  return (
    <Container className="py-12 sm:py-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(breadcrumbLd([{ name: "Compare", path: "/compare" }])) }} />
      <div className="mx-auto max-w-3xl">
        <h1 className="text-4xl font-extrabold text-navy">{title}</h1>
        <p className="mt-3 text-ink-soft">Each comparison is checked against the other company&apos;s own pages, lists its sources and date, and says plainly when the other product is the better fit.</p>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {COMPARISONS.map((c) => (
            <li key={c.slug} className="rounded-xl border border-line bg-surface p-5 hover:border-line-strong">
              <Link href={`/compare/${c.slug}`} className="text-lg font-bold text-ink hover:underline">{site.name} vs {c.name}</Link>
              <p className="mt-1 text-sm text-ink-soft">{c.them}</p>
            </li>
          ))}
        </ul>
      </div>
    </Container>
  );
}
