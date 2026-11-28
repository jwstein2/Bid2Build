/**
 * Acquisition channel for an account, from its first-touch lead record (public.leads). Deterministic,
 * documented rules; anything we cannot support with recorded data is "unknown". A website visit on
 * its own never assigns a channel: only the landing request's campaign tags, ad click id type or
 * outside referrer host do.
 */
export type Channel = "google_ads" | "meta_ads" | "youtube" | "creator" | "organic_search" | "ai_search" | "email_outreach" | "social" | "referral" | "direct" | "unknown";

export const CHANNELS: { key: Channel; label: string; rule: string }[] = [
  { key: "google_ads", label: "Google Ads", rule: "Google click id (gclid/gbraid/wbraid), or utm_source google with a paid utm_medium (cpc, ppc, paid…)" },
  { key: "meta_ads", label: "Meta Ads", rule: "utm_source facebook/instagram/meta with a paid utm_medium" },
  { key: "youtube", label: "YouTube", rule: "utm_source youtube, or referred by youtube.com" },
  { key: "creator", label: "Creator Partners", rule: "utm_medium creator/partner/influencer or utm_source creator; utm_campaign names the creator (see docs/growth/ADS.md)" },
  { key: "organic_search", label: "Organic Search", rule: "Referred by a search engine (google, bing, duckduckgo, yahoo, ecosia…) or the Google app on Android, with no paid tags" },
  { key: "ai_search", label: "AI Search", rule: "Referred by an AI assistant or answer engine (chatgpt.com, perplexity.ai, claude.ai, gemini.google.com, copilot.microsoft.com, grok.com…) or utm_source naming one (ChatGPT adds utm_source=chatgpt.com). Only clicks that pass a referrer or tag are counted" },
  { key: "email_outreach", label: "Email Outreach", rule: "utm_medium email, utm_source instantly, an Instantly campaign id (?ic=), or a lead first contacted by outreach" },
  { key: "social", label: "Organic Social", rule: "utm_medium social (e.g. Facebook posts, group chats), utm_source facebook/instagram without paid tags, a social referring site, or a Facebook click id without paid tags" },
  { key: "referral", label: "Referral", rule: "Any other outside referring site, a ?ref= code, or other utm_source" },
  { key: "direct", label: "Direct", rule: "Signed up with no tags, click id or outside referrer recorded (tracked since attribution v2)" },
  { key: "unknown", label: "Unknown", rule: "No lead record, or signed up before referrers were recorded" },
];
export const CHANNEL_LABEL = Object.fromEntries(CHANNELS.map((c) => [c.key, c.label])) as Record<Channel, string>;
export const isChannel = (v: string): v is Channel => CHANNELS.some((c) => c.key === v);

export interface LeadAttribution {
  source?: string | null; utm_source?: string | null; utm_medium?: string | null; utm_campaign?: string | null; utm_content?: string | null;
  first_campaign_id?: string | null; first_campaign_name?: string | null; referrer_host?: string | null; click_id_type?: string | null;
  stage?: string | null;
}

