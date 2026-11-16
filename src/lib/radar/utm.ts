import { site } from "@/lib/site";
import { getSource } from "./sources";

export const RADAR_CAMPAIGN = "opportunity_radar";
export const RADAR_MEDIUM = "community";

/**
 * Tracked link for a reply. Only the platform goes into the tags: never a username, thread id, email
 * or any other identifier. Signup attribution stays first-touch (public.leads keeps the first visit),
 * so a later Radar click never overwrites how an existing user originally found Built2Bid.
 */
export function trackedUrl(sourceKey: string, base: string = site.url): string {
  const u = new URL("/", base.startsWith("http://localhost") ? "https://built2bid.org" : base);
  u.searchParams.set("utm_source", (getSource(sourceKey)?.utmSource ?? "forum").replace(/[^a-z0-9_-]/gi, "").toLowerCase() || "forum");
  u.searchParams.set("utm_medium", RADAR_MEDIUM);
  u.searchParams.set("utm_campaign", RADAR_CAMPAIGN);
  return u.toString();
}

/** Short display form for drafts: "built2bid.org" (+ tags only when links are allowed). */
export const displayDomain = (base: string = site.url) => {
  try { const h = new URL(base).hostname.replace(/^www\./, ""); return h === "localhost" ? "built2bid.org" : h; } catch { return "built2bid.org"; }
};
