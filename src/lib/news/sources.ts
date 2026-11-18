import type { Authority, Category, GeoLevel, SummaryPolicy } from "./types";

/**
 * Industry Intelligence source registry and rights matrix.
 *
 * Like the Opportunity Radar registry, the rules live in code (reviewed in pull requests), not in the
 * database, so no database edit can loosen a copyright or access rule. The database only stores
 * operational state per source (enabled, owner corrections to trades/geo/categories, last run, errors).
 *
 * Only free, official feeds or APIs a publisher offers for this purpose. No scraping, no paywalled
 * content, no bot-protection bypass, no paid news APIs. Each feed URL below was opened in a real
 * browser on 2026-11-18 and returned a valid RSS/JSON document with dated, per-article links.
 */

export type SourceFormat = "rss" | "federal_register" | "openfema";
export type Cadence = "daily" | "several_weekly" | "weekly";

export interface NewsSourceDef {
  key: string;
  name: string;               // shown as the publisher
  owner: string;              // organization behind it
  homepage: string;
  feedUrl: string;
  format: SourceFormat;
  /** Hosts an article link may point at. A link to any other host is rejected as unverified. */
  hosts: string[];
  authority: Authority;
  summaryPolicy: SummaryPolicy;
  defaultGeo: GeoLevel;
  /** Regional trade-press feeds (e.g. ACHR "Midwest") tag every item with these regions. */
  regions?: string[];
  /** Trades every item is relevant to before keyword matching (empty: keywords decide). */
  trades: string[];
  categories: Category[];
  cadence: Cadence;
  /** Days we keep an item's metadata before it is deleted (publisher terms or our own default). */
  retentionDays: number;
  maxItemsPerRun: number;
  /** Items must mention construction to be kept (broad government feeds). */
  requireConstructionRelevance: boolean;
  rights: string;             // what we may do and why
  termsUrl: string;
  reviewedOn: string;
}

const REVIEWED = "2026-11-18";
const FR = "https://www.federalregister.gov";
const FR_FIELDS = ["title", "abstract", "html_url", "publication_date", "effective_on", "type", "agencies", "document_number", "action"]
  .map((f) => `fields[]=${f}`).join("&");
const frFeed = (agency: string, types = ["RULE", "PRORULE", "NOTICE"]) =>
  `${FR}/api/v1/documents.json?per_page=40&order=newest&conditions[agencies][]=${agency}&${types.map((t) => `conditions[type][]=${t}`).join("&")}&${FR_FIELDS}`;

const FEDERAL_RIGHTS = "Works of the U.S. federal government are in the public domain (17 U.S.C. § 105). The Federal Register API is free, keyless and offered for reuse. We store the agency abstract (not the full document) and may write a short original summary from it, always linking the official document.";
const PRESS_RIGHTS = "Publisher RSS feed offered for subscribers and readers. We show the headline, the publisher's own short description (trimmed) and a link to the original article. No AI rewriting, no full text, no images beyond what the feed supplies as a thumbnail. Summaries need the publisher's written permission first.";

const press = (d: Omit<NewsSourceDef, "authority" | "summaryPolicy" | "defaultGeo" | "cadence" | "retentionDays" | "maxItemsPerRun" | "requireConstructionRelevance" | "rights" | "reviewedOn"> & Partial<NewsSourceDef>): NewsSourceDef => ({
  authority: "industry", summaryPolicy: "snippet", defaultGeo: "national", cadence: "daily", retentionDays: 120, maxItemsPerRun: 40,
  requireConstructionRelevance: false, rights: PRESS_RIGHTS, reviewedOn: REVIEWED, ...d,
});

