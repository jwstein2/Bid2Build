/**
 * Acquisition channel for an account, from its first-touch lead record (public.leads). Deterministic,
 * documented rules; anything we cannot support with recorded data is "unknown". A website visit on
 * its own never assigns a channel: only the landing request's campaign tags, ad click id type or
 * outside referrer host do.
 */
export type Channel = "google_ads" | "meta_ads" | "youtube" | "organic_search" | "email_outreach" | "social" | "referral" | "direct" | "unknown";

export const CHANNELS: { key: Channel; label: string; rule: string }[] = [
  { key: "google_ads", label: "Google Ads", rule: "Google click id (gclid/gbraid/wbraid), or utm_source google with a paid utm_medium (cpc, ppc, paid…)" },
  { key: "meta_ads", label: "Meta Ads", rule: "utm_source facebook/instagram/meta with a paid utm_medium" },
  { key: "youtube", label: "YouTube", rule: "utm_source youtube, or referred by youtube.com" },
  { key: "organic_search", label: "Organic Search", rule: "Referred by a search engine (google, bing, duckduckgo, yahoo, ecosia…) with no paid tags" },
  { key: "email_outreach", label: "Email Outreach", rule: "utm_medium email, utm_source instantly, an Instantly campaign id (?ic=), or a lead first contacted by outreach" },
  { key: "social", label: "Organic Social", rule: "Referred by a social site, or a Facebook click id without paid tags" },
  { key: "referral", label: "Referral", rule: "Any other outside referring site, a ?ref= code, or other utm_source" },
  { key: "direct", label: "Direct", rule: "Signed up with no tags, click id or outside referrer recorded (tracked since attribution v2)" },
  { key: "unknown", label: "Unknown", rule: "No lead record, or signed up before referrers were recorded" },
];
export const CHANNEL_LABEL = Object.fromEntries(CHANNELS.map((c) => [c.key, c.label])) as Record<Channel, string>;
export const isChannel = (v: string): v is Channel => CHANNELS.some((c) => c.key === v);

export interface LeadAttribution {
  source?: string | null; utm_source?: string | null; utm_medium?: string | null; utm_campaign?: string | null;
  first_campaign_id?: string | null; first_campaign_name?: string | null; referrer_host?: string | null; click_id_type?: string | null;
  stage?: string | null;
}

const PAID = /^(cpc|ppc|paid|paidsearch|paid_search|paid-search|paidsocial|paid_social|paid-social|cpm|display|ads?)$/i;
const SEARCH = /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.yahoo\.com|yahoo\.com|ecosia\.org|search\.brave\.com|yandex\.[a-z]+|baidu\.com)$/;
const SOCIAL = /(^|\.)(facebook\.com|fb\.com|instagram\.com|linkedin\.com|lnkd\.in|t\.co|x\.com|twitter\.com|reddit\.com|tiktok\.com|pinterest\.com|nextdoor\.com|threads\.net)$/;
const YT = /(^|\.)(youtube\.com|youtu\.be)$/;
const META_SRC = /^(facebook|fb|instagram|ig|meta)$/i;

export function classifyChannel(l: LeadAttribution | null | undefined): Channel {
  if (!l) return "unknown";
  const src = (l.utm_source ?? "").trim().toLowerCase();
  const med = (l.utm_medium ?? "").trim().toLowerCase();
  const ref = (l.referrer_host ?? "").trim().toLowerCase();
  const click = l.click_id_type ?? "";
  if (["gclid", "gbraid", "wbraid"].includes(click) || (src === "google" && PAID.test(med))) return "google_ads";
  if (META_SRC.test(src) && PAID.test(med)) return "meta_ads";
  if (src === "youtube" || (!src && YT.test(ref))) return "youtube";
  if (med === "email" || src === "instantly" || l.first_campaign_id) return "email_outreach";
  if (src) return META_SRC.test(src) ? "social" : src === "google" || src === "bing" ? "organic_search" : "referral";
  if (click === "fbclid") return "social";
  if (ref && ref !== "(none)") return SEARCH.test(ref) ? "organic_search" : SOCIAL.test(ref) ? "social" : "referral";
  if (l.source === "referral") return "referral";
  if (ref === "(none)") return "direct";
  return "unknown";
}

/** A campaign label for grouping: the outreach campaign name/id or utm_campaign. */
export function campaignOf(l: LeadAttribution | null | undefined): string | null {
  if (!l) return null;
  return (l.first_campaign_name || l.first_campaign_id || l.utm_campaign || "").trim() || null;
}
