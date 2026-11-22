import Link from "next/link";
import { BadgeCheck, CircleAlert, ExternalLink, ListChecks } from "lucide-react";
import { Badge } from "@/components/ui/misc";
import type { Guide, GuideFact } from "@/lib/academy/startup/guide";

const card = "rounded-xl border border-line bg-surface p-4";

function Official({ url, label = "Official page" }: { url: string | null; label?: string }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">
      {label} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
    </a>
  );
}

function FactCard({ f }: { f: GuideFact }) {
  return (
    <div className={card} data-testid="startup-fact" data-verified={f.verified ? "yes" : "no"}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="font-semibold text-ink">{f.title}</h4>
          {f.agency && <p className="text-xs text-muted">{f.agency}</p>}
        </div>
        {f.verified ? <Badge tone="ok">Verified</Badge> : <Badge tone="warn">Being confirmed</Badge>}
      </div>
      {f.when && <p className="mt-2 text-sm font-medium text-accent-ink">Applies {f.when.replace(/^if /i, "if ").replace(/^before /i, "before ")}.</p>}
      {f.verified && f.summary ? (
        <p className="mt-2 text-sm text-ink-soft">{f.summary}</p>
      ) : (
        <p className="mt-2 text-sm text-ink-soft">We&apos;re still confirming the details from the official source. Check the agency&apos;s page before you rely on it.</p>
      )}
      {f.details.length > 0 && (
        <dl className="mt-2 grid gap-1 text-sm">
          {f.details.map((d) => (
            <div key={d.label} className="flex flex-wrap gap-x-2"><dt className="font-semibold text-ink">{d.label}:</dt><dd className="text-ink-soft">{d.value}</dd></div>
          ))}
        </dl>
      )}
      <div className="mt-3"><Official url={f.url} /></div>
    </div>
  );
}

export function GuideView({ guide, stateLabel, tradeLabel }: { guide: Guide; stateLabel: string; tradeLabel: string | null }) {
  const needsCoreUnconfirmed = guide.coreUnconfirmed;
  const who = tradeLabel ? `${tradeLabel.toLowerCase()} business` : "contracting business";
  const checked = guide.checkedAt ? new Date(guide.checkedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" }) : null;
  return (
    <div className="mt-6 space-y-8" data-testid="startup-guide">
      <p className="text-sm text-muted">
        {checked && <>Checked against official government pages on {checked}. </>}
        {guide.counts.verified} {guide.counts.verified === 1 ? "fact" : "facts"} verified for {stateLabel}{guide.counts.pending ? `, ${guide.counts.pending} still being confirmed` : ""}.
      </p>

      <section aria-labelledby="first-h">
        <h2 id="first-h" className="flex items-center gap-2 text-xl font-bold"><ListChecks className="h-5 w-5 text-accent-ink" aria-hidden />Before you start: what you need first</h2>
        <p className="mt-1 text-sm text-ink-soft">These can take months (experience, exams, certificates), so check them before you spend money on a truck, tools or ads.</p>
        {guide.prerequisites.length === 0 && needsCoreUnconfirmed ? (
          <p className={`${card} mt-3 text-sm text-ink-soft`}>We haven&apos;t confirmed {stateLabel}&apos;s license requirements for this work yet. Check with the state licensing agency before you start.</p>
        ) : guide.prerequisites.length === 0 ? (
          <p className={`${card} mt-3 text-sm text-ink-soft`}>
            Based on what we&apos;ve confirmed, {stateLabel} doesn&apos;t require a state license or certificate before you start a {who}. Your city or county still may, so check step 4.
          </p>
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {guide.prerequisites.map((p) => (
              <div key={p.id} className={card} data-testid="startup-prerequisite">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-ink">{p.title}</h3>
                    {p.agency && <p className="text-xs text-muted">{p.agency}</p>}
                  </div>
                  {p.verified ? <Badge tone="ok">Verified</Badge> : <Badge tone="warn">Being confirmed</Badge>}
                </div>
                {p.when && <p className="mt-2 text-sm font-medium text-accent-ink">Needed {p.when.charAt(0).toLowerCase() + p.when.slice(1)}.</p>}
                {p.items.length > 0 ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-soft">{p.items.map((i) => <li key={i}>{i}</li>)}</ul>
                ) : (
                  <p className="mt-2 text-sm text-ink-soft">{p.verified ? "The state licenses this work. See the official page for the full requirements." : "We're still confirming the requirements from the official source."}</p>
                )}
                <div className="mt-3"><Official url={p.url} label="Requirements on the official page" /></div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="steps-h">
        <h2 id="steps-h" className="text-xl font-bold">Your steps, in order</h2>
        <ol className="mt-3 space-y-6">
          {guide.steps.filter((s) => s.facts.length > 0 || s.id === "licenses").map((s, i) => (
            <li key={s.id} id={`step-${s.id}`} className="scroll-mt-24">
              <div className="flex items-baseline gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-navy text-sm font-bold text-white">{i + 1}</span>
                <div>
                  <h3 className="text-lg font-bold text-ink">{s.title}</h3>
                  <p className="text-sm text-ink-soft">{s.intro}</p>
                </div>
              </div>
              {s.facts.length > 0 && <div className="mt-3 grid gap-3 md:grid-cols-2">{s.facts.map((f) => <FactCard key={f.id} f={f} />)}</div>}
            </li>
          ))}
        </ol>
      </section>

      {guide.noStateLicense.some((f) => f.when) && (
        <section aria-labelledby="nolicense-h">
          <h2 id="nolicense-h" className="text-lg font-bold">Not licensed by the state</h2>
          <p className="mt-1 text-sm text-ink-soft">{stateLabel} doesn&apos;t issue these statewide. Cities and counties may still require their own.</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">{guide.noStateLicense.filter((f) => f.when).map((f) => <FactCard key={f.id} f={f} />)}</div>
        </section>
      )}

      {guide.unconfirmed.length > 0 && (
        <section aria-labelledby="unconfirmed-h" className={card}>
          <h2 id="unconfirmed-h" className="flex items-center gap-2 font-bold"><CircleAlert className="h-4 w-4 text-warn" aria-hidden />Still being researched for {stateLabel}</h2>
          <p className="mt-1 text-sm text-ink-soft">We haven&apos;t confirmed these from an official source yet: {guide.unconfirmed.map((u) => u.title.toLowerCase()).join(", ")}. Check with the state licensing agency before you start.</p>
        </section>
      )}

      <p className="flex items-start gap-2 text-xs text-muted">
        <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        &quot;Verified&quot; means we found the quoted wording on the official government page when we last checked. Rules change, so confirm with the agency before you apply.
        <Link href="/academy/about" className="ml-1 underline">About the Academy</Link>
      </p>
    </div>
  );
}
