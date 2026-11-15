/**
 * Opportunity Radar source registry and compliance matrix.
 *
 * The platform rules live in code (reviewed in pull requests), not in the database, so a database
 * edit can never loosen them. The database only stores operational state per source (enabled,
 * owner-confirmed authorizations, last check, last error) in public.radar_source_state.
 *
 * Every rule here is deliberately conservative. "Public" does not mean "may be scraped": unless a
 * platform offers an official API AND the owner has recorded authorization, a source is manual-only.
 * Manual-only means: the owner pastes a discussion link, Built2Bid never fetches the page, and replies
 * are copied and posted by the owner by hand.
 */

export type MonitoringMethod = "manual_import" | "official_api";
/** forbidden: never, regardless of any database flag. requires_authorization: only after the owner records approval. */
export type Gate = "forbidden" | "requires_authorization";
export type Cadence = "manual" | "daily" | "several_weekly" | "weekly";

export interface SourceDef {
  key: string;
  platform: string;
  name: string;
  url: string;
  hosts: string[];
  categories: string[];
  method: MonitoringMethod;
  /** Automated discovery (any machine reading of the platform). */
  automatedDiscovery: Gate;
  /** Automated publishing through an API. Manual copy/paste by the owner is always possible. */
  automatedPublish: Gate;
  /** Whether replies may include a link to built2bid.org by default (community rules can still forbid it). */
  linksAllowedByDefault: boolean;
  /** utm_source value for tracked links. */
  utmSource: string;
  cadence: Cadence;
  priority: "high" | "medium" | "low";
  permittedDiscovery: string[];
  permittedReplies: string[];
  prohibited: string[];
  /** What the owner needs to do before anything beyond manual import is possible. */
  ownerSetup: string;
  policyLinks: { label: string; url: string }[];
  /** What we found when reviewing the platform's rules, and when. The owner must confirm before relying on it. */
  policyNotes: string;
  reviewedOn: string;
}

const MANUAL_DISCOVERY = ["Owner pastes a discussion link and the question text"];
const MANUAL_REPLY = ["Owner copies an approved draft and posts it by hand, signed as themself"];
const COMMON_PROHIBITED = [
  "Scraping or crawling pages",
  "Automated posting or commenting",
  "Private messages / DMs",
  "Collecting member lists, emails or phone numbers",
  "Proxies, alternate accounts, fingerprint evasion or CAPTCHA bypass",
];

const REVIEWED = "2026-11-15";

function forum(key: string, name: string, url: string, hosts: string[], categories: string[], priority: SourceDef["priority"], utmSource = key): SourceDef {
  return {
    key, platform: "Forum", name, url, hosts, categories, method: "manual_import",
    automatedDiscovery: "forbidden", automatedPublish: "forbidden", linksAllowedByDefault: false, utmSource,
    cadence: "manual", priority, permittedDiscovery: MANUAL_DISCOVERY, permittedReplies: MANUAL_REPLY,
    prohibited: [...COMMON_PROHIBITED, "Links or self-promotion unless the forum's rules allow it"],
    ownerSetup: "Read the forum's rules and self-promotion policy. Most contractor forums restrict vendor posts; some require a vendor/sponsor account. Turn on links for this source only if the rules allow them.",
    policyLinks: [{ label: "Site", url }],
    policyNotes: "Independent forum. No public API for posting was identified. Treat as manual-only; many trade forums prohibit vendor promotion outside sponsor areas.",
    reviewedOn: REVIEWED,
  };
}

