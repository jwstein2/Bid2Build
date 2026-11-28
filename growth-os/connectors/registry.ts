// Growth OS Connections Center: the connector registry (single source of truth).
//
// Everything here is documentation-grade data, not a claim that anything is connected. The live status of a
// connection comes only from the database (growth.connections + growth.connection_checks), written by the
// health-check task after a real API call. The SQL seed (growth-os/supabase/migrations/*_growth_connectors_seed.sql)
// is generated from this file by `npx tsx growth-os/connectors/gen-seed.ts`; a test fails if they drift.
//
// Labels used in `facts`: [platform-doc 2026-11-28] = read on the official docs page on that date;
// [platform-doc] = from platform docs as known, re-check before relying on it; [verified] = checked in our own
// systems; [reported] = from an earlier Growth OS thread; [estimate].

export const STATUSES = [
  "verified_operational",
  "limited",
  "awaiting_authorization",
  "awaiting_platform_approval",
  "unsupported",
] as const;
export type Status = (typeof STATUSES)[number];
/** Statuses a registry baseline may claim. Working statuses can only come from a health check. */
export type BaselineStatus = "awaiting_authorization" | "awaiting_platform_approval" | "unsupported";

export type AuthKind = "oauth2" | "manual_secret" | "internal" | "none";

export interface Operation {
  key: string;                 // provider-unique, e.g. "pages.insights"
  label: string;
  scopes: string[];            // every scope/permission the operation needs (pseudo-scopes for API keys)
  privileged: boolean;         // posting, messaging, ad management, business management writes, CRM writes
  phase: number;               // Growth OS phase that first uses it; badges roll up operations with phase <= 5
  baseline: BaselineStatus;    // what to show before any connection exists
  note?: string;
}

export interface Connector {
  provider: string;            // [a-z0-9_]+, also the connector name used by kill switches and run_steps
  name: string;
  group: string;               // the platform family it is shown under
  authKinds: AuthKind[];
  baseline: BaselineStatus;
  baselineReason: string;
  existing: string;            // what already exists (verified/reported)
  review: string;              // review / verification requirements
  limits: string;              // rate limits and quotas
  cost: string;
  refresh: "refresh_token" | "long_lived_exchange" | "never_expires" | "reauth" | "none";
  docs: string[];
  /** Plain-language steps for the administrator. Never asks anyone to paste a password, recovery or MFA code. */
  manualSteps: string[];
  /** Secret names (in Vault) for manual credentials. James pastes the value himself; nothing else ever sees it. */
  manualSecrets?: { name: string; what: string }[];
  operations: Operation[];
}

const META_GRAPH = "v23.0"; // [platform-doc] check the current Graph API version before go-live

