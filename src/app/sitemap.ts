import type { MetadataRoute } from "next";
import { site } from "@/lib/site";
import { trades } from "@/lib/trades/catalog";
import { articles } from "@/lib/learn/articles";

export default function sitemap(): MetadataRoute.Sitemap {
  const u = (p: string) => `${site.url}${p}`;
  return [
    { url: u("/"), changeFrequency: "weekly", priority: 1 },
    { url: u("/bids"), changeFrequency: "weekly", priority: 0.9 },
    { url: u("/pricing"), changeFrequency: "monthly", priority: 0.8 },
    { url: u("/learn"), changeFrequency: "monthly", priority: 0.6 },
    ...trades.map((t) => ({ url: u(`/bids/${t.slug}`), changeFrequency: "monthly" as const, priority: t.featured ? 0.8 : 0.7 })),
    ...articles.map((a) => ({ url: u(`/learn/${a.slug}`), lastModified: a.updated, changeFrequency: "yearly" as const, priority: 0.5 })),
    { url: u("/privacy"), priority: 0.2 },
    { url: u("/terms"), priority: 0.2 },
  ];
}