export const SOURCES: SourceDef[] = [
  {
    key: "reddit", platform: "Reddit", name: "Reddit (contractor subreddits)", url: "https://www.reddit.com/r/Contractor/",
    hosts: ["reddit.com", "old.reddit.com", "www.reddit.com", "np.reddit.com", "redd.it"],
    categories: ["r/Contractor", "r/Construction", "r/Roofing", "r/HomeImprovement (pros)", "r/smallbusiness"],
    method: "manual_import", automatedDiscovery: "requires_authorization", automatedPublish: "requires_authorization",
    linksAllowedByDefault: false, utmSource: "reddit", cadence: "manual", priority: "high",
    permittedDiscovery: [...MANUAL_DISCOVERY, "API monitoring only after Reddit approves an app for this use"],
    permittedReplies: [...MANUAL_REPLY, "API posting only after Reddit approval and the owner records it"],
    prohibited: [...COMMON_PROHIBITED, "Using the Reddit API commercially without approval", "Posting where a subreddit bans self-promotion"],
    ownerSetup: "Manual import works today. API access needs an approved Reddit developer application under the Responsible Builder Policy (commercial use needs explicit approval). Each subreddit's self-promotion rules still apply.",
    policyLinks: [
      { label: "Developer Terms", url: "https://redditinc.com/policies/developer-terms" },
      { label: "Data API Terms", url: "https://redditinc.com/policies/data-api-terms" },
      { label: "Responsible Builder Policy", url: "https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy" },
    ],
    policyNotes: "Since late 2025 Reddit requires pre-approval for Data API access (Responsible Builder Policy); commercial use requires a separate agreement. No approval is on file, so Built2Bid never calls Reddit.",
    reviewedOn: REVIEWED,
  },
  {
    key: "skool", platform: "Skool", name: "Construction Contractors Hub and other Skool communities", url: "https://www.skool.com/",
    hosts: ["skool.com", "www.skool.com"], categories: ["Construction Contractors Hub", "Other contractor communities"],
    method: "manual_import", automatedDiscovery: "forbidden", automatedPublish: "forbidden", linksAllowedByDefault: false, utmSource: "skool",
    cadence: "manual", priority: "high", permittedDiscovery: MANUAL_DISCOVERY, permittedReplies: [...MANUAL_REPLY, "Only where the community's rules and moderators allow it"],
    prohibited: [...COMMON_PROHIBITED, "Any Skool bot, scraper or third-party Skool API (including Apify actors)"],
    ownerSetup: "Manual only, permanently. Ask each community's moderators before mentioning Built2Bid.",
    policyLinks: [{ label: "Skool platform policy", url: "https://help.skool.com/article/179-platform-policy" }],
    policyNotes: "Skool has no official public API for this. Community content sits behind membership. Hard rule from the owner: no Skool scraping, bots or automated posting or messaging.",
    reviewedOn: REVIEWED,
  },
  {
    key: "youtube", platform: "YouTube", name: "YouTube contractor video comments", url: "https://www.youtube.com/",
    hosts: ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"], categories: ["Estimating and bidding videos", "Trade business channels"],
    method: "official_api", automatedDiscovery: "requires_authorization", automatedPublish: "requires_authorization", linksAllowedByDefault: false, utmSource: "youtube",
    cadence: "daily", priority: "medium",
    permittedDiscovery: [...MANUAL_DISCOVERY, "YouTube Data API v3 search + commentThreads.list (after a key is set and the owner enables it)"],
    permittedReplies: [...MANUAL_REPLY, "comments.insert as the owner's channel via OAuth (after authorization), one approved reply at a time"],
    prohibited: [...COMMON_PROHIBITED.filter((p) => !p.startsWith("Automated posting")), "Unapproved or bulk comments", "Repetitive promotional comments (YouTube spam policy)"],
    ownerSetup: "Not connected. Needs a Google Cloud project with YouTube Data API v3 enabled (free default quota 10,000 units/day: reads cost 1 unit, search 100, a comment 50) and, for replies, OAuth consent for the owner's channel. Nothing is built to call YouTube in this release.",
    policyLinks: [
      { label: "API Terms of Service", url: "https://developers.google.com/youtube/terms/api-services-terms-of-service" },
      { label: "Quota costs", url: "https://developers.google.com/youtube/v3/determine_quota_cost" },
      { label: "Spam policy", url: "https://support.google.com/youtube/answer/2801973" },
    ],
    policyNotes: "Official API exists for comment discovery and replies, with quotas. Links in comments are often held for review or filtered as spam; default to no link.",
    reviewedOn: REVIEWED,
  },
  {
    key: "facebook", platform: "Facebook", name: "Public Facebook contractor discussions", url: "https://www.facebook.com/",
    hosts: ["facebook.com", "www.facebook.com", "m.facebook.com", "fb.com"], categories: ["Public contractor groups the owner belongs to"],
    method: "manual_import", automatedDiscovery: "forbidden", automatedPublish: "forbidden", linksAllowedByDefault: false, utmSource: "facebook",
    cadence: "manual", priority: "medium", permittedDiscovery: MANUAL_DISCOVERY, permittedReplies: MANUAL_REPLY,
    prohibited: [...COMMON_PROHIBITED, "Reading group content through any unofficial tool"],
    ownerSetup: "Manual only. Meta removed the Groups API for third-party apps; there is no supported way to monitor or post to groups.",
    policyLinks: [{ label: "Meta automated data collection terms", url: "https://www.facebook.com/apps/site_scraping_tos_terms.php" }],
    policyNotes: "Automated collection requires Meta's written permission. Treat as manual-only.",
    reviewedOn: REVIEWED,
  },
  {
    key: "linkedin", platform: "LinkedIn", name: "Relevant LinkedIn public posts", url: "https://www.linkedin.com/",
    hosts: ["linkedin.com", "www.linkedin.com"], categories: ["Construction business owners", "Estimators"],
    method: "manual_import", automatedDiscovery: "forbidden", automatedPublish: "forbidden", linksAllowedByDefault: true, utmSource: "linkedin",
    cadence: "manual", priority: "low", permittedDiscovery: MANUAL_DISCOVERY, permittedReplies: MANUAL_REPLY,
    prohibited: [...COMMON_PROHIBITED, "Automated connection requests or InMail"],
    ownerSetup: "Manual only. LinkedIn's posting APIs need partner approval and do not cover replying to other members' posts.",
    policyLinks: [{ label: "User Agreement (8.2 Don'ts)", url: "https://www.linkedin.com/legal/user-agreement" }],
    policyNotes: "LinkedIn prohibits scraping and bots. Manual only.",
    reviewedOn: REVIEWED,
  },
  forum("contractortalk", "Contractor Talk", "https://www.contractortalk.com/", ["contractortalk.com", "www.contractortalk.com"], ["Business", "Estimating", "Roofing", "Remodeling"], "high"),
  forum("painttalk", "PaintTalk", "https://www.painttalk.com/", ["painttalk.com", "www.painttalk.com"], ["Business", "Estimating"], "high"),
  forum("lawnsite", "LawnSite", "https://www.lawnsite.com/", ["lawnsite.com", "www.lawnsite.com"], ["Business", "Pressure washing"], "medium"),
  forum("woodweb", "WOODWEB", "https://woodweb.com/", ["woodweb.com", "www.woodweb.com"], ["Cabinetry", "Business"], "low"),
  forum("hvactalk", "HVAC-Talk", "https://hvac-talk.com/", ["hvac-talk.com", "www.hvac-talk.com"], ["Business"], "low"),
  forum("finehomebuilding", "Fine Homebuilding forums", "https://www.finehomebuilding.com/forum", ["finehomebuilding.com", "www.finehomebuilding.com"], ["Business", "Remodeling"], "medium"),
  forum("jobber", "Jobber Home Service Community", "https://community.getjobber.com/", ["community.getjobber.com", "getjobber.com"], ["Estimating", "Quotes"], "medium"),
  forum("sage", "Sage Construction Community", "https://communityhub.sage.com/", ["communityhub.sage.com"], ["Estimating"], "low"),
  forum("houzz", "Houzz Discussions", "https://www.houzz.com/discussions", ["houzz.com", "www.houzz.com"], ["Pros"], "low"),
  forum("trade_association", "Public trade association discussions", "https://www.nari.org/", [], ["Association forums the owner can post in"], "low", "association"),
  forum("other", "Other independent contractor forum", "", [], ["Any other public forum"], "low", "forum"),
];

