import { ExternalLink, PlayCircle, Users } from "lucide-react";
import type { Resource } from "@/lib/academy/server";

const PERMISSION: Record<string, string> = {
  link_only: "Linked with credit. Not hosted by Built2Bid.",
  licensed: "Shared with the creator's written permission.",
  original: "Built2Bid original.",
};
const fmtDate = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

/**
 * Creator attribution card for a curated resource. Videos whose owners allow embedding play through YouTube's
 * privacy-enhanced embed after a click (nothing loads from YouTube until then); everything else links out.
 */
export function ResourceCard({ r, embed = false, compact = false }: { r: Resource; embed?: boolean; compact?: boolean }) {
  const isSkool = r.kind === "skool_community" || r.kind === "skool_course";
  const action = r.kind === "skool_course" ? "View Original Course on Skool" : r.kind === "skool_community" ? "Explore Creator's Community" : r.kind === "youtube" || r.kind === "official" ? "Watch on YouTube" : "Open original";
  return (
    <article className="overflow-hidden rounded-xl border border-line bg-surface shadow-card" data-testid="resource-card" data-kind={r.kind}>
      {embed && r.embed_id && r.embed_allowed && (
        <details className="group">
          <summary className="relative block cursor-pointer list-none [&::-webkit-details-marker]:hidden" aria-label={`Play video: ${r.title}`}>
            {r.thumbnail_url && (
              // eslint-disable-next-line @next/next/no-img-element -- YouTube-hosted thumbnail of an embeddable video
              <img src={r.thumbnail_url} alt="" className="aspect-video w-full object-cover group-open:hidden" loading="lazy" />
            )}
            <span className="absolute inset-0 grid place-items-center bg-black/25 group-open:hidden"><PlayCircle className="h-14 w-14 text-white drop-shadow" aria-hidden /></span>
            <span className="hidden px-4 pt-3 text-xs font-semibold text-muted group-open:block">Close video</span>
          </summary>
          <div className="aspect-video w-full">
            <iframe className="h-full w-full" src={`https://www.youtube-nocookie.com/embed/${r.embed_id}`} title={r.title} loading="lazy"
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen />
          </div>
        </details>
      )}
      <div className="p-4">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">
          {isSkool ? <Users className="h-3.5 w-3.5" aria-hidden /> : <PlayCircle className="h-3.5 w-3.5" aria-hidden />} {r.platform ?? "External"}{r.kind === "official" ? " · Official source" : ""}
        </p>
        <h4 className="mt-1 font-semibold leading-snug">{r.title}</h4>
        <p className="mt-1 text-sm text-ink-soft">
          Created by{" "}
          {r.creator_url ? <a href={r.creator_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-ink underline-offset-2 hover:underline">{r.creator_name}</a> : <b className="text-ink">{r.creator_name}</b>}
          {r.community_name && r.community_name !== r.title ? <> · Community: <b className="text-ink">{r.community_name}</b></> : null}
        </p>
        {r.note && <p className="mt-2 text-sm"><span className="font-semibold">Why it&apos;s here: </span>{r.note}</p>}
        {!compact && r.summary && <p className="mt-2 text-sm text-ink-soft"><span className="font-semibold text-ink">Built2Bid summary: </span>{r.summary}</p>}
        {!compact && r.why_it_matters && <p className="mt-1 text-sm text-ink-soft"><span className="font-semibold text-ink">Why it matters: </span>{r.why_it_matters}</p>}
        {!compact && r.takeaways.length > 0 && <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-ink-soft">{r.takeaways.map((t) => <li key={t}>{t}</li>)}</ul>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a href={r.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-sm font-semibold hover:border-brand/50 hover:bg-paper" data-testid="resource-source">
            {action} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
          {r.kind === "skool_course" && r.community_name && <span className="text-xs text-muted">by {r.community_name}</span>}
        </div>
        <p className="mt-3 text-[11px] text-muted">
          {PERMISSION[r.permission_status] ?? ""}{r.access_note ? ` ${r.access_note}` : ""}
          {r.views_at_verification ? ` · ${r.views_at_verification.toLocaleString("en-US")} views` : ""}
          {r.verified_at ? ` · Verified ${fmtDate(r.verified_at)}` : ""}
          {r.embed_id && !r.embed_allowed ? " · The creator doesn't allow embedding, so it opens on YouTube." : ""}
        </p>
      </div>
    </article>
  );
}
