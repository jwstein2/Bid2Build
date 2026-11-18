"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus } from "lucide-react";
import { CATEGORY_LABEL } from "@/lib/news/categories";
import type { Category } from "@/lib/news/types";

/** Follow / unfollow the topic being filtered. Followed topics rank higher everywhere (widget included). */
export function FollowTopic({ topic, following, topics = [] }: { topic: Category; following: boolean; topics?: Category[] }) {
  const [on, setOn] = useState(following);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toggle = async () => {
    setBusy(true);
    const next = on ? topics.filter((t) => t !== topic) : [...new Set([...topics, topic])];
    const r = await fetch("/api/news/preferences", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ topics: next }) });
    if (r.ok) { setOn(!on); router.refresh(); }
    setBusy(false);
  };
  return (
    <button type="button" onClick={toggle} disabled={busy} aria-pressed={on} data-testid="news-follow-topic"
      className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-line-strong px-3 text-sm font-semibold text-ink-soft hover:border-brand/50">
      {on ? <Check className="h-4 w-4 text-ok" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}{on ? `Following ${CATEGORY_LABEL[topic]}` : `Follow ${CATEGORY_LABEL[topic]}`}
    </button>
  );
}