const BY_KEY = new Map(SOURCES.map((s) => [s.key, s]));
export const getSource = (key: string): SourceDef | undefined => BY_KEY.get(key);
export const SOURCE_KEYS = SOURCES.map((s) => s.key) as [string, ...string[]];

/** Operational state recorded by the owner (public.radar_source_state). */
export interface SourceState {
  source_key: string;
  enabled: boolean;
  /** Owner confirms the platform approved automated discovery (e.g. Reddit app approval). */
  discovery_authorized: boolean;
  /** Owner confirms the platform approved API publishing and connected an account. */
  publish_authorized: boolean;
  /** Owner confirmed the community allows links to built2bid.org. */
  links_allowed: boolean | null;
  last_checked_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
}

export const defaultState = (key: string): SourceState => ({
  source_key: key, enabled: true, discovery_authorized: false, publish_authorized: false, links_allowed: null,
  last_checked_at: null, last_success_at: null, last_error: null,
});

export type Denied = { ok: false; reason: string };
export type Allowed = { ok: true };

/**
 * May the system read this source automatically (any connector, any schedule)?
 * Requires: an official API method, a non-forbidden gate, owner-recorded authorization, the source enabled,
 * and a connector implementation. No connector ships in this release, so this is false for every source today.
 */
export function canAutoDiscover(key: string, state: SourceState | undefined, connectorAvailable = false): Allowed | Denied {
  const s = getSource(key);
  if (!s) return { ok: false, reason: "Unknown source" };
  if (s.automatedDiscovery === "forbidden") return { ok: false, reason: `${s.platform}: automated discovery is prohibited. Use manual import.` };
  if (s.method !== "official_api") return { ok: false, reason: `${s.platform}: no official API connector. Use manual import.` };
  if (!state?.enabled) return { ok: false, reason: `${s.name} is turned off.` };
  if (!state.discovery_authorized) return { ok: false, reason: `${s.platform}: platform approval is not recorded. Use manual import.` };
  if (!connectorAvailable) return { ok: false, reason: `${s.platform}: connector not installed yet.` };
  return { ok: true };
}

