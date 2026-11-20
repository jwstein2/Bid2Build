import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { loadMe } from "@/lib/academy/server";
import { loadSettings } from "@/components/academy/sidebar";
import { openGraphFor } from "@/lib/seo/open-graph";
import { site } from "@/lib/site";

const title = "About the Contractor Academy";
const description = "How the Built2Bid Contractor Academy works: free trade-specific business courses, a moderated community, credited expert resources and member privacy.";
export const metadata: Metadata = { title, description, alternates: { canonical: "/academy/about" }, openGraph: openGraphFor({ title: `${title} | ${site.name}`, description, path: "/academy/about" }) };

export default async function AboutPage() {
  const [{ me }, settings] = await Promise.all([loadMe(), loadSettings()]);
  return (
    <Container className="py-8">
      <div className="max-w-3xl space-y-8">
        <header>
          <h1 className="font-display text-3xl font-extrabold">{title}</h1>
          <p className="mt-2 text-lg text-ink-soft">Learn the business, run the business, grow the business. The Academy teaches the parts of contracting that trade school doesn&apos;t: selling, estimating, managing projects, money, people and growth.</p>
        </header>
        <section>
          <h2 className="text-lg font-bold">What&apos;s free</h2>
          <p className="mt-1 text-ink-soft">Joining is free with any Built2Bid account, including the free plan. The first lessons of each course are open to everyone; the rest are free for members. Some later material may be marked Premium; it&apos;s included with Built2Bid Individual Unlimited.</p>
        </section>
        <section>
          <h2 className="text-lg font-bold">How courses are made</h2>
          <p className="mt-1 text-ink-soft">Built2Bid lessons are written by our team and reviewed before they&apos;re published. A course marked &quot;Coming soon&quot; is planned but not written yet: we show its planned lessons and link to credited resources you can use now.</p>
        </section>
        <section>
          <h2 className="text-lg font-bold">Credited creators</h2>
          <p className="mt-1 text-ink-soft">We recommend videos, communities and courses from independent creators. We link to the original, name the creator, and never copy, download or re-host their content. Videos play here only when the creator allows embedding. Summaries are our own words. Creators can ask us to change or remove a listing at <a className="font-semibold underline" href={`mailto:${site.supportEmail}`}>{site.supportEmail}</a>.</p>
        </section>
        <section>
          <h2 className="text-lg font-bold">Community rules</h2>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-ink-soft">{(settings.rules.length ? settings.rules : ["Be professional.", "Share real experience.", "No spam or cold pitches.", "Protect customer privacy.", "Rules vary by location: confirm locally."]).map((r) => <li key={r}>{r}</li>)}</ol>
        </section>
        <section>
          <h2 className="text-lg font-bold">Your privacy</h2>
          <p className="mt-1 text-ink-soft">Discussions are visible only to members and are never shown to search engines. Your company name is hidden unless you turn it on, and you can hide yourself from the directory and leaderboard at any time. Leaving the community doesn&apos;t affect your Built2Bid account.</p>
        </section>
        {!me.member && <Link href={me.signed_in ? "/academy/join" : "/login?next=/academy/join"} className={buttonClass("accent", "lg")}>Join free</Link>}
      </div>
    </Container>
  );
}
