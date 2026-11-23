"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import type { CardArticle } from "@/lib/news/format";
import { ArticleCard } from "./article-card";

/**
 * A list of article cards. Marking a card read (or opening the original) moves it to the bottom right away;
 * the server feed already returns read items last, so the order holds after a reload.
 */
export function ArticleList({ articles, variant = "full", sinkOnRead = true, archived = false, className }: { articles: CardArticle[]; variant?: "compact" | "full"; sinkOnRead?: boolean; archived?: boolean; className?: string }) {
  const [order, setOrder] = useState(() => articles.map((a) => a.id));
  const byId = new Map(articles.map((a) => [a.id, a]));
  const onReadChange = (id: string, read: boolean) => {
    if (!sinkOnRead || !read) return;
    setOrder((cur) => [...cur.filter((x) => x !== id), id]);
  };
  return (
    <ul className={cn(variant === "compact" ? "space-y-2" : "space-y-3", className)}>
      {order.map((id) => {
        const a = byId.get(id);
        return a ? <li key={id}><ArticleCard a={a} variant={variant} onReadChange={onReadChange} archived={archived} /></li> : null;
      })}
    </ul>
  );
}