export const NEWS_SOURCES: NewsSourceDef[] = [
  // ---- Official (public domain) --------------------------------------------------------------------------
  {
    key: "fr-osha", name: "Federal Register — OSHA", owner: "Occupational Safety and Health Administration", homepage: `${FR}/agencies/occupational-safety-and-health-administration`,
    feedUrl: frFeed("occupational-safety-and-health-administration"), format: "federal_register", hosts: ["federalregister.gov", "www.federalregister.gov"],
    authority: "official", summaryPolicy: "ai_summary", defaultGeo: "national", trades: [], categories: ["safety"], cadence: "daily", retentionDays: 365, maxItemsPerRun: 40,
    requireConstructionRelevance: false, rights: FEDERAL_RIGHTS, termsUrl: `${FR}/reader-aids/developer-resources/rest-api`, reviewedOn: REVIEWED,
  },
  {
    key: "fr-doe-eere", name: "Federal Register — DOE Energy Efficiency", owner: "U.S. Department of Energy, Office of Energy Efficiency and Renewable Energy", homepage: `${FR}/agencies/energy-efficiency-and-renewable-energy-office`,
    feedUrl: frFeed("energy-efficiency-and-renewable-energy-office", ["RULE", "PRORULE"]), format: "federal_register", hosts: ["federalregister.gov", "www.federalregister.gov"],
    authority: "official", summaryPolicy: "ai_summary", defaultGeo: "national", trades: [], categories: ["building_codes"], cadence: "daily", retentionDays: 365, maxItemsPerRun: 40,
    requireConstructionRelevance: true, rights: FEDERAL_RIGHTS, termsUrl: `${FR}/reader-aids/developer-resources/rest-api`, reviewedOn: REVIEWED,
  },
  {
    key: "fr-epa", name: "Federal Register — EPA", owner: "U.S. Environmental Protection Agency", homepage: `${FR}/agencies/environmental-protection-agency`,
    feedUrl: frFeed("environmental-protection-agency", ["RULE", "PRORULE"]), format: "federal_register", hosts: ["federalregister.gov", "www.federalregister.gov"],
    authority: "official", summaryPolicy: "ai_summary", defaultGeo: "national", trades: [], categories: ["licensing_regulations"], cadence: "daily", retentionDays: 365, maxItemsPerRun: 40,
    // EPA publishes hundreds of state air-plan approvals; keep only items that are about building work.
    requireConstructionRelevance: true, rights: FEDERAL_RIGHTS, termsUrl: `${FR}/reader-aids/developer-resources/rest-api`, reviewedOn: REVIEWED,
  },
  {
    key: "fr-dol-whd", name: "Federal Register — Wage and Hour Division", owner: "U.S. Department of Labor, Wage and Hour Division", homepage: `${FR}/agencies/wage-and-hour-division`,
    feedUrl: frFeed("wage-and-hour-division"), format: "federal_register", hosts: ["federalregister.gov", "www.federalregister.gov"],
    authority: "official", summaryPolicy: "ai_summary", defaultGeo: "national", trades: [], categories: ["labor_workforce"], cadence: "several_weekly", retentionDays: 365, maxItemsPerRun: 30,
    requireConstructionRelevance: false, rights: FEDERAL_RIGHTS, termsUrl: `${FR}/reader-aids/developer-resources/rest-api`, reviewedOn: REVIEWED,
  },
  {
    key: "osha-news", name: "OSHA News Releases", owner: "Occupational Safety and Health Administration", homepage: "https://www.osha.gov/news/newsreleases",
    feedUrl: "https://www.osha.gov/news/newsreleases.xml", format: "rss", hosts: ["osha.gov", "www.osha.gov", "dol.gov", "www.dol.gov"],
    // The feed's description is only the release date, so there is no text to summarize: headline + link only.
    authority: "official", summaryPolicy: "headline", defaultGeo: "national", trades: [], categories: ["safety"], cadence: "daily", retentionDays: 365, maxItemsPerRun: 30,
    requireConstructionRelevance: true, rights: FEDERAL_RIGHTS, termsUrl: "https://www.dol.gov/general/aboutdol/copyright", reviewedOn: REVIEWED,
  },
  {
    key: "fema-declarations", name: "FEMA Disaster Declarations", owner: "Federal Emergency Management Agency (OpenFEMA)", homepage: "https://www.fema.gov/disaster/declarations",
    feedUrl: "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$orderby=declarationDate%20desc&$top=400&$select=disasterNumber,state,declarationType,declarationDate,incidentType,declarationTitle,incidentBeginDate,incidentEndDate,fipsStateCode,fipsCountyCode,designatedArea,iaProgramDeclared,paProgramDeclared,ihProgramDeclared",
    format: "openfema", hosts: ["fema.gov", "www.fema.gov"],
    authority: "official", summaryPolicy: "structured", defaultGeo: "local", trades: ["roofing", "siding", "gutters", "windows-doors", "exterior-remodeling", "fencing", "foundations", "basements", "general-contracting", "demolition", "pole-barns", "landscaping", "excavation", "handyman"],
    categories: ["disaster_recovery", "local_construction"], cadence: "daily", retentionDays: 365, maxItemsPerRun: 60,
    requireConstructionRelevance: false, rights: "OpenFEMA data is public U.S. government data offered for reuse without a key. We store the declaration fields and build a factual sentence from them; each item links the official FEMA disaster page.", termsUrl: "https://www.fema.gov/about/openfema/terms-conditions", reviewedOn: REVIEWED,
  },
  // ---- Industry: associations' public feeds and trade press (headline + publisher description) -----------
  press({ key: "nahb-eye-on-housing", name: "Eye on Housing (NAHB)", owner: "National Association of Home Builders", homepage: "https://eyeonhousing.org", feedUrl: "https://eyeonhousing.org/feed/", format: "rss",
    hosts: ["eyeonhousing.org", "www.eyeonhousing.org"], trades: ["general-contracting", "additions", "framing"], categories: ["housing_market", "trade_association", "residential_construction"], cadence: "several_weekly", termsUrl: "https://www.nahb.org/terms-of-use" }),
  press({ key: "construction-dive", name: "Construction Dive", owner: "Industry Dive", homepage: "https://www.constructiondive.com", feedUrl: "https://www.constructiondive.com/feeds/news/", format: "rss",
    hosts: ["constructiondive.com", "www.constructiondive.com"], trades: [], categories: ["commercial_construction"], termsUrl: "https://www.industrydive.com/terms-of-use/" }),
  press({ key: "jlc", name: "JLC (Journal of Light Construction)", owner: "Zonda", homepage: "https://www.jlconline.com", feedUrl: "https://www.jlconline.com/feed/", format: "rss",
    hosts: ["jlconline.com", "www.jlconline.com"], trades: [], categories: ["residential_construction"], cadence: "several_weekly", termsUrl: "https://www.jlconline.com/terms-of-use" }),
  press({ key: "achr-news", name: "The ACHR News", owner: "BNP Media", homepage: "https://www.achrnews.com", feedUrl: "https://www.achrnews.com/rss/16", format: "rss",
    hosts: ["achrnews.com", "www.achrnews.com"], trades: ["hvac"], categories: [], termsUrl: "https://www.achrnews.com/terms-of-use" }),
  press({ key: "roofing-contractor", name: "Roofing Contractor", owner: "BNP Media", homepage: "https://www.roofingcontractor.com", feedUrl: "https://www.roofingcontractor.com/rss/16", format: "rss",
    hosts: ["roofingcontractor.com", "www.roofingcontractor.com"], trades: ["roofing"], categories: [], termsUrl: "https://www.roofingcontractor.com/terms-of-use" }),
  press({ key: "pm-mag", name: "Plumbing & Mechanical", owner: "BNP Media", homepage: "https://www.pmmag.com", feedUrl: "https://www.pmmag.com/rss/17", format: "rss",
    hosts: ["pmmag.com", "www.pmmag.com"], trades: ["plumbing"], categories: [], termsUrl: "https://www.pmmag.com/terms-of-use" }),
  press({ key: "walls-ceilings", name: "Walls & Ceilings", owner: "BNP Media", homepage: "https://www.wconline.com", feedUrl: "https://www.wconline.com/rss/17", format: "rss",
    hosts: ["wconline.com", "www.wconline.com"], trades: ["drywall"], categories: [], cadence: "several_weekly", termsUrl: "https://www.wconline.com/terms-of-use" }),
  press({ key: "landscape-management", name: "Landscape Management", owner: "North Coast Media", homepage: "https://www.landscapemanagement.net", feedUrl: "https://www.landscapemanagement.net/feed/", format: "rss",
    hosts: ["landscapemanagement.net", "www.landscapemanagement.net"], trades: ["landscaping"], categories: [], termsUrl: "https://www.landscapemanagement.net/terms-of-use/" }),
  press({ key: "lawn-landscape", name: "Lawn & Landscape", owner: "GIE Media", homepage: "https://www.lawnandlandscape.com", feedUrl: "https://www.lawnandlandscape.com/rss/", format: "rss",
    hosts: ["lawnandlandscape.com", "www.lawnandlandscape.com"], trades: ["landscaping"], categories: [], termsUrl: "https://www.lawnandlandscape.com/terms" }),
  press({ key: "fcnews", name: "Floor Covering News", owner: "Floor Covering News", homepage: "https://www.fcnews.net", feedUrl: "https://www.fcnews.net/feed/", format: "rss",
    hosts: ["fcnews.net", "www.fcnews.net"], trades: ["flooring"], categories: [], termsUrl: "https://www.fcnews.net" }),
  press({ key: "forconstructionpros", name: "For Construction Pros", owner: "Endeavor Business Media", homepage: "https://www.forconstructionpros.com", feedUrl: "https://www.forconstructionpros.com/rss", format: "rss",
    hosts: ["forconstructionpros.com", "www.forconstructionpros.com"], trades: [], categories: [], termsUrl: "https://www.endeavorbusinessmedia.com/terms-of-service" }),
];

