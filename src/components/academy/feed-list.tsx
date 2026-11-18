import Link from "next/link";
import { CheckCircle2, MessageSquare, Pin } from "lucide-react";
import { Avatar } from "./avatar";
import { timeAgo } from "./format";
import type { FeedRow } from "@/lib/academy/community";

/** Compact post list used on Saved and member profiles. */
export function FeedList({ rows, empty, tradeName }: { rows: FeedRow[]; empty: string; tradeName: Map<string, string> }) {
  if (!rows.length) return <p className="rounded-xl border border-dashed border-line-strong bg-surface p-6 text-center text-sm text-ink-soft">{empty}</p>;
  return (
    <ul className="grid gap-2" data-testid="feed">
      {rows.map((p) => (
        <li key={p.id} className="rounded-xl border border-line bg-surface p-3 shadow-card" data-testid="feed-item">
          <div className="flex items-start gap-3">
            <Avatar id={p.author_id} name={p.author_name} level={p.author_level} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted">{p.author_name} · {timeAgo(p.created_at)} · {p.category_name}{p.trade_slug ? ` · ${tradeName.get(p.trade_slug) ?? p.trade_slug}` : ""}</p>
              <Link href={`/academy/post/${p.id}`} className="mt-0.5 flex items-center gap-1.5 font-semibold hover:underline">
                {p.pinned && <Pin className="h-3.5 w-3.5 text-accent-ink" aria-label="Pinned" />}{p.title}
                {p.answered && <CheckCircle2 className="h-3.5 w-3.5 text-ok" aria-label="Answered" />}
              </Link>
              <p className="mt-0.5 line-clamp-2 text-sm text-ink-soft">{p.excerpt}</p>
              <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted"><MessageSquare className="h-3.5 w-3.5" aria-hidden /> {p.comment_count} · {p.reaction_count} likes</p>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