/**
 * May an approved reply be published through an API? Even when true, publishing still needs an
 * owner-approved draft (enforced separately) and is only marked published once the platform confirms.
 */
export function canApiPublish(key: string, state: SourceState | undefined, publisherAvailable = false): Allowed | Denied {
  const s = getSource(key);
  if (!s) return { ok: false, reason: "Unknown source" };
  if (s.automatedPublish === "forbidden") return { ok: false, reason: `${s.platform}: automated publishing is prohibited. Copy the reply and post it yourself.` };
  if (!state?.enabled) return { ok: false, reason: `${s.name} is turned off.` };
  if (!state.publish_authorized) return { ok: false, reason: `${s.platform}: API publishing is not authorized. Copy the reply and post it yourself.` };
  if (!publisherAvailable) return { ok: false, reason: `${s.platform}: publisher not installed yet. Copy the reply and post it yourself.` };
  return { ok: true };
}

/** Links default to off unless the owner confirmed the community allows them (or the platform default allows them). */
export function linksAllowed(key: string, state: SourceState | undefined): boolean {
  const s = getSource(key);
  if (!s) return false;
  if (state?.links_allowed != null) return state.links_allowed;
  return s.linksAllowedByDefault;
}

/** Match a URL's host to a registered source. Unknown hosts go to "other". */
export function sourceForHost(host: string): SourceDef {
  const h = host.toLowerCase().replace(/\.$/, "");
  for (const s of SOURCES) {
    if (s.hosts.some((x) => h === x || h.endsWith(`.${x}`))) return s;
  }
  return BY_KEY.get("other")!;
}
