import type { MetadataRoute } from "next";
import { site } from "@/lib/site";
import { trades } from "@/lib/trades/catalog";
import { articles } from "@/lib/learn/articles";
import { TOOLS } from "@/lib/marketing/tools";
import { ACADEMY_TRADES, ALL_COURSES } from "@/lib/academy/content/catalog";

export default function sitemap(): MetadataRoute.Sitemap {
  const u = (p: string) => `${site.url}${p}`;
  return [
    { url: u("/"), changeFrequency: "weekly", priority: 1 },
    { url: u("/bids"), changeFrequency: "weekly", priority: 0.9 },
    { url: u("/pricing"), changeFrequency: "monthly", priority: 0.8 },
    { url: u("/learn"), changeFrequency: "monthly", priority: 0.6 },
    { url: u("/tools"), changeFrequency: "monthly", priority: 0.7 },
    ...TOOLS.map((t) => ({ url: u(`/tools/${t.slug}`), changeFrequency: "monthly" as const, priority: 0.7 })),
    ...trades.map((t) => ({ url: u(`/bids/${t.slug}`), changeFrequency: "monthly" as const, priority: t.featured ? 0.8 : 0.7 })),
    ...articles.map((a) => ({ url: u(`/learn/${a.slug}`), lastModified: a.updated, changeFrequency: "yearly" as const, priority: 0.5 })),
    // Contractor Academy: public pages only (discussions, profiles and member pages are never listed).
    // Built from the seeded catalog; only published courses that have lessons, and only lessons open to everyone.
    { url: u("/academy"), changeFrequency: "weekly", priority: 0.6 },
    { url: u("/academy/classroom"), changeFrequency: "weekly", priority: 0.7 },
    { url: u("/academy/about"), changeFrequency: "yearly", priority: 0.3 },
    ...ACADEMY_TRADES.map((t) => ({ url: u(`/academy/classroom/${t.slug}`), changeFrequency: "monthly" as const, priority: 0.5 })),
    ...ALL_COURSES.filter((c) => c.status === "published" && c.lessons?.length).flatMap((c) => [
      { url: u(`/academy/courses/${c.slug}`), changeFrequency: "monthly" as const, priority: 0.6 },
      ...(c.lessons ?? []).filter((l) => l.access === "public").map((l) => ({ url: u(`/academy/courses/${c.slug}/${l.slug}`), changeFrequency: "yearly" as const, priority: 0.5 })),
    ]),
    { url: u("/about"), changeFrequency: "monthly", priority: 0.4 },
    { url: u("/privacy"), priority: 0.2 },
    { url: u("/terms"), priority: 0.2 },
    { url: u("/security"), priority: 0.2 },
    ...["/cookies", "/esign-disclosure", "/referral-terms", "/trial-terms", "/academy-terms", "/verify"].map((p) => ({ url: u(p), priority: 0.2 })),
  ];
}
