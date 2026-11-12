import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui/misc";
import { articles } from "@/lib/learn/articles";

export const metadata: Metadata = {
  title: "Learn: Estimating and Proposal Guides",
  description: "Practical guides on markup vs. margin, writing estimates, building proposals, and handling sales tax.",
  alternates: { canonical: "/learn" },
};

export default function LearnIndex() {
  return (
    <Container className="py-12">
      <h1 className="text-4xl font-extrabold">Learn</h1>
      <p className="mt-2 max-w-2xl text-ink-soft">Straightforward guides to pricing and presenting your work.</p>
      <ul className="mt-8 grid gap-4 md:grid-cols-2">
        {articles.map((a) => (
          <li key={a.slug} className="rounded-xl border border-line bg-surface p-5 hover:border-line-strong">
            <Link href={`/learn/${a.slug}`} className="text-lg font-bold hover:underline">{a.title}</Link>
            <p className="mt-1 text-sm text-ink-soft">{a.description}</p>
          </li>
        ))}
      </ul>
    </Container>
  );
}
