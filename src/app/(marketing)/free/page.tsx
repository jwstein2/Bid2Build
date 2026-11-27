import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, FileText } from "lucide-react";
import { Container } from "@/components/ui/misc";
import { FREE_RESOURCES } from "@/lib/marketing/free-resources";
import { openGraphFor } from "@/lib/seo/open-graph";
import { site } from "@/lib/site";

const pageTitle = "Free Contractor Worksheets and Templates";
const pageDescription = "Free checklists, worksheets, templates and calculators for pricing and running construction jobs. No account needed.";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  alternates: { canonical: "/free" },
  openGraph: openGraphFor({ title: `${pageTitle} | ${site.name}`, description: pageDescription, path: "/free" }),
};

export default function FreeIndex() {
  return (
    <Container className="py-12">
      <h1 className="text-4xl font-extrabold">Free worksheets and templates</h1>
      <p className="mt-2 max-w-2xl text-ink-soft">One for each lesson on our YouTube channel. Use them online or print them. No account and no email needed.</p>
      <ul className="mt-8 grid gap-4 md:grid-cols-2">
        {FREE_RESOURCES.map((r) => (
          <li key={r.slug} className="rounded-xl border border-line bg-surface p-5 hover:border-line-strong">
            <Link href={`/free/${r.slug}`} className="flex items-center gap-2 text-lg font-bold hover:underline">
              <FileText className="h-5 w-5 text-accent-dark" aria-hidden />{r.name}
            </Link>
            <p className="mt-1 text-sm text-ink-soft">{r.description}</p>
            <Link href={`/free/${r.slug}`} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-accent-ink hover:underline">Open it <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link>
          </li>
        ))}
      </ul>
    </Container>
  );
}
