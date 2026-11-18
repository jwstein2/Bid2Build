import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import { BriefcaseBusiness, CalendarRange, Check, Clock, Gem, TrendingUp } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  PILLARS, PM_PRODUCT_NAME, PRICES, featureStatus, featuresFor, pmMarketedLive, tierBadge,
  type MarketingFeature, type Pillar,
} from "@/lib/marketing/catalog";
import pipelineShot from "@/assets/marketing/pipeline.webp";
import timelineShot from "@/assets/marketing/timeline.webp";
import updateShot from "@/assets/marketing/customer-update.webp";

export const PILLAR_ORDER: Pillar[] = ["win", "run", "grow"];
export const PILLAR_ANCHOR: Record<Pillar, string> = { win: "win-the-job", run: "run-the-job", grow: "grow-the-business" };
export const PILLAR_ICON = { win: BriefcaseBusiness, run: CalendarRange, grow: TrendingUp } as const;

const SHOTS: Record<Pillar, { src: StaticImageData; alt: string; tall?: boolean }> = {
  win: { src: pipelineShot, alt: "Built2Bid sales pipeline: bids in Draft, Ready to Send, Sent, Awaiting Signature and Approved columns, with an e-signed bid ready for Schedule Now." },
  run: { src: timelineShot, alt: "Project Command Center timeline: four jobs on a Gantt chart with tasks assigned to crews and subcontractors and a line for today." },
  grow: { src: updateShot, alt: "A customer progress update on a phone: overall progress based on work completed, forecast completion date, and a timeline of completed, current and upcoming work.", tall: true },
};

const TONE = {
  core: "border-ok/30 bg-ok-tint text-ok",
  premium: "border-navy/20 bg-navy/5 text-navy",
  soon: "border-dashed border-line bg-transparent text-muted",
} as const;

function FeatureBadge({ f }: { f: MarketingFeature }) {
  const b = tierBadge(f);
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold", TONE[b.tone])} data-status={b.tone}>
      {b.tone === "premium" && <Gem className="h-3 w-3" aria-hidden />}
      {b.tone === "soon" && <Clock className="h-3 w-3" aria-hidden />}
      {b.label}
    </span>
  );
}

/** One pillar: what it is, its features with plan badges, and a real screen from the app. */
function PillarBlock({ pillar, flip }: { pillar: Pillar; flip: boolean }) {
  const p = PILLARS[pillar];
  const Icon = PILLAR_ICON[pillar];
  const pmLive = pmMarketedLive();
  // V8: the homepage lists only what customers can use today. Coming-soon items stay on the pricing
  // comparison. Exception: while Project Command Center is off, its pillar keeps the preview list.
  const list = featuresFor(pillar, { homeOnly: true }).filter((f) => featureStatus(f) === "live" || (pillar === "run" && !pmLive));
  const shot = SHOTS[pillar];
  return (
    <article id={PILLAR_ANCHOR[pillar]} aria-labelledby={`${PILLAR_ANCHOR[pillar]}-h`} className={cn("scroll-mt-20 rounded-2xl border p-5 sm:p-8", pillar === "run" ? "border-accent-ink/40 bg-surface shadow-card ring-1 ring-accent/30" : "border-line bg-surface")} data-pillar={pillar}>
      <div className={cn("grid items-center gap-8 lg:grid-cols-2 lg:gap-12", flip && "lg:[&>*:first-child]:order-2")}>
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-accent-ink">
            <Icon className="h-4 w-4" aria-hidden /> {p.kicker}
          </p>
          <h3 id={`${PILLAR_ANCHOR[pillar]}-h`} className="mt-2 text-3xl font-extrabold text-navy">{p.title}</h3>
          <p className="mt-3 text-lg text-ink-soft">{p.lead}</p>
          {pillar === "run" && (
            <p className="mt-3 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" data-testid="pm-price-note">
              {pmLive
                ? <>Add-on for Unlimited: <b>{PRICES.pmMonthly}/month</b> or <b>{PRICES.pmAnnual}/year</b>. Enterprise includes {PRICES.pmIncludedEnterpriseEditors} schedule editor.</>
                : <>{PM_PRODUCT_NAME} is coming soon as an add-on for Unlimited.</>}
            </p>
          )}
          <ul className="mt-5 space-y-3">
            {list.map((f) => (
              <li key={f.id} className="flex gap-3" data-feature-id={f.id}>
                <Check className={cn("mt-0.5 h-5 w-5 shrink-0", featureStatus(f) === "live" ? "text-ok" : "text-muted")} aria-hidden />
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-ink">{f.name} <FeatureBadge f={f} /></p>
                  <p className="mt-0.5 text-sm text-ink-soft">{f.description}</p>
                </div>
              </li>
            ))}
          </ul>
          {pillar === "run" && pmLive && (
            <Link href="/pricing#project-command-center" className="mt-5 inline-flex min-h-11 items-center font-semibold text-accent-ink underline-offset-4 hover:underline" data-cta="pm-explore">See {PM_PRODUCT_NAME} pricing</Link>
          )}
          {pillar === "grow" && (
            <p className="mt-5 text-sm text-ink-soft">Progress updates use the status and percent complete your team records. Built2Bid never marks work complete on its own.</p>
          )}
        </div>
        <figure className={cn("min-w-0", shot.tall && "mx-auto w-full max-w-xs")}>
          <div className={cn("overflow-hidden rounded-xl border border-line bg-white shadow-card", shot.tall && "max-h-[520px]")}>
            <Image src={shot.src} alt={shot.alt} sizes={shot.tall ? "320px" : "(min-width: 1024px) 560px, 100vw"} className="h-auto w-full" placeholder="blur" />
          </div>
          <figcaption className="mt-2 text-center text-xs text-muted">Real Built2Bid screen with sample data.</figcaption>
        </figure>
      </div>
    </article>
  );
}

export function PillarSections() {
  return (
    <div className="space-y-8">
      {PILLAR_ORDER.map((p, i) => <PillarBlock key={p} pillar={p} flip={i % 2 === 1} />)}
    </div>
  );
}
