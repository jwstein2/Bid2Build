/**
 * Built2Bid UTM convention (Growth OS Phase 3). One rule set for every link we tag, checked by the data
 * quality report and by tests. Docs: docs/growth-os/phase3/UTM_CONVENTION.md.
 *
 *   utm_source   where the link sits: the platform or tool       google, facebook, instagram, youtube, instantly, newsletter
 *   utm_medium   the kind of traffic (fixed list below)          cpc, paid_social, social, email, video, creator, partner, referral
 *   utm_campaign paid: b2b-<platform>-<goal>-<yyyymm>             b2b-meta-signup-202612
 *                organic / outreach: a short snake/kebab name    cold_outreach, daily_posts, <creator handle>
 *   utm_content  the creative or post id                         b-h1-15s-916-v1, nov17_am
 *   utm_term     paid search keyword (optional)                  roofing_estimate_software
 *
 * Lower case only; letters, digits, "_", "-" and "." only. Source, medium and campaign always go together.
 * Program links (/s/<code> sales rep, /a/<code> affiliate, ?ref= referral) are tagged by the app and are exempt.
 */
export const UTM_MEDIUMS = ["cpc", "paid_search", "paid_social", "display", "video", "social", "email", "sms", "creator", "partner", "affiliate", "referral", "qr", "print", "event"] as const;
export const PAID_MEDIUMS = new Set(["cpc", "paid_search", "paid_social", "display"]);
/** Tags the app itself writes on program redirects (sales rep, affiliate, referral). */
const PROGRAM_SOURCES = new Set(["sales_rep", "affiliate", "referral"]);

const TOKEN = /^[a-z0-9][a-z0-9_.-]{0,99}$/;
const PAID_CAMPAIGN = /^b2b-[a-z0-9]+-[a-z0-9_]+-20\d{2}(0[1-9]|1[0-2])$/;

export interface UtmTags { source?: string | null; medium?: string | null; campaign?: string | null; content?: string | null; term?: string | null }
export type UtmIssue = "missing_source" | "missing_medium" | "missing_campaign" | "not_lowercase" | "bad_characters" | "unknown_medium" | "paid_campaign_format";

/** Problems with one set of tags (empty = follows the convention, or carries no tags at all). */
export function utmIssues(t: UtmTags): UtmIssue[] {
  const vals = { source: t.source ?? "", medium: t.medium ?? "", campaign: t.campaign ?? "", content: t.content ?? "", term: t.term ?? "" };
  if (!Object.values(vals).some(Boolean)) return [];
  if (PROGRAM_SOURCES.has(vals.source.toLowerCase()) && vals.medium.toLowerCase() === "referral") return [];
  const out = new Set<UtmIssue>();
  if (!vals.source) out.add("missing_source");
  if (!vals.medium) out.add("missing_medium");
  if (!vals.campaign) out.add("missing_campaign");
  for (const v of Object.values(vals)) {
    if (!v) continue;
    if (v !== v.toLowerCase()) out.add("not_lowercase");
    if (!TOKEN.test(v.toLowerCase())) out.add("bad_characters");
  }
  const med = vals.medium.toLowerCase();
  if (med && !(UTM_MEDIUMS as readonly string[]).includes(med)) out.add("unknown_medium");
  if (PAID_MEDIUMS.has(med) && vals.campaign && !PAID_CAMPAIGN.test(vals.campaign.toLowerCase())) out.add("paid_campaign_format");
  return [...out];
}

/** A tagged URL that follows the convention, or an error listing what's wrong. */
export function conventionUrl(origin: string, path: string, t: { source: string; medium: string; campaign: string; content?: string | null; term?: string | null }): { url: string } | { error: UtmIssue[] } {
  const issues = utmIssues(t);
  if (issues.length) return { error: issues };
  const u = new URL(path, origin);
  u.searchParams.set("utm_source", t.source);
  u.searchParams.set("utm_medium", t.medium);
  u.searchParams.set("utm_campaign", t.campaign);
  if (t.content) u.searchParams.set("utm_content", t.content);
  if (t.term) u.searchParams.set("utm_term", t.term);
  return { url: u.toString() };
}