export const CONNECTORS: Connector[] = [
  {
    provider: "meta_business",
    name: "Meta Business Portfolio",
    group: "Meta",
    authKinds: ["oauth2", "manual_secret"],
    baseline: "awaiting_authorization",
    baselineReason: "No Growth OS Meta app or token yet. The \"Built2Bid Growth OS\" Meta app (decision D2) must be created by James.",
    existing: "Ad account 121510736 and web dataset 1160624026325708 exist; James signs in through the Claude browser [reported]. No Growth OS token.",
    review: "Standard Access works for people with a role on the app. Advanced Access needs Business Verification and App Review per permission [platform-doc].",
    limits: "Graph API Business Use Case rate limits per app and ad account; usage returned in X-Business-Use-Case-Usage headers [platform-doc].",
    cost: "Free API.",
    refresh: "reauth",
    docs: ["https://developers.facebook.com/docs/marketing-api/overview/authorization", "https://developers.facebook.com/docs/graph-api/overview/rate-limiting"],
    manualSteps: [
      "Preferred (no expiry): Meta Business Settings → Users → System users → Add \"Growth OS (read)\" with the Employee role.",
      "Assign assets to it with View/Analyze access only: the Built2Bid Page, ad account 121510736 and the Built2Bid Website dataset.",
      "Click Generate token, pick the Built2Bid Growth OS app, tick only business_management and ads_read, and copy the token.",
      "In the staging Supabase dashboard → Vault, add a secret named growth_meta_business_system_user_token and paste the token there yourself. Do not paste it into Claude or chat.",
      "Back on the Connections page, choose Attach secret for Meta Business Portfolio. The health check runs at once.",
    ],
    manualSecrets: [{ name: "growth_meta_business_system_user_token", what: "System user token with business_management + ads_read" }],
    operations: [
      { key: "business.assets.read", label: "List business assets, Pages, ad accounts, datasets", scopes: ["business_management"], privileged: false, phase: 5, baseline: "awaiting_authorization" },
      { key: "ads.read", label: "Read ad accounts and ad reporting", scopes: ["ads_read"], privileged: false, phase: 5, baseline: "awaiting_authorization" },
      { key: "ads.manage", label: "Create or change ads and budgets", scopes: ["ads_management"], privileged: true, phase: 9, baseline: "awaiting_platform_approval", note: "Always risk tier 3: never automated, every change needs James." },
    ],
  },
  {
    provider: "facebook_pages",
    name: "Facebook Page and ads",
    group: "Meta",
    authKinds: ["oauth2"],
    baseline: "awaiting_authorization",
    baselineReason: "Needs the Growth OS Meta app and James's consent on Facebook's own screen.",
    existing: "Facebook Page id 61596515102500 [reported]. App's Facebook-trial Page token env var (not checked). Legacy Buffer channel in prod marketing.channels is needs_reauth [verified 11/24].",
    review: "pages_read_engagement, read_insights: Standard Access for Pages James manages; Advanced Access (App Review) to go beyond app roles [platform-doc].",
    limits: "Page-level Business Use Case limits [platform-doc].",
    cost: "Free API.",
    refresh: "long_lived_exchange",
    docs: ["https://developers.facebook.com/docs/pages-api/overview", "https://developers.facebook.com/docs/permissions"],
    manualSteps: [
      "On the Connections page choose Connect for Facebook Page. Facebook's own sign-in and consent screen opens.",
      "Sign in on facebook.com (never in Claude), pick only the Built2Bid Page, keep only the listed read permissions ticked, and approve.",
      "You return to the Connections page; the health check reads /me/permissions and shows any permission you unticked.",
    ],
    operations: [
      { key: "pages.list", label: "See which Pages the token can manage", scopes: ["pages_show_list"], privileged: false, phase: 5, baseline: "awaiting_authorization" },
      { key: "pages.insights", label: "Page posts, engagement and insights", scopes: ["pages_read_engagement", "read_insights"], privileged: false, phase: 5, baseline: "awaiting_authorization" },
      { key: "pages.ads_reporting", label: "Ad results for Page campaigns", scopes: ["ads_read"], privileged: false, phase: 5, baseline: "awaiting_authorization" },
      { key: "pages.publish", label: "Publish Page posts", scopes: ["pages_manage_posts"], privileged: true, phase: 7, baseline: "awaiting_authorization" },
      { key: "pages.engagement", label: "Reply to and moderate comments", scopes: ["pages_manage_engagement"], privileged: true, phase: 8, baseline: "awaiting_authorization" },
      { key: "pages.messaging", label: "Answer Page messages", scopes: ["pages_messaging"], privileged: true, phase: 8, baseline: "awaiting_platform_approval", note: "Messenger needs App Review and the 24-hour messaging window rules." },
    ],
  },
  {
    provider: "instagram",
    name: "Instagram professional account",
    group: "Meta",
    authKinds: ["oauth2"],
    baseline: "awaiting_authorization",
    baselineReason: "Instagram business account exists but its setup is still pending (James, 11/28). Connect uses Instagram Login, which does not need the Facebook Page link.",
    existing: "IG Business account \"built2bid\" (Software Company) [reported]. Not linked to the Page or OpusClip yet [reported 11/27].",
    review: "Standard Access for accounts the app owner manages; Advanced Access (App Review) for any other account [platform-doc 2026-11-28].",
    limits: "Publishing: 100 API-published posts per 24 h moving window (carousel section says 50); check GET /<IG_ID>/content_publishing_limit [platform-doc 2026-11-28].",
    cost: "Free API.",
    refresh: "refresh_token",
    docs: ["https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login", "https://developers.facebook.com/docs/instagram-platform/content-publishing/"],
    manualSteps: [
      "Make sure the Instagram account is a Business or Creator account (it is: Software Company).",
      "Add the Instagram account as an Instagram tester / asset on the Built2Bid Growth OS Meta app (App Dashboard → Instagram → API setup with Instagram login).",
      "On the Connections page choose Connect for Instagram. Instagram's own sign-in screen opens; sign in there (never in Claude) and approve the listed permissions.",
      "The long-lived token lasts 60 days; Growth OS refreshes it automatically after it is 24 hours old.",
    ],
    operations: [
      { key: "media.read", label: "Profile and media list", scopes: ["instagram_business_basic"], privileged: false, phase: 5, baseline: "awaiting_authorization" },
      { key: "insights.read", label: "Media and account insights", scopes: ["instagram_business_basic", "instagram_business_manage_insights"], privileged: false, phase: 5, baseline: "awaiting_authorization", note: "Insights scope name not shown on the pages read 11/28; confirm in the App Dashboard permission list." },
      { key: "content.publish", label: "Publish posts and reels", scopes: ["instagram_business_content_publish"], privileged: true, phase: 7, baseline: "awaiting_authorization" },
      { key: "comments.manage", label: "Reply to and hide comments", scopes: ["instagram_business_manage_comments"], privileged: true, phase: 8, baseline: "awaiting_authorization" },
      { key: "messages.manage", label: "Answer direct messages", scopes: ["instagram_business_manage_messages"], privileged: true, phase: 8, baseline: "awaiting_platform_approval" },
    ],
  },
  {
    provider: "tiktok_business",
    name: "TikTok ads (API for Business)",
    group: "TikTok",
    authKinds: ["oauth2"],
    baseline: "awaiting_platform_approval",
    baselineReason: "No TikTok for Business developer app yet. Application draft is ready (applications/05_tiktok_for_business.md) and waits for James to read and submit.",
    existing: "TikTok Business account exists [reported]. No developer app, no advertiser authorization.",
    review: "Developer app review by TikTok before advertisers can authorize it [platform-doc].",
    limits: "Per-app QPS limits on the Marketing API [platform-doc].",
    cost: "Free API.",
    refresh: "never_expires",
    docs: ["https://business-api.tiktok.com/portal/docs"],
    manualSteps: [
      "Read the application draft (phase5-connections/applications/05_tiktok_for_business.md) and submit it at business-api.tiktok.com under the Built2Bid business account.",
      "Once approved, store the app id in Vault as growth_tiktok_business_client_id and the app secret as growth_tiktok_business_client_secret (you paste them yourself).",
      "Choose Connect for TikTok ads; approve on TikTok's own screen with only Ad Account Management (read) and Reporting.",
    ],
    operations: [
      { key: "advertiser.read", label: "Advertiser accounts and info", scopes: ["advertiser.read"], privileged: false, phase: 5, baseline: "awaiting_platform_approval" },
      { key: "reporting.read", label: "Ad reporting", scopes: ["reporting.read"], privileged: false, phase: 5, baseline: "awaiting_platform_approval" },
      { key: "campaign.manage", label: "Create or change campaigns", scopes: ["campaign.manage"], privileged: true, phase: 9, baseline: "awaiting_platform_approval", note: "Risk tier 3." },
    ],
  },
  {
    provider: "tiktok_content",
    name: "TikTok account content (Login Kit)",
    group: "TikTok",
    authKinds: ["oauth2"],
    baseline: "awaiting_platform_approval",
    baselineReason: "Needs a TikTok for Developers app with Login Kit approved; Content Posting needs a separate audit or posts stay private.",
    existing: "TikTok account posted to through OpusClip (Claude-side) [reported]. No Growth OS app.",
    review: "App review for Login Kit scopes; Content Posting API audit before public posting [platform-doc].",
    limits: "Access token 2 h, refresh token 180 days and rotates on every refresh [platform-doc 2026-11-28].",
    cost: "Free API.",
    refresh: "refresh_token",
    docs: ["https://developers.tiktok.com/docs/en/oauth-user-access-token-management", "https://developers.tiktok.com/docs/en/scopes-overview"],
    manualSteps: [
      "Create an app at developers.tiktok.com under the Built2Bid account and request Login Kit with user.info.basic and video.list.",
      "Paste the client key and secret into Vault yourself as growth_tiktok_content_client_id / growth_tiktok_content_client_secret.",
      "Choose Connect for TikTok content and approve on TikTok's own screen.",
    ],
    operations: [
      { key: "profile.read", label: "Account profile", scopes: ["user.info.basic"], privileged: false, phase: 5, baseline: "awaiting_platform_approval" },
      { key: "videos.read", label: "Video list and public stats", scopes: ["video.list"], privileged: false, phase: 5, baseline: "awaiting_platform_approval" },
      { key: "videos.publish", label: "Publish videos", scopes: ["video.publish"], privileged: true, phase: 7, baseline: "awaiting_platform_approval", note: "Private-only until TikTok's Content Posting audit passes." },
    ],
  },
  {
    provider: "youtube",
    name: "YouTube channel",
    group: "Google",
    authKinds: ["oauth2"],
    baseline: "awaiting_authorization",
    baselineReason: "Needs a Google Cloud OAuth client for Growth OS and James's consent on Google's screen.",
    existing: "Channel @Built2Bid UCygpeFVjUVYNpmDpoXxFEXg [reported]. The app has a public-data YouTube API key for affiliates (not an account connection).",
    review: "Sensitive scopes need Google OAuth app verification for external users; while the OAuth app is in Testing, refresh tokens expire after 7 days. Uploads from unverified API projects stay private until an API audit [platform-doc].",
    limits: "10,000 quota units/day by default; a read costs 1 unit, an upload far more [platform-doc].",
    cost: "Free API.",
    refresh: "refresh_token",
    docs: ["https://developers.google.com/youtube/v3/guides/authentication", "https://developers.google.com/youtube/v3/determine_quota_cost"],
    manualSteps: [
      "In Google Cloud (project owned by the Built2Bid Google login), enable YouTube Data API v3 and YouTube Analytics API, and create an OAuth client of type Web application with the Growth OS callback URL shown on the Connections page.",
      "Paste the client id and secret into Vault yourself as growth_google_client_id / growth_google_client_secret.",
      "Choose Connect for YouTube and sign in on Google's screen with the login that owns @Built2Bid, then pick the Built2Bid channel.",
    ],
    operations: [
      { key: "channel.read", label: "Channel and video list", scopes: ["https://www.googleapis.com/auth/youtube.readonly"], privileged: false, phase: 5, baseline: "awaiting_authorization" },
      { key: "analytics.read", label: "Views, watch time, traffic sources", scopes: ["https://www.googleapis.com/auth/yt-analytics.readonly"], privileged: false, phase: 5, baseline: "awaiting_authorization" },
      { key: "videos.upload", label: "Upload videos", scopes: ["https://www.googleapis.com/auth/youtube.upload"], privileged: true, phase: 7, baseline: "awaiting_authorization", note: "Private-only until the YouTube API audit." },
      { key: "comments.manage", label: "Reply to comments", scopes: ["https://www.googleapis.com/auth/youtube.force-ssl"], privileged: true, phase: 8, baseline: "awaiting_authorization" },
    ],
  },
  {
    provider: "google_ads",
    name: "Google Ads",
    group: "Google",
    authKinds: ["oauth2"],
    baseline: "awaiting_platform_approval",
    baselineReason: "Google Ads account is still in the setup wizard and the Cloud project has no Google Ads API access level beyond Test.",
    existing: "Ads account stuck in setup wizard; no manager account [reported 11/24].",
    review: "API access is set per Cloud project since developer tokens sunset on 2026-09-09: Test (test accounts only, automatic), Explorer (production, 2,880 ops/day, usually automated approval), Basic (15,000 ops/day, needs brand verification), Standard (manual audit) [platform-doc 2026-11-28].",
    limits: "Test 15,000 ops/day on test accounts; Explorer 2,880 production ops/day; Basic 15,000 [platform-doc 2026-11-28].",
    cost: "Free API. Keyword Planner volumes need an Ads account with billing (James chose benchmarks instead, 11/23).",
    refresh: "refresh_token",
    docs: ["https://developers.google.com/google-ads/api/docs/access-levels", "https://developers.google.com/ads/blog/posts/2025/10/explorer-access-is-now-available-for"],
    manualSteps: [
      "Finish or skip the Google Ads setup wizard without entering billing (no spend is approved).",
      "In the same Google Cloud project as YouTube, enable the Google Ads API and apply for Explorer access in the console (free).",
      "Give the Google login you will connect Read-only access on the Ads account, so the token cannot change anything even by mistake.",
      "Choose Connect for Google Ads and approve on Google's screen.",
    ],
    operations: [
      { key: "accounts.read", label: "Accessible accounts, campaigns and reports", scopes: ["https://www.googleapis.com/auth/adwords"], privileged: false, phase: 5, baseline: "awaiting_platform_approval", note: "The adwords scope can write; read-only is enforced by the Read-only account role and by code." },
      { key: "campaigns.manage", label: "Create or change campaigns and budgets", scopes: ["https://www.googleapis.com/auth/adwords"], privileged: true, phase: 9, baseline: "awaiting_platform_approval", note: "Risk tier 3." },
    ],
  },
  {
    provider: "linkedin",
    name: "LinkedIn organization page and ads",
    group: "LinkedIn",
    authKinds: ["oauth2"],
    baseline: "awaiting_platform_approval",
    baselineReason: "Community Management API and Advertising API access must be requested and approved by LinkedIn (drafts ready in applications/03 and 04).",
    existing: "Company page 144185331 [reported]. Never touch the Bolt Global org 107777198.",
    review: "Each API product needs an access request; Community Management must be the only product on its app; refresh tokens only for approved Marketing Developer Platform partners [platform-doc 2026-11-28].",
    limits: "Access token 60 days, refresh token 365 days (not extended by refreshing) [platform-doc 2026-11-28]. Daily per-app and per-member call limits [platform-doc].",
    cost: "Free API.",
    refresh: "refresh_token",
    docs: ["https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens", "https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-api-migration-guide"],
    manualSteps: [
      "Read the drafts in phase5-connections/applications/03 and 04, then create the LinkedIn developer app linked to page 144185331 and submit the access requests.",
      "A page admin verifies the app from the LinkedIn page admin view.",
      "Paste the client id and secret into Vault yourself as growth_linkedin_client_id / growth_linkedin_client_secret, then choose Connect for LinkedIn.",
    ],
    operations: [
      { key: "org.posts.read", label: "Organization posts and social stats", scopes: ["r_organization_social"], privileged: false, phase: 5, baseline: "awaiting_platform_approval" },
      { key: "org.admin.read", label: "Page followers and admin data", scopes: ["r_organization_admin"], privileged: false, phase: 5, baseline: "awaiting_platform_approval" },
      { key: "ads.reporting", label: "Ad accounts and reporting", scopes: ["r_ads", "r_ads_reporting"], privileged: false, phase: 5, baseline: "awaiting_platform_approval" },
      { key: "org.publish", label: "Post as the organization", scopes: ["w_organization_social"], privileged: true, phase: 7, baseline: "awaiting_platform_approval" },
      { key: "ads.manage", label: "Create or change campaigns", scopes: ["rw_ads"], privileged: true, phase: 9, baseline: "awaiting_platform_approval", note: "Risk tier 3." },
    ],
  },
  {
    provider: "google_workspace",
    name: "Google Workspace (Drive and Sheets)",
    group: "Google",
    authKinds: ["oauth2"],
    baseline: "awaiting_authorization",
    baselineReason: "Optional. Needs the Growth OS Google OAuth client and consent; drive.file only sees files Growth OS creates or you pick.",
    existing: "Claude has Drive/Docs/Sheets connectors (Claude-side, not usable by the unattended worker) [verified]. Drive folder G:\\My Drive\\Built2bid is used for video drops [reported].",
    review: "drive.file is non-sensitive (basic verification). Gmail scopes are restricted and need a paid security assessment, so they are not offered [platform-doc].",
    limits: "Drive API per-user quotas [platform-doc].",
    cost: "Free API.",
    refresh: "refresh_token",
    docs: ["https://developers.google.com/drive/api/guides/api-specific-auth"],
    manualSteps: ["Uses the same Google OAuth client as YouTube. Choose Connect for Google Workspace and approve on Google's screen."],
    operations: [
      { key: "drive.export", label: "Write reports into files Growth OS creates", scopes: ["https://www.googleapis.com/auth/drive.file"], privileged: false, phase: 5, baseline: "awaiting_authorization" },
      { key: "sheets.write", label: "Update any spreadsheet you own", scopes: ["https://www.googleapis.com/auth/spreadsheets"], privileged: true, phase: 6, baseline: "awaiting_authorization" },
      { key: "gmail", label: "Read or send Gmail", scopes: ["https://www.googleapis.com/auth/gmail.send"], privileged: true, phase: 99, baseline: "unsupported", note: "Not offered: restricted scope (paid assessment) and outbound email goes through approved templates only." },
    ],
  },
  {
    provider: "supabase",
    name: "Built2Bid Supabase (Growth OS database)",
    group: "Built2Bid",
    authKinds: ["internal"],
    baseline: "awaiting_authorization",
    baselineReason: "The worker logs in as growth_worker; on staging its password still has to be copied from Vault into the Edge Function secret GROWTH_DB_PASSWORD by James (Phase 4 blocker).",
    existing: "Staging project built2bid-growth-staging (nkpnfpxrvukfqwgbbwrs) with growth schemas; production has no growth schema [verified 11/28].",
    review: "None.",
    limits: "Micro compute on staging [verified].",
    cost: "Staging ~$10/month [reported]; no new cost.",
    refresh: "none",
    docs: ["https://supabase.com/docs/guides/database/postgres/roles"],
    manualSteps: [
      "Staging dashboard → Vault → copy the value of growth_worker_db_password yourself.",
      "Edge Functions → Secrets → add GROWTH_DB_PASSWORD with that value (and the same for growth-oauth). The next health check marks this connection verified.",
    ],
    operations: [
      { key: "growth_read", label: "Read funnel and acquisition data (growth_read views)", scopes: ["growth_read"], privileged: false, phase: 5, baseline: "awaiting_authorization" },
      { key: "crm.apply", label: "Apply an approved CRM change", scopes: ["growth_api.crm_apply"], privileged: true, phase: 8, baseline: "awaiting_authorization", note: "Each change needs its own human approval bound to the payload hash." },
    ],
  },
  {
    provider: "ga4_gtm",
    name: "GA4, Search Console and Tag Manager",
    group: "Google",
    authKinds: ["manual_secret"],
    baseline: "awaiting_authorization",
    baselineReason: "GA4 property G-2KJ9K3FX07 belongs to a Google login other than jwstein2@gmail.com; that login must add the Growth OS service account as Viewer.",
    existing: "GA4 tag fires on built2bid.org [verified 11/24]. App reads GA4/GSC with GOOGLE_SERVICE_ACCOUNT_JSON when set (not checked). No GTM container: the site loads gtag.js directly [verified].",
    review: "None for service accounts with Viewer access.",
    limits: "GA4 Data API token quotas per property (core: 200,000 tokens/day) [platform-doc].",
    cost: "Free API.",
    refresh: "none",
    docs: ["https://developers.google.com/analytics/devguides/reporting/data/v1/quotas"],
    manualSteps: [
      "In Google Cloud, create a service account \"growth-os-reader\" (no roles needed in Cloud) and create a JSON key.",
      "Sign in to GA4 with the login that owns the property, Admin → Property access management → add the service account email as Viewer. Add it as a Restricted user in Search Console too.",
      "Paste the whole JSON key into Vault yourself as growth_ga4_gtm_service_account, then choose Attach secret and enter the GA4 numeric property id as the account.",
    ],
    manualSecrets: [{ name: "growth_ga4_gtm_service_account", what: "Service account JSON key (Viewer on GA4, restricted user in Search Console)" }],
    operations: [
      { key: "ga4.report", label: "Sessions, channels, conversions", scopes: ["https://www.googleapis.com/auth/analytics.readonly"], privileged: false, phase: 5, baseline: "awaiting_authorization" },
      { key: "gsc.report", label: "Search Console queries and pages", scopes: ["https://www.googleapis.com/auth/webmasters.readonly"], privileged: false, phase: 5, baseline: "awaiting_authorization" },
      { key: "ga4.key_events.edit", label: "Mark key events", scopes: ["https://www.googleapis.com/auth/analytics.edit"], privileged: true, phase: 6, baseline: "awaiting_authorization", note: "One-off admin action; better done by hand in GA4." },
      { key: "gtm.read", label: "Tag Manager container", scopes: ["https://www.googleapis.com/auth/tagmanager.readonly"], privileged: false, phase: 99, baseline: "unsupported", note: "No GTM container exists; the site loads gtag.js directly." },
    ],
  },
  {
    provider: "stripe",
    name: "Stripe revenue data",
    group: "Built2Bid",
    authKinds: ["manual_secret"],
    baseline: "awaiting_authorization",
    baselineReason: "Growth OS needs its own read-only restricted key; it never uses the app's full secret key.",
    existing: "The app uses a full live secret key for billing [verified]. Last stripe_events row 2026-11-13 [verified 11/24].",
    review: "None.",
    limits: "About 100 read requests/second in live mode [platform-doc].",
    cost: "Free API.",
    refresh: "none",
    docs: ["https://docs.stripe.com/keys#create-restricted-api-secret-key"],
    manualSteps: [
      "Stripe Dashboard → Developers → API keys → Create restricted key named \"Growth OS read\".",
      "Set Read on Customers, Subscriptions, Invoices, Charges and Balance transactions; leave everything else None.",
      "Copy the rk_live_ key and paste it into Vault yourself as growth_stripe_restricted_key (staging may use an rk_test_ key). Then choose Attach secret.",
    ],
    manualSecrets: [{ name: "growth_stripe_restricted_key", what: "Restricted key, read-only on 5 resources" }],
    operations: [
      { key: "revenue.read", label: "MRR, churn, invoices and charges", scopes: ["read:customers", "read:subscriptions", "read:invoices", "read:charges", "read:balance_transactions"], privileged: false, phase: 5, baseline: "awaiting_authorization" },
      { key: "billing.write", label: "Change prices, refunds or subscriptions", scopes: ["write:any"], privileged: true, phase: 99, baseline: "unsupported", note: "Growth OS never writes to Stripe; money moves are tier 3." },
    ],
  },
  {
    provider: "buffer",
    name: "Buffer (social scheduler)",
    group: "Publishing",
    authKinds: ["manual_secret"],
    baseline: "awaiting_authorization",
    baselineReason: "James generated a Buffer API key on 11/28 for Claude's Buffer connector; Growth OS needs its own copy in Vault, pasted by James.",
    existing: "Buffer free plan with FB Page + LinkedIn channels, used by Claude sessions [reported 11/28]. Legacy prod marketing.channels row needs_reauth [verified 11/24].",
    review: "None.",
    limits: "Free plan: 3 channels, 10 scheduled posts per channel [reported]. API rate limit per client [platform-doc].",
    cost: "Free plan; paid tiers only with James's OK.",
    refresh: "none",
    docs: ["https://developers.buffer.com"],
    manualSteps: ["Buffer → Settings → API → create a key named Growth OS, paste it into Vault yourself as growth_buffer_api_key, then choose Attach secret."],
    manualSecrets: [{ name: "growth_buffer_api_key", what: "Buffer API key" }],
    operations: [
      { key: "queue.read", label: "Channels and queued posts", scopes: ["buffer:read"], privileged: false, phase: 5, baseline: "awaiting_authorization" },
      { key: "queue.publish", label: "Add posts to the queue", scopes: ["buffer:write"], privileged: true, phase: 7, baseline: "awaiting_authorization" },
    ],
  },
  {
    provider: "video_tools",
    name: "Authorized video creation tools",
    group: "Publishing",
    authKinds: ["none"],
    baseline: "unsupported",
    baselineReason: "OpusClip and Streamlabs are in use, but neither offers a self-serve API an unattended worker can use. Claude sessions use OpusClip through its connector; Growth OS does not.",
    existing: "OpusClip Pro yearly and Streamlabs Ultra yearly bought by James 11/27 [reported]. OpusClip connector works in Claude sessions; Streamlabs records to the Drive drop folder [reported].",
    review: "Per tool.",
    limits: "OpusClip plan credits [reported].",
    cost: "Already paid by James; no new cost.",
    refresh: "none",
    docs: [],
    manualSteps: ["Nothing to connect. If a tool later offers an official API key, add it here as a manual secret after James approves."],
    operations: [
      { key: "opusclip.clips", label: "OpusClip clips and scheduling", scopes: [], privileged: false, phase: 5, baseline: "unsupported", note: "Claude-side connector only; every scheduled post still needs James's approval link." },
      { key: "streamlabs.recordings", label: "Streamlabs recordings", scopes: [], privileged: false, phase: 5, baseline: "unsupported", note: "Recordings arrive through the Drive drop folder, not an API." },
    ],
  },
];

export const connectorByProvider = new Map(CONNECTORS.map((c) => [c.provider, c]));

/** Scopes a connection must hold for its phase-5 (read) operations. */
export function readScopes(c: Connector): string[] {
  return [...new Set(c.operations.filter((o) => !o.privileged && o.phase <= 5 && o.baseline !== "unsupported").flatMap((o) => o.scopes))];
}
export function privilegedScopes(c: Connector): string[] {
  const read = new Set(readScopes(c));
  return [...new Set(c.operations.filter((o) => o.privileged && o.baseline !== "unsupported").flatMap((o) => o.scopes))].filter((s) => !read.has(s));
}
export { META_GRAPH };
