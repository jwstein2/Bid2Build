import { breadcrumbLd, ldJson } from "@/lib/seo/structured-data";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Calculator } from "lucide-react";
import { Container } from "@/components/ui/misc";
import { LearnTabs } from "@/components/marketing/learn-tabs";
import { TOOLS } from "@/lib/marketing/tools";
import { openGraphFor } from "@/lib/seo/open-graph";
import { site } from "@/lib/site";

const pageTitle = "Free Contractor Calculators";
const pageDescription = "Free concrete, deck board, roofing and markup/margin calculators. Every result can be turned into a bid in one click, no account needed.";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  alternates: { canonical: "/tools" },
  openGraph: openGraphFor({ title: `${pageTitle} | ${site.name}`, description: pageDescription, path: "/tools" }),
};

export default function ToolsIndex() {
  return (
    <Container className="py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(breadcrumbLd([{ name: "Free calculators", path: "/tools" }])) }} />
      <LearnTabs current="/tools" />
      <h1 className="text-4xl font-extrabold">Free contractor calculators</h1>
      <p className="mt-2 max-w-2xl text-ink-soft">The same calculators that are built into the Built2Bid estimate builder. Work out the quantity, then send it straight into a bid. No account needed.</p>
      <ul className="mt-8 grid gap-4 md:grid-cols-2">
        {TOOLS.map((t) => (
          <li key={t.slug} className="rounded-xl border border-line bg-surface p-5 hover:border-line-strong">
            <Link href={`/tools/${t.slug}`} className="flex items-center gap-2 text-lg font-bold hover:underline">
              <Calculator className="h-5 w-5 text-accent-dark" aria-hidden />{t.name}
            </Link>
            <p className="mt-1 text-sm text-ink-soft">{t.intro}</p>
            <Link href={`/tools/${t.slug}`} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-accent-ink hover:underline">Open the calculator <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link>
          </li>
        ))}
      </ul>
    </Container>
  );
}
