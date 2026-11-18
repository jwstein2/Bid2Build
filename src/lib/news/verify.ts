import type { NewsSourceDef } from "./sources";
import type { RawItem } from "./parse";
import type { Authority } from "./types";

/**
 * Original-source verification (V6.8.1 §3). An item is published only if:
 *  1. its link is https (http is upgraded only for the publisher's own hosts),
 *  2. the link host belongs to the identified publisher (sources.ts `hosts`),
 *  3. the link points at a specific article, not the homepage or a section index,
 *  4. it has a real publication date that is not in the future and not past the source's retention,
 *  5. it has a headline.
 * Nothing is invented: a missing date or link means the item is dropped, never filled in.
 */

export interface Verified {
  ok: true;
  url: string;
  urlKey: string;
  host: string;
  publishedAt: string;
  datePrecision: "day" | "time";
  fingerprint: string;
}
export interface Rejected { ok: false; reason: string }

const TRACKING = /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|ref|cmpid|_hsenc|_hsmi|mkt_tok)$/i;
const SECTION_PATHS = /^\/(?:|news|blog|articles?|feed|rss|topics?|category|tag|index\.html?)\/?$/i;

export function canonicalUrl(raw: string, hosts: string[]): { url: string; host: string } | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (!hosts.includes(host)) return null;
  if (u.protocol === "http:") u.protocol = "https:";
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  u.hash = "";
  return { url: u.toString(), host };
}

export const urlKey = (url: string) => {
  const u = new URL(url);
  return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${u.search}`.toLowerCase();
};

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "for", "on", "at", "by", "with", "from", "is", "are", "as", "its", "new"]);
/** Story fingerprint for syndicated copies: the headline's significant words, order-independent. */
export function fingerprint(title: string): string {
  const words = title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));
  return [...new Set(words)].sort().slice(0, 14).join(" ");
}

export function parseDate(raw: string | null): { iso: string; precision: "day" | "time" } | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T12:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : { iso: d.toISOString(), precision: "day" };
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  // Midnight/noon UTC stamps on date-only feeds (Federal Register RSS, OSHA, OpenFEMA) are dates, not times.
  const dayOnly = /T00:00:00(\.000)?Z$/.test(s) || /\b(00|12):00:00 (GMT|\+0000)$/.test(s);
  return { iso: d.toISOString(), precision: dayOnly ? "day" : "time" };
}

export function verifyItem(item: RawItem, source: NewsSourceDef, now = new Date()): Verified | Rejected {
  if (!item.title.trim()) return { ok: false, reason: "no_headline" };
  const c = canonicalUrl(item.url, source.hosts);
  if (!c) return { ok: false, reason: "link_not_publisher" };
  const path = new URL(c.url).pathname;
  if (SECTION_PATHS.test(path)) return { ok: false, reason: "link_not_article" };
  const date = parseDate(item.publishedRaw);
  if (!date) return { ok: false, reason: "no_date" };
  const t = new Date(date.iso).getTime();
  if (t > now.getTime() + 36 * 3600_000) return { ok: false, reason: "future_date" };
  if (t < now.getTime() - source.retentionDays * 86400_000) return { ok: false, reason: "too_old" };
  return { ok: true, url: c.url, urlKey: urlKey(c.url), host: c.host, publishedAt: date.iso, datePrecision: date.precision, fingerprint: fingerprint(item.title) };
}

const AUTH_RANK: Record<Authority, number> = { official: 4, industry: 3, local_news: 2, community: 1 };

/**
 * Drop syndicated or repeated copies inside one batch: same URL, or same headline fingerprint within
 * three days. The more authoritative source wins; on a tie, the earlier publication (the original).
 */
export function dedupe<T extends { urlKey: string; fingerprint: string; publishedAt: string; authority: Authority }>(items: T[]): { kept: T[]; duplicates: number } {
  const sorted = [...items].sort((a, b) => AUTH_RANK[b.authority] - AUTH_RANK[a.authority] || a.publishedAt.localeCompare(b.publishedAt));
  const urls = new Set<string>();
  const prints: { f: string; t: number }[] = [];
  const kept: T[] = [];
  for (const it of sorted) {
    if (urls.has(it.urlKey)) continue;
    const t = new Date(it.publishedAt).getTime();
    if (it.fingerprint.split(" ").length >= 4 && prints.some((p) => p.f === it.fingerprint && Math.abs(p.t - t) < 3 * 86400_000)) continue;
    urls.add(it.urlKey);
    prints.push({ f: it.fingerprint, t });
    kept.push(it);
  }
  return { kept, duplicates: items.length - kept.length };
}