const BY_KEY = new Map(NEWS_SOURCES.map((s) => [s.key, s]));
export const newsSource = (key: string): NewsSourceDef | undefined => BY_KEY.get(key);

/**
 * Sources we looked at and did NOT enable, with the reason. Shown on the owner Source Health page so
 * nobody re-adds one without checking. Associations without a public feed are reachable as links only.
 */
export const UNAVAILABLE_SOURCES: { name: string; url: string; reason: string }[] = [
  { name: "NRCA, NECA, ACCA, PHCC, NALP, PCA, ACI, ASCC, AGC newsrooms", url: "https://www.nrca.net", reason: "No public RSS/API feed verified. Newsroom pages are not scraped; listed as references only." },
  { name: "Qualified Remodeler", url: "https://www.qualifiedremodeler.com", reason: "Feed sits behind a bot-protection challenge. We do not bypass bot protection." },
  { name: "EC&M (electrical)", url: "https://www.ecmweb.com", reason: "No working public feed URL found (rss.xml returns 404)." },
  { name: "Electrical Contractor (NECA)", url: "https://www.ecmag.com", reason: "No working public feed URL found (rss.xml returns 404)." },
  { name: "Professional Remodeler", url: "https://www.proremodeler.com", reason: "No working public feed URL found (rss.xml returns 404)." },
  { name: "Masonry Magazine", url: "https://www.masonrymagazine.com", reason: "Feed URL redirects to an HTML page, not a feed." },
  { name: "BLS Latest Numbers", url: "https://www.bls.gov/feed/bls_latest.rss", reason: "Items link to the BLS homepage, not a specific release, so links can't be verified per article." },
  { name: "The New York Times and other major newspapers", url: "https://developer.nytimes.com", reason: "Needs an API agreement/key and its terms limit display and caching. Not enabled without the owner's approval." },
  { name: "Google News RSS", url: "https://news.google.com", reason: "Aggregator links redirect through Google and its terms restrict reuse. We link original publishers instead." },
  { name: "Reddit and contractor forums", url: "https://www.reddit.com/r/Contractor/", reason: "Requires an approved API app (see Opportunity Radar). Community posts would be labeled Community Discussion, never guidance." },
  { name: "Paid news APIs (NewsAPI, GDELT add-ons, Bing News)", url: "https://newsapi.org", reason: "Paid or terms-limited. Not activated without explicit owner approval." },
  { name: "State and municipal agencies", url: "https://www.usa.gov/state-governments", reason: "Feeds vary by state; none verified yet. Add per state in this file after checking each feed and its terms." },
];

export const AUTHORITY_LABEL: Record<Authority, string> = { official: "Official", industry: "Industry", local_news: "Local News", community: "Community Discussion" };
export const AUTHORITY_HELP: Record<Authority, string> = {
  official: "Government agency, published regulation or official announcement.",
  industry: "Trade association or established construction-industry publication.",
  local_news: "Established regional news organization.",
  community: "Forum or user discussion. Not verified guidance.",
};

export const CADENCE_HOURS: Record<Cadence, number> = { daily: 20, several_weekly: 44, weekly: 160 };
