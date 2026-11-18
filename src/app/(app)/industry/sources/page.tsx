import type { Metadata } from "next";
import Link from "next/link";
import { ACTIVE_SOURCES, UNAVAILABLE_SOURCES, AUTHORITY_LABEL, AUTHORITY_HELP } from "@/lib/news/sources";
import { TRADE_NEWS } from "@/lib/news/trades";
import { tradeName } from "@/lib/trades/catalog";
import { AUTHORITIES } from "@/lib/news/types";

export const metadata: Metadata = { title: "Industry news sources", robots: { index: false } };

const POLICY: Record<string, string> = {
  ai_summary: "Short summary written from the official abstract",
  structured: "Factual summary built from official data fields",
  snippet: "Headline + the publisher's own short description",
  headline: "Headline and link only",
};

/** Where Industry Intelligence comes from, what we do with each source, and how labels work. */
export default function IndustrySourcesPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-sm"><Link href="/industry" className="text-accent-ink underline-offset-4 hover:underline">Industry Intelligence</Link></p>
        <h1 className="text-3xl font-extrabold text-navy">Where the news comes from</h1>
        <p className="mt-1 text-ink-soft">Built2Bid reads free official feeds and publishers&apos; own RSS feeds once a day, then links you to the original. We never republish full articles, never scrape paywalled pages, and never present a proposal or a forum post as a change in the law.</p>
      </div>

      <section className="rounded-xl border border-line bg-surface p-4">
        <h2 className="font-display text-lg font-extrabold text-navy">Source labels</h2>
        <dl className="mt-2 grid gap-2 sm:grid-cols-2">
          {AUTHORITIES.map((a) => <div key={a}><dt className="font-semibold">{AUTHORITY_LABEL[a]}</dt><dd className="text-sm text-ink-soft">{AUTHORITY_HELP[a]}</dd></div>)}
        </dl>
        <p className="mt-3 text-sm text-ink-soft"><span className="font-semibold">Verified source</span> means the link was checked: it is on the named publisher&apos;s own website and points at the specific article, not a homepage. Dates shown are the original publication dates from the source.</p>
      </section>

      <section className="rounded-xl border border-line bg-surface p-4">
        <h2 className="font-display text-lg font-extrabold text-navy">Active sources</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase text-muted"><tr><th className="py-1 pr-3">Source</th><th className="py-1 pr-3">Type</th><th className="py-1 pr-3">What we show</th><th className="py-1">Checked</th></tr></thead>
            <tbody className="divide-y divide-line">
              {ACTIVE_SOURCES.map((s) => (
                <tr key={s.key}>
                  <td className="py-2 pr-3"><a href={s.homepage} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent-ink underline-offset-4 hover:underline">{s.name}</a><div className="text-xs text-muted">{s.owner}</div></td>
                  <td className="py-2 pr-3">{AUTHORITY_LABEL[s.authority]}</td>
                  <td className="py-2 pr-3">{POLICY[s.summaryPolicy]}</td>
                  <td className="py-2 capitalize">{s.cadence.replace("_", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-line bg-surface p-4">
        <h2 className="font-display text-lg font-extrabold text-navy">Trade associations by trade</h2>
        <p className="text-sm text-muted">Listed for reference so you know who covers your trade. Built2Bid is not a member of, partner with, or endorsed by these organizations. Where an association offers no public feed, we link to it instead of copying its site.</p>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {TRADE_NEWS.map((t) => (
            <li key={t.slug} className="text-sm"><span className="font-semibold">{tradeName(t.slug)}:</span>{" "}
              {t.associations.map((a, i) => <span key={a.name}>{i ? ", " : ""}<a href={a.url} target="_blank" rel="noopener noreferrer" className="text-accent-ink underline-offset-4 hover:underline">{a.abbr ?? a.name}</a></span>)}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-line bg-surface p-4">
        <h2 className="font-display text-lg font-extrabold text-navy">Not included (yet), and why</h2>
        <ul className="mt-2 space-y-1 text-sm">{UNAVAILABLE_SOURCES.map((u) => <li key={u.name}><span className="font-semibold">{u.name}.</span> <span className="text-ink-soft">{u.reason}</span></li>)}</ul>
      </section>

      <section id="samples" className="rounded-xl border border-warn/30 bg-warn-tint p-4">
        <h2 className="font-display text-lg font-extrabold text-navy">Sample stories</h2>
        <p className="mt-1 text-sm text-ink-soft">Sandbox and preview mode show fictional sample stories so you can see how the feed works before real news arrives. Every sample is marked <span className="font-semibold">SAMPLE · not real news</span>, its headline starts with &quot;Sample&quot;, and it links here instead of to a publisher.</p>
      </section>
    </div>
  );
}
