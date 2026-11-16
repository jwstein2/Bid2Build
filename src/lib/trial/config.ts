/**
 * Facebook comment-to-trial funnel: settings. Everything is OFF until FB_TRIAL_ENABLED=true, so the
 * code can ship while the Meta campaign stays paused. Secrets are read from the environment only and
 * never logged.
 *
 *   FB_TRIAL_ENABLED=true            master switch (Messenger webhook replies, ManyChat endpoint, emails)
 *   TRIAL_CLAIM_PAGE_ENABLED=true    also open the public /trial claim page (off by default, needs the
 *                                    master switch too). While off, /trial is a 404.
 *   META_APP_ID                      the Meta app's id (not secret)
 *   META_APP_SECRET                  secret: verifies webhook signatures, appsecret_proof
 *   META_PAGE_ID                     the Built2Bid Facebook Page id (not secret)
 *   META_PAGE_ACCESS_TOKEN           secret: Page token with pages_messaging etc.
 *   META_VERIFY_TOKEN                secret: any long random string, also typed into the Meta dashboard
 *   META_TEST_POST_IDS               comma list of organic Page test post ids ("<page>_<post>")
 *   META_AD_POST_IDS                 comma list of the paid ad's post ids (effective_object_story_id)
 *   META_GRAPH_VERSION               default v26.0
 *   MANYCHAT_TRIAL_SECRET            secret: bearer for the ManyChat External Request (only if used)
 *   TRIAL_INVITE_SECRET              optional secret for invite links (default: derived from the
 *                                    Supabase service key)
 *   TRIAL_EMAIL_FROM                 default "Built2Bid <hello@built2bid.org>"
 *   RESEND_API_KEY                   already set for the founder email
 *   EMAIL_OUTBOX_SECRET              bearer for the scheduled job (shared with the founder email)
 */
export const TRIAL_DAYS = 7;
export const TRIAL_PLAN_NAME = "Built2Bid Unlimited";
export const CAMPAIGN_KEY = "fb_bid_7day";
export const DEFAULT_GRAPH_VERSION = "v26.0";
/** Messenger quick-reply payloads. */
export const PAYLOAD_SEND_INVITE = "B2B_TRIAL_SEND_INVITE";
export const PAYLOAD_CHECKINS_YES = "B2B_TRIAL_CHECKINS_YES";
export const PAYLOAD_CHECKINS_NO = "B2B_TRIAL_CHECKINS_NO";
/** Reminder for people who tapped "Send my invite" but never gave an email. */
export const REMINDER_DELAY_MS = 4 * 3_600_000;
/** Messenger's standard messaging window, minus a safety margin. */
export const MESSAGING_WINDOW_MS = 23.5 * 3_600_000;
/** Meta allows a private reply within 7 days of the comment; stop retrying a little before. */
export const PRIVATE_REPLY_WINDOW_MS = 6.5 * 86_400_000;

type Env = Record<string, string | undefined>;

const ids = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter((s) => /^[0-9]+(_[0-9]+)?$/.test(s));

export interface TrialConfig {
  enabled: boolean;
  /** Public /trial claim page: separate switch so the Messenger route can run without it. */
  claimPage: boolean;
  appId: string;
  appSecret: string;
  pageId: string;
  pageToken: string;
  verifyToken: string;
  testPostIds: string[];
  adPostIds: string[];
  graphVersion: string;
  manychatSecret: string;
}

export function trialConfig(env: Env = process.env): TrialConfig {
  const v = (env.META_GRAPH_VERSION ?? "").trim();
  return {
    enabled: env.FB_TRIAL_ENABLED === "true",
    claimPage: env.FB_TRIAL_ENABLED === "true" && env.TRIAL_CLAIM_PAGE_ENABLED === "true",
    appId: (env.META_APP_ID ?? "").trim(),
    appSecret: env.META_APP_SECRET ?? "",
    pageId: (env.META_PAGE_ID ?? "").trim(),
    pageToken: env.META_PAGE_ACCESS_TOKEN ?? "",
    verifyToken: env.META_VERIFY_TOKEN ?? "",
    testPostIds: ids(env.META_TEST_POST_IDS),
    adPostIds: ids(env.META_AD_POST_IDS),
    graphVersion: /^v\d{2}\.\d$/.test(v) ? v : DEFAULT_GRAPH_VERSION,
    manychatSecret: env.MANYCHAT_TRIAL_SECRET ?? "",
  };
}

/** The direct Meta route can run only with all of these. */
export function metaReady(c: TrialConfig): boolean {
  return Boolean(c.appSecret && c.pageId && c.pageToken && c.verifyToken && (c.testPostIds.length || c.adPostIds.length));
}

export function allowedPostIds(c: TrialConfig): Set<string> {
  return new Set([...c.testPostIds, ...c.adPostIds]);
}
