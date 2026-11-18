import Link from "next/link";
import { BookOpen, ClipboardCheck, GraduationCap, TrendingUp } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/misc";
import { ACADEMY_TRADES } from "@/lib/academy/content/catalog";
import { SALES_ACADEMY } from "@/lib/academy/content/sales-academy";

const COLUMNS = [
  { icon: BookOpen, title: "Learn the business", body: "Free courses on selling, estimating, money and hiring, written for your trade." },
  { icon: ClipboardCheck, title: "Run the business", body: "Every lesson ends with a step to do in Built2Bid, so the habit sticks the same day." },
  { icon: TrendingUp, title: "Grow the business", body: "Ask contractors in your trade, share what works, and learn from credited experts." },
];

/** Homepage promo for the Contractor Academy. Static (no database read) so it never slows the homepage. */
export function AcademyPromo() {
  const lessons = SALES_ACADEMY.lessons?.length ?? 0;
  return (
    <section className="border-b border-line py-20" aria-labelledby="academy-promo-h" data-testid="academy-promo">
      <Container>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-center">
          <div>
            <p className="inline-flex items-center gap-2 text-sm font-bold tracking-wide text-accent-ink uppercase"><GraduationCap className="h-4 w-4" aria-hidden /> Contractor Academy</p>
            <h2 id="academy-promo-h" className="mt-2 text-3xl font-extrabold text-navy sm:text-4xl">Learn the Business. Run the Business. Grow the Business.</h2>
            <p className="mt-3 max-w-xl text-lg text-ink-soft">A free classroom and community for contractors. Start with the {lessons}-lesson Sales Academy, then open the classroom for your trade. {ACADEMY_TRADES.length} trades are covered.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <ButtonLink href="/academy/courses/contractor-sales-academy" variant="accent" size="lg">Start the Sales Academy</ButtonLink>
              <ButtonLink href="/academy/classroom" variant="secondary" size="lg">Browse by trade</ButtonLink>
            </div>
            <p className="mt-3 text-sm text-muted">Free with any Built2Bid account. <Link href="/academy/about" className="text-accent-ink underline">How the Academy works</Link></p>
          </div>
          <ul className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            {COLUMNS.map(({ icon: Icon, title, body }) => (
              <li key={title} className="rounded-xl border border-line bg-surface p-5 shadow-card">
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-navy text-cyan"><Icon className="h-5 w-5" aria-hidden /></span>
                <h3 className="mt-3 font-bold">{title}</h3>
                <p className="mt-1 text-sm text-ink-soft">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </Container>
    </section>
  );
}
