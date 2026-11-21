/**
 * Service providers (subprocessors) that process personal data for Built2Bid. One list feeds the public
 * /subprocessors page so the Privacy Policy, DPA and security questionnaires can all point at a single source.
 * Add a row here (and say so in the "Changes" note) before a new provider starts receiving personal data.
 */
export interface Subprocessor {
  name: string;
  purpose: string;
  data: string;
  location: string;
  /** When the provider only receives data if a feature is used or turned on. */
  when?: string;
}

export const SUBPROCESSORS_UPDATED = "November 21, 2026";

export const SUBPROCESSORS: Subprocessor[] = [
  { name: "Supabase", purpose: "Database, sign-in and file storage", data: "All account and business data you store in Built2Bid", location: "United States" },
  { name: "Netlify", purpose: "Website hosting and scheduled jobs", data: "Requests to the site (IP address, browser), data passing through pages and jobs", location: "United States" },
  { name: "Stripe", purpose: "Subscription billing, invoice payments for contractors (Stripe Connect), sales tax", data: "Name, email, billing address, payment details (held by Stripe, never by Built2Bid)", location: "United States" },
  { name: "Resend", purpose: "Email delivery (sign-in codes, proposals, notices)", data: "Recipient email address and email content", location: "United States" },
  { name: "Anthropic", purpose: "AI features (bid drafts, proposal wording, pricing guides)", data: "The text you send to an AI feature; not used to train models under Anthropic's commercial terms", location: "United States" },
  { name: "Sentry", purpose: "Error monitoring", data: "Technical error details; configured not to send default personal data", location: "United States" },
  { name: "Google", purpose: "Website analytics, company email (Workspace), address autofill (Maps), Send via My Email (Gmail)", data: "Analytics: visit data. Workspace: emails to us. Maps: typed address. Gmail: only messages you choose to send", location: "United States", when: "Maps and Gmail only when you use them; analytics can be turned off on the Cookie Policy page" },
  { name: "Plaid", purpose: "Read-only business bank connections", data: "Bank balances and transactions for accounts you connect", location: "United States", when: "Only if you connect a bank" },
  { name: "Intuit (QuickBooks Online)", purpose: "QuickBooks sync", data: "Customers, invoices, payments and hours you choose to sync", location: "United States", when: "Only if you connect QuickBooks" },
  { name: "Twilio", purpose: "Text message sign-in codes", data: "Mobile phone number and the code message", location: "United States", when: "Only if you sign in by phone" },
  { name: "Meta", purpose: "Ad measurement", data: "Browser identifiers and page visits", location: "United States", when: "Only after you choose Allow in the ad-measurement banner" },
  { name: "YouTube (Google)", purpose: "Embedded training videos", data: "Video viewing data", location: "United States", when: "Only when you press play" },
  { name: "U.S. Census Bureau geocoder", purpose: "Matching job addresses to sales-tax jurisdictions", data: "Job street address", location: "United States" },
  { name: "Better Stack", purpose: "Uptime monitoring", data: "No customer personal data (checks public pages and a health endpoint)", location: "United States / European Union" },
];
