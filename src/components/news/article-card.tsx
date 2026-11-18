"use client";

import Link from "next/link";
import { useState } from "react";
import { Bookmark, BookmarkCheck, ChevronDown, ChevronUp, Eye, EyeOff, ExternalLink, Landmark, MapPin, ShieldCheck, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import type { CardArticle } from "@/lib/news/format";
import { shortSummary } from "@/lib/news/format";

const AUTH_TONE = { official: "brand", industry: "neutral", local_news: "accent", community: "warn" } as const;
const AUTH_HELP = {
  official: "Government agency, published regulation or official announcement.",
  industry: "Trade association or established construction-industry publication.",
  local_news: "Established regional news organization.",
  community: "Forum or user discussion. Not verified guidance.",
} as const;

async function send(id: string, action: string) {
  const r = await fetch(`/api/news/articles/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }), keepalive: true });
  return r.ok;
}

/**
 * One article (V6.8.1 §1): verified headline, publisher, original publication date, Local/State/National,
 * trade/topic, summary (only when permitted), why it matters, and an obvious "Read original article" link
 * that opens the publisher in a new tab.
 */
export function ArticleCard({ a, variant = "full", interactive = true }: { a: CardArticle; variant?: "compact" | "full"; interactive?: boolean }) {
  const [saved, setSaved] = useState(a.saved);
  const [hidden, setHidden] = useState(false);
  const [read, setRead] = useState(a.read);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const compact = variant === "compact";
  const summary = compact ? shortSummary(a.summary) : a.summary;
  const long = !compact && (a.summary?.length ?? 0) > 320;

  const act = async (action: string, apply: () => void, undo: () => void) => {
    if (a.sample) { apply(); return; }
    setBusy(true);
    apply();
    if (!(await send(a.id, action))) undo();
    setBusy(false);
  };

  if (hidden) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-line px-4 py-3 text-sm text-muted" data-testid="news-hidden">
        <span>Hidden. You won&apos;t see this article again.</span>
        <button type="button" className="inline-flex items-center gap-1 font-semibold text-accent-ink underline-offset-4 hover:underline" onClick={() => act("unhide", () => setHidden(false), () => setHidden(true))}>
          <Undo2 className="h-4 w-4" aria-hidden />Undo
        </button>
      </div>
    );
  }

  const link = a.external ? (
    <a href={a.url} target="_blank" rel="noopener noreferrer" data-testid="news-original"
      onClick={() => { setRead(true); if (!a.sample) void send(a.id, "click"); }}
      className="inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-accent-ink underline-offset-4 hover:underline">
      Read original article<ExternalLink className="h-3.5 w-3.5" aria-hidden /><span className="sr-only"> on {a.publisher} (opens in a new tab)</span>
    </a>
  ) : (
    <Link href={a.url} data-testid="news-original" className="inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-accent-ink underline-offset-4 hover:underline">
      About sample stories
    </Link>
  );

  return (
    <article className={cn("rounded-xl border border-line bg-surface", compact ? "p-3" : "p-4 sm:p-5", read && !compact && "opacity-90")} data-testid="news-card" data-article-id={a.id} aria-labelledby={`h-${a.id}`}>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {a.sample && <Badge tone="warn">SAMPLE · not real news</Badge>}
        <Badge tone={a.geoLabel.startsWith("Local") ? "accent" : a.geoLabel.startsWith("State") ? "ok" : "neutral"}><MapPin className="h-3 w-3" aria-hidden />{a.geoLabel}</Badge>
        {a.tradeLabel && <Badge>{a.tradeLabel}</Badge>}
        {a.topicLabel && !compact && <Badge>{a.topicLabel}</Badge>}
        <span title={AUTH_HELP[a.authority]}><Badge tone={AUTH_TONE[a.authority]}>{a.authority === "official" ? <Landmark className="h-3 w-3" aria-hidden /> : null}{a.authorityLabel}</Badge></span>
        {!compact && (a.typeLabel === "Proposed rule" || a.typeLabel === "Final rule" || a.typeLabel === "Disaster declaration") && <Badge tone={a.typeLabel === "Proposed rule" ? "warn" : "brand"}>{a.typeLabel}</Badge>}
        {a.important && <Badge tone="danger">Important</Badge>}
      </div>
      <h3 id={`h-${a.id}`} className={cn("mt-2 font-display font-extrabold leading-snug text-navy", compact ? "text-[0.95rem]" : "text-lg")}>
        {a.external ? <a href={a.url} target="_blank" rel="noopener noreferrer" className="hover:underline" onClick={() => { setRead(true); if (!a.sample) void send(a.id, "click"); }}>{a.headline}</a> : a.headline}
      </h3>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted">
        <span className="font-semibold text-ink-soft">{a.publisher}</span>
        <span aria-hidden>·</span>
        <time dateTime={a.dateIso} title="Original publication date">Published {a.dateLabel}</time>
        <span aria-hidden>·</span><span>{a.ageLabel}</span>
        {a.verified && !a.sample && <span className="inline-flex items-center gap-0.5 text-ok" title="Link checked: it points at this article on the publisher's own site."><ShieldCheck className="h-3.5 w-3.5" aria-hidden />Verified source</span>}
      </p>

      {summary && (
        <div className="mt-2 text-sm text-ink">
          {!compact && <p className="text-xs font-semibold uppercase tracking-wide text-muted">{a.summaryKind === "publisher" ? `From ${a.publisher}` : "What happened"}</p>}
          <p className={cn(!compact && "mt-0.5", long && !open && "line-clamp-4")}>{summary}</p>
          {long && (
            <button type="button" className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-accent-ink" aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? <>Show less<ChevronUp className="h-3.5 w-3.5" aria-hidden /></> : <>Show more<ChevronDown className="h-3.5 w-3.5" aria-hidden /></>}
            </button>
          )}
          {a.summaryKind === "generated" && !compact && <p className="mt-1 text-[11px] text-muted">Summary written by Built2Bid from the official abstract. Check the original for exact requirements.</p>}
        </div>
      )}
      {!summary && !compact && <p className="mt-2 text-sm text-muted">The publisher&apos;s feed gives only the headline. Open the original to read it.</p>}

      {!compact && (
        <div className="mt-3 rounded-lg bg-black/[0.03] px-3 py-2 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Why it matters to your business</p>
          <p className="mt-0.5 text-ink-soft">{a.why}</p>
          {(a.jurisdiction || a.effectiveLabel) && (
            <p className="mt-1 text-xs text-muted">{a.jurisdiction ? `Jurisdiction: ${a.jurisdiction}` : ""}{a.jurisdiction && a.effectiveLabel ? " · " : ""}{a.effectiveLabel ? `Effective date (per source): ${a.effectiveLabel}` : ""}</p>
          )}
        </div>
      )}
      {compact && a.reasons[0] && <p className="mt-1 text-xs text-muted">{a.reasons.join(" · ")}</p>}

      <div className={cn("mt-2 flex flex-wrap items-center gap-x-4 gap-y-1", !compact && "border-t border-line pt-2")}>
        {link}
        {interactive && !compact && (
          <>
            <button type="button" disabled={busy} aria-pressed={saved} data-testid="news-save" className="inline-flex min-h-9 items-center gap-1 text-sm text-ink-soft hover:text-ink"
              onClick={() => act(saved ? "unsave" : "save", () => setSaved(!saved), () => setSaved(saved))}>
              {saved ? <BookmarkCheck className="h-4 w-4 text-accent-ink" aria-hidden /> : <Bookmark className="h-4 w-4" aria-hidden />}{saved ? "Saved" : "Save"}
            </button>
            <button type="button" disabled={busy} data-testid="news-read" className="inline-flex min-h-9 items-center gap-1 text-sm text-ink-soft hover:text-ink"
              onClick={() => act(read ? "unread" : "read", () => setRead(!read), () => setRead(read))}>
              <Eye className="h-4 w-4" aria-hidden />{read ? "Mark unread" : "Mark read"}
            </button>
            <button type="button" disabled={busy} data-testid="news-hide" className="inline-flex min-h-9 items-center gap-1 text-sm text-ink-soft hover:text-ink"
              onClick={() => act("hide", () => setHidden(true), () => setHidden(false))}>
              <EyeOff className="h-4 w-4" aria-hidden />Hide
            </button>
          </>
        )}
      </div>
    </article>
  );
}
