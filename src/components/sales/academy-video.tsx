import type { Video } from "@/lib/sales/academy";
import { MENTORS } from "@/lib/sales/academy";

/** A YouTube video played through YouTube's privacy-enhanced embed, loaded only when opened. */
export function AcademyVideo({ v }: { v: Video }) {
  const m = MENTORS[v.mentor];
  return (
    <article className="overflow-hidden rounded-xl border border-line bg-surface">
      <details className="group">
        <summary className="relative block cursor-pointer list-none [&::-webkit-details-marker]:hidden" aria-label={`Play video: ${v.title}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- YouTube-hosted thumbnail of an embeddable video */}
          <img src={`https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`} alt="" className="aspect-video w-full object-cover group-open:hidden" loading="lazy" />
          <span className="absolute inset-0 grid place-items-center bg-black/25 group-open:hidden" aria-hidden>
            <span className="grid h-14 w-14 place-items-center rounded-full bg-white/90 text-2xl text-ink">▶</span>
          </span>
          <span className="hidden px-4 pt-3 text-xs font-semibold text-muted group-open:block">Close video</span>
        </summary>
        <div className="aspect-video w-full">
          <iframe className="h-full w-full" src={`https://www.youtube-nocookie.com/embed/${v.id}`} title={v.title} loading="lazy"
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen />
        </div>
      </details>
      <div className="p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{m.name} · <a href={m.channel.url} target="_blank" rel="noopener noreferrer" className="underline">{m.channel.label}</a></p>
        <h4 className="mt-1 font-semibold leading-snug">{v.title}</h4>
        <p className="mt-1 text-sm text-ink-soft">{v.why}</p>
        <a href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm font-semibold text-brand underline">Watch on YouTube</a>
      </div>
    </article>
  );
}
