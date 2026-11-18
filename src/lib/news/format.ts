import { ARTICLE_TYPE_LABEL, CATEGORY_LABEL } from "./categories";
import { AUTHORITY_LABEL } from "./sources";
import type { RankedArticle } from "./rank";
import { tradeName } from "@/lib/trades/catalog";

/** What a card needs, serializable for client components. */
export interface CardArticle {
  id: string;
  headline: string;
  publisher: string;
  url: string;
  external: boolean;
  dateLabel: string;       // the ORIGINAL publication date
  dateIso: string;
  ageLabel: string;
  geoLabel: string;
  tradeLabel: string | null;
  topicLabel: string | null;
  typeLabel: string;
  authority: RankedArticle["authority"];
  authorityLabel: string;
  summary: string | null;   // "What happened" (generated or structured) when permitted
  summaryKind: "generated" | "structured" | "publisher" | "none";
  why: string;
  reasons: string[];
  effectiveLabel: string | null;
  jurisdiction: string | null;
  verified: boolean;
  sample: boolean;
  saved: boolean;
  read: boolean;
  important: boolean;
}

const TZ = "America/Chicago";
export function dateLabel(iso: string, precision: "day" | "time"): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: precision === "day" ? "UTC" : TZ });
}
export function ageLabel(iso: string, now = new Date()): string {
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} wk ago`;
  return `${Math.floor(days / 30)} mo ago`;
}

export function toCard(a: RankedArticle, now = new Date()): CardArticle {
  const summaryKind = a.summary && a.summaryStatus === "generated" ? "generated" : a.summary && (a.summaryStatus === "structured" || a.sample) ? "structured" : a.snippet ? "publisher" : "none";
  const topic = a.categories[0] ? CATEGORY_LABEL[a.categories[0]] : null;
  return {
    id: a.id, headline: a.headline, publisher: a.publisher, url: a.url, external: /^https:\/\//.test(a.url),
    dateLabel: dateLabel(a.publishedAt, a.datePrecision), dateIso: a.publishedAt, ageLabel: ageLabel(a.publishedAt, now),
    geoLabel: a.geoLabel, tradeLabel: a.matchedTrade ? tradeName(a.matchedTrade) : a.trades[0] ? tradeName(a.trades[0]) : null, topicLabel: topic,
    typeLabel: ARTICLE_TYPE_LABEL[a.articleType], authority: a.authority, authorityLabel: AUTHORITY_LABEL[a.authority],
    summary: summaryKind === "publisher" ? a.snippet : summaryKind === "none" ? null : a.summary,
    summaryKind, why: a.whyItMatters, reasons: a.reasons,
    effectiveLabel: a.effectiveOn ? new Date(`${a.effectiveOn}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null,
    jurisdiction: a.jurisdiction, verified: a.verified, sample: Boolean(a.sample), saved: a.saved, read: a.read,
    important: a.authority === "official" && (a.articleType === "final_rule" || (a.articleType === "disaster_declaration" && a.readerGeo === "local")),
  };
}

/** First 2–3 sentences for the compact widget. */
export function shortSummary(text: string | null, maxChars = 260): string | null {
  if (!text) return null;
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [text];
  let out = "";
  let n = 0;
  for (const s of sentences) {
    if ((out + s).length > maxChars && out) break;
    out += s;
    if (++n >= 3) break;
  }
  out = out.trim() || text.slice(0, maxChars);
  return out.length > maxChars ? `${out.slice(0, maxChars - 1).replace(/\s+\S*$/, "")}…` : out;
}