const PAID = /^(cpc|ppc|paid|paidsearch|paid_search|paid-search|paidsocial|paid_social|paid-social|cpm|display|ads?)$/i;
const SEARCH = /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.yahoo\.com|yahoo\.com|ecosia\.org|search\.brave\.com|yandex\.[a-z]+|baidu\.com)$/;
const SOCIAL = /(^|\.)(facebook\.com|fb\.com|instagram\.com|linkedin\.com|lnkd\.in|t\.co|x\.com|twitter\.com|reddit\.com|tiktok\.com|pinterest\.com|nextdoor\.com|threads\.net)$/;
/** AI assistants and answer engines that send visitors (host of the referrer, or the utm_source they add). */
export const AI_SEARCH = /(^|\.)(chatgpt\.com|chat\.openai\.com|openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|bard\.google\.com|copilot\.microsoft\.com|copilot\.com|grok\.com|x\.ai|you\.com|phind\.com|meta\.ai|deepseek\.com|chat\.mistral\.ai)$/;
const AI_SRC = /^(chatgpt(\.com)?|openai|perplexity(\.ai)?|claude(\.ai)?|gemini|copilot(\.com)?|bing_copilot|grok(\.com)?|you\.com|phind|meta\.ai|deepseek)$/i;
const YT = /(^|\.)(youtube\.com|youtu\.be)$/;
// Android apps send their package name as the referrer (android-app://<package>/). Gmail and other mail apps stay
// "referral", as in GA4's default channel rules: an email channel needs utm_medium=email.
const APP_SEARCH = /^com\.google\.android\.googlequicksearchbox$/;
const APP_SOCIAL = /^(com\.facebook\.(katana|lite|orca)|com\.instagram\.android|com\.linkedin\.android|com\.twitter\.android|com\.reddit\.frontpage|com\.zhiliaoapp\.musically|com\.pinterest|com\.nextdoor)$/;
const APP_YT = /^com\.google\.android\.youtube$/;
/** An Android package name, not a web host (no website's host starts with "com."). Checked before the web rules, which would otherwise read com.google.android.gm (Gmail) as google.* search. */
const ANDROID_PKG = /^(com|org|net)\.[a-z0-9_]+\.[a-z0-9_.]+$/;
const META_SRC = /^(facebook|fb|instagram|ig|meta)$/i;
const CREATOR_MED = /^(creator|creators|partner|partners|influencer|affiliate)$/i;
const SOCIAL_MED = /^(social|organic_social|organic-social|social_organic|social-network|social-media|sm)$/i;

export function classifyChannel(l: LeadAttribution | null | undefined): Channel {
  if (!l) return "unknown";
  const src = (l.utm_source ?? "").trim().toLowerCase();
  const med = (l.utm_medium ?? "").trim().toLowerCase();
  const ref = (l.referrer_host ?? "").trim().toLowerCase();
  const click = l.click_id_type ?? "";
  if (["gclid", "gbraid", "wbraid"].includes(click) || (src === "google" && PAID.test(med))) return "google_ads";
  if (META_SRC.test(src) && PAID.test(med)) return "meta_ads";
  // Creator Partner links are tagged by hand and win over the platform the creator posted on.
  if (CREATOR_MED.test(med) || src === "creator") return "creator";
  if (src === "youtube" || (!src && (YT.test(ref) || APP_YT.test(ref)))) return "youtube";
  if (med === "email" || src === "instantly" || l.first_campaign_id) return "email_outreach";
  // AI assistants after outreach, before search: gemini.google.com would otherwise read as Google organic search.
  if ((src && AI_SRC.test(src) && !PAID.test(med)) || (!src && ref && AI_SEARCH.test(ref))) return "ai_search";
  // Organic posts tagged by hand (Facebook groups, group chats, other social sites): utm_medium social.
  if (SOCIAL_MED.test(med)) return "social";
  if (src) return META_SRC.test(src) ? "social" : src === "google" || src === "bing" ? "organic_search" : "referral";
  if (click === "fbclid") return "social";
  if (ref && ANDROID_PKG.test(ref)) return APP_SEARCH.test(ref) ? "organic_search" : APP_SOCIAL.test(ref) ? "social" : "referral";
  if (ref && ref !== "(none)") return SEARCH.test(ref) ? "organic_search" : SOCIAL.test(ref) ? "social" : "referral";
  if (l.source === "referral") return "referral";
  if (ref === "(none)") return "direct";
  return "unknown";
}

/** The creator a Creator Partner signup came from (utm_campaign, normalized), or null. */
export function creatorOf(l: LeadAttribution | null | undefined): string | null {
  if (classifyChannel(l) !== "creator") return null;
  return (l?.utm_campaign ?? "").trim().toLowerCase() || "(not named)";
}

/** The ad creative (utm_content, normalized) of a signup, or null. */
export function creativeOf(l: LeadAttribution | null | undefined): string | null {
  return (l?.utm_content ?? "").trim().toLowerCase().slice(0, 120) || null;
}

/** A campaign label for grouping: the outreach campaign name/id or utm_campaign. */
export function campaignOf(l: LeadAttribution | null | undefined): string | null {
  if (!l) return null;
  return (l.first_campaign_name || l.first_campaign_id || l.utm_campaign || "").trim() || null;
}
