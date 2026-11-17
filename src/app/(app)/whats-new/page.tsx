import type { Metadata } from "next";
import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { FEATURES, RELEASES } from "@/lib/features/registry";
import { hasAccess } from "@/lib/features/state";
import { FEATURE_ICONS } from "@/components/features/icons";
import { FeatureTourButton, MarkNoticeSeen } from "@/components/features/tour-buttons";
import { PremiumDiamond } from "@/components/billing/premium";
import { ButtonLink, buttonClass } from "@/components/ui/button";

export const metadata: Metadata = { title: "What's New", robots: { index: false } };

const dateLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Release notes from the feature registry: released features only, with what this account can use. */
export default async function WhatsNewPage() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("library_access");
  const access = { unlimited: data === true };
  const releases = [...RELEASES].reverse().map((r) => ({ ...r, features: FEATURES.filter((f) => f.status === "released" && f.release === r.version) })).filter((r) => r.features.length);
  return (
    <div className="mx-auto max-w-3xl space-y-6" data-guide-page="whats-new">
      <MarkNoticeSeen />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold text-navy">What&apos;s New</h1>
          <p className="mt-1 text-ink-soft">New features in Built2Bid and where to find them.</p>
        </div>
        {/* Walks through the features this account can use, newest first, on this page (each card links to where the feature lives). */}
        <FeatureTourButton className={buttonClass("secondary", "sm")} label="Take the walkthrough" guide="whats-new.tour"
          ids={releases.flatMap((r) => r.features).filter((f) => hasAccess(f, access)).map((f) => f.id)} />
      </div>
      {releases.map((r, ri) => (
        <section key={r.version} data-guide={ri === 0 ? "whats-new.releases" : undefined} aria-labelledby={`rel-${r.version}`} className="rounded-2xl border border-line bg-surface p-4 sm:p-5" data-testid="release">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">{dateLabel(r.date)} · Version {r.version}</p>
          <h2 id={`rel-${r.version}`} className="mt-1 font-display text-lg font-extrabold text-navy">{r.title}</h2>
          <ul className="mt-3 divide-y divide-line">
            {r.features.map((f) => {
              const Icon = FEATURE_ICONS[f.id];
              const can = hasAccess(f, access);
              return (
                <li key={f.id} className="flex flex-wrap items-start gap-3 py-3" data-testid={`whats-new-${f.id}`}>
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent-ink"><Icon className="h-5 w-5" aria-hidden /></span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-navy">
                      {f.name}
                      {f.entitlement === "free" ? (
                        <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-semibold text-ink-soft">All plans</span>
                      ) : can ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-teal/15 px-2 py-0.5 text-[11px] font-semibold text-ink"><Check className="h-3 w-3" aria-hidden /> Included in your plan</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent-ink"><PremiumDiamond /> Unlimited</span>
                      )}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-soft">{f.description}</p>
                  </div>
                  {can ? (
                    <ButtonLink href={f.route} size="sm" variant="secondary">Open</ButtonLink>
                  ) : (
                    <ButtonLink href="/settings/billing" size="sm" variant="accent">Upgrade</ButtonLink>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
