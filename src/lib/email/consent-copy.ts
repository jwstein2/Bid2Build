/**
 * The marketing-consent notice shown beside the (unchecked by default) sign-up checkbox, and its
 * version. When the wording changes, bump the version so each stored consent points at the exact
 * notice the person agreed to. Pure: safe in the browser, the server and tests.
 *
 * Marketing consent is separate from sign-in and account email: verification codes, receipts and
 * account notices are sent whether or not this box is ticked.
 */
export const MARKETING_CONSENT_TEXT = "Also email me occasional product tips and offers (optional, unsubscribe anytime).";
export const MARKETING_CONSENT_VERSION = "2026-11-17";

/** Where a consent change came from. Only the first three may be sent by a browser. */
export const CLIENT_CONSENT_SOURCES = ["signup_dialog", "email_link", "account_settings"] as const;
export type ConsentSource = (typeof CLIENT_CONSENT_SOURCES)[number] | "unsubscribe_link" | "outreach_opt_out";
