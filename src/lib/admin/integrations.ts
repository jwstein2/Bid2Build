import "server-only";
import { createSign } from "node:crypto";
import { getStripe } from "@/lib/billing/stripe";
import type { Snapshot } from "./model";

/**
 * Read-only integrations for the owner command center. Nothing here writes to Stripe, Google or any
 * ad platform. Every call has a short timeout and returns null (shown as "Not connected" or
 * "Unavailable") instead of failing the page. No credential ever reaches the browser.
 */

export type IntegrationState = "ok" | "warn" | "missing" | "not_connected";
export interface Integration { key: string; name: string; state: IntegrationState; detail: string }

const env = (k: string) => (process.env[k] ?? "").trim();
const has = (k: string) => Boolean(env(k));

export function integrationStatus(snap: Snapshot): Integration[] {
  const key = env("STRIPE_SECRET_KEY");
  const mode = /^(sk|rk)_live_/.test(key) ? "live" : key ? "test" : "";
  const lastHook = snap.stripeEvents[0]?.received_at;
  const hookErrors = snap.stripeEvents.filter((e) => e.error).length;
  const ga4 = has("GA4_PROPERTY_ID") && has("GOOGLE_SERVICE_ACCOUNT_JSON");
  const gsc = has("SEARCH_CONSOLE_SITE") && has("GOOGLE_SERVICE_ACCOUNT_JSON");
  return [
    { key: "stripe", name: "Stripe billing", state: !key ? "missing" : !has("STRIPE_WEBHOOK_SECRET") ? "warn" : hookErrors ? "warn" : "ok", detail: !key ? "No STRIPE_SECRET_KEY" : `${mode} mode · webhook secret ${has("STRIPE_WEBHOOK_SECRET") ? "set" : "missing"} · ${lastHook ? `last event ${new Date(lastHook).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} CT` : "no events in 7 days"}${hookErrors ? ` · ${hookErrors} error(s)` : ""}` },
    { key: "supabase", name: "Supabase database", state: "ok", detail: `Read ${snap.estimates.length.toLocaleString("en-US")} bids and ${snap.users.length.toLocaleString("en-US")} accounts for this page` },
    { key: "auth_list", name: "Account emails (Supabase Auth admin)", state: snap.usersSource === "auth" ? "ok" : "warn", detail: snap.usersSource === "auth" ? "Readable with the service role" : "Not readable: test-account detection by email is off" },
    { key: "places", name: "Google Places (address suggestions)", state: has("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY") ? "warn" : "missing", detail: has("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY") ? "Key set. Live suggestions not verified from the server: type an address on a bid to check." : "No NEXT_PUBLIC_GOOGLE_MAPS_API_KEY" },
    { key: "ga_tag", name: "Google Analytics tag", state: has("NEXT_PUBLIC_GA_MEASUREMENT_ID") ? "ok" : "missing", detail: has("NEXT_PUBLIC_GA_MEASUREMENT_ID") ? "Collecting visits on public pages (production only)" : "No NEXT_PUBLIC_GA_MEASUREMENT_ID in this deploy" },
    { key: "ga4_api", name: "GA4 reporting (sessions in this dashboard)", state: ga4 ? "ok" : "not_connected", detail: ga4 ? "Service account configured" : "Needs GA4_PROPERTY_ID + GOOGLE_SERVICE_ACCOUNT_JSON (read-only Viewer)" },
    { key: "gsc_api", name: "Search Console reporting", state: gsc ? "ok" : "not_connected", detail: gsc ? "Service account configured" : "Needs SEARCH_CONSOLE_SITE + the same service account added as a user" },
    { key: "email", name: "Email provider (Resend)", state: has("RESEND_API_KEY") ? (env("FOUNDER_EMAIL_ENABLED") === "true" ? "ok" : "warn") : "missing", detail: has("RESEND_API_KEY") ? `Key set · founder email ${env("FOUNDER_EMAIL_ENABLED") === "true" ? "on" : "off"}` : "No RESEND_API_KEY" },
    { key: "auth_email", name: "Sign-in email delivery (Supabase SMTP)", state: "not_connected", detail: "Supabase Auth logs are not readable by the app. Check Supabase → Logs → Auth." },
    { key: "sentry", name: "Error monitoring (Sentry)", state: has("NEXT_PUBLIC_SENTRY_DSN") ? "ok" : "missing", detail: has("NEXT_PUBLIC_SENTRY_DSN") ? "DSN set" : "No NEXT_PUBLIC_SENTRY_DSN" },
    { key: "instantly", name: "Instantly outreach sync", state: has("INSTANTLY_API_KEY") && env("INSTANTLY_SYNC_ENABLED") === "true" ? "ok" : "not_connected", detail: has("INSTANTLY_API_KEY") ? `Key set · sync ${env("INSTANTLY_SYNC_ENABLED") === "true" ? "on" : "off"}` : "Not connected (outreach links still attribute through UTM tags)" },
    { key: "ads", name: "Google Ads / Meta Ads / YouTube", state: "not_connected", detail: "No ad-platform API. Enter monthly spend on the Marketing page for CAC." },
  ];
}

// ---------------------------------------------------------------------------------------------
// Google (GA4 Data API + Search Console) through a read-only service account
// ---------------------------------------------------------------------------------------------
async function googleToken(scope: string): Promise<string | null> {
  try {
    const sa = JSON.parse(env("GOOGLE_SERVICE_ACCOUNT_JSON")) as { client_email?: string; private_key?: string };
    if (!sa.client_email || !sa.private_key) return null;
    const now = Math.floor(Date.now() / 1000);
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: sa.client_email, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
    const sig = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }),
      signal: AbortSignal.timeout(5000), cache: "no-store",
    });
    if (!r.ok) return null;
    return ((await r.json()) as { access_token?: string }).access_token ?? null;
  } catch {
    return null;
  }
}

export interface Ga4Report { sessions: number; users: number; byChannel: { channel: string; sessions: number }[]; byDevice: { device: string; sessions: number }[] }

export async function ga4Report(days: number): Promise<Ga4Report | null> {
  if (!has("GA4_PROPERTY_ID") || !has("GOOGLE_SERVICE_ACCOUNT_JSON")) return null;
  const token = await googleToken("https://www.googleapis.com/auth/analytics.readonly");
  if (!token) return null;
  const run = async (dimension: string) => {
    const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(env("GA4_PROPERTY_ID"))}:runReport`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ dateRanges: [{ startDate: `${days}daysAgo`, endDate: "today" }], dimensions: [{ name: dimension }], metrics: [{ name: "sessions" }, { name: "totalUsers" }] }),
      signal: AbortSignal.timeout(6000), cache: "no-store",
    });
    if (!r.ok) throw new Error(`GA4 ${r.status}`);
    const j = (await r.json()) as { rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[] };
    return (j.rows ?? []).map((x) => ({ key: x.dimensionValues[0]?.value ?? "(not set)", sessions: Number(x.metricValues[0]?.value) || 0, users: Number(x.metricValues[1]?.value) || 0 }));
  };
  try {
    const [ch, dev] = await Promise.all([run("sessionDefaultChannelGroup"), run("deviceCategory")]);
    return {
      sessions: ch.reduce((n, x) => n + x.sessions, 0), users: ch.reduce((n, x) => n + x.users, 0),
      byChannel: ch.map((x) => ({ channel: x.key, sessions: x.sessions })).sort((a, b) => b.sessions - a.sessions),
      byDevice: dev.map((x) => ({ device: x.key, sessions: x.sessions })).sort((a, b) => b.sessions - a.sessions),
    };
  } catch {
    return null;
  }
}

export interface SearchReport { clicks: number; impressions: number; ctr: number; pages: { page: string; clicks: number; impressions: number }[]; queries: { query: string; clicks: number; impressions: number }[] }

export async function searchConsoleReport(days: number): Promise<SearchReport | null> {
  if (!has("SEARCH_CONSOLE_SITE") || !has("GOOGLE_SERVICE_ACCOUNT_JSON")) return null;
  const token = await googleToken("https://www.googleapis.com/auth/webmasters.readonly");
  if (!token) return null;
  // Search Console data lags ~2 days.
  const end = new Date(Date.now() - 2 * 86_400_000), start = new Date(end.getTime() - days * 86_400_000);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const q = async (dimensions: string[], rowLimit: number) => {
    const r = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(env("SEARCH_CONSOLE_SITE"))}/searchAnalytics/query`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ startDate: ymd(start), endDate: ymd(end), dimensions, rowLimit }), signal: AbortSignal.timeout(6000), cache: "no-store",
    });
    if (!r.ok) throw new Error(`GSC ${r.status}`);
    return ((await r.json()) as { rows?: { keys?: string[]; clicks: number; impressions: number; ctr: number }[] }).rows ?? [];
  };
  try {
    const [total, pages, queries] = await Promise.all([q([], 1), q(["page"], 10), q(["query"], 10)]);
    const tot = total[0] ?? { clicks: 0, impressions: 0, ctr: 0 };
    return {
      clicks: tot.clicks, impressions: tot.impressions, ctr: tot.ctr,
      pages: pages.map((r) => ({ page: (r.keys?.[0] ?? "").replace(/^https?:\/\/[^/]+/, "") || "/", clicks: r.clicks, impressions: r.impressions })),
      queries: queries.map((r) => ({ query: r.keys?.[0] ?? "", clicks: r.clicks, impressions: r.impressions })),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Stripe read-only reconciliation
// ---------------------------------------------------------------------------------------------
export interface StripeRecon { active: number; pastDue: number; paidCents: number; invoices: number; refundsNote: string }

const timeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

/**
 * Stripe's own count of active / past-due subscriptions and paid invoices in the window, excluding
 * customers that belong to internal/test/demo accounts. Lists only; never creates or updates anything.
 */
export async function stripeReconcile(days: number, excludedCustomers: Set<string>): Promise<StripeRecon | null> {
  if (!has("STRIPE_SECRET_KEY")) return null;
  try {
    const stripe = getStripe();
    const gte = Math.floor((Date.now() - days * 86_400_000) / 1000);
    const [active, pastDue, invoices] = await timeout(Promise.all([
      stripe.subscriptions.list({ status: "active", limit: 100 }).autoPagingToArray({ limit: 1000 }),
      stripe.subscriptions.list({ status: "past_due", limit: 100 }).autoPagingToArray({ limit: 1000 }),
      stripe.invoices.list({ status: "paid", created: { gte }, limit: 100 }).autoPagingToArray({ limit: 2000 }),
    ]), 8000);
    const cust = (c: string | { id: string } | null) => (typeof c === "string" ? c : c?.id ?? "");
    const keep = <T extends { customer: string | { id: string } | null }>(xs: T[]) => xs.filter((x) => !excludedCustomers.has(cust(x.customer)));
    const paid = keep(invoices as unknown as { customer: string | { id: string } | null; amount_paid: number }[]);
    return {
      active: keep(active as unknown as { customer: string | { id: string } | null }[]).length,
      pastDue: keep(pastDue as unknown as { customer: string | { id: string } | null }[]).length,
      paidCents: paid.reduce((n, i) => n + (i.amount_paid ?? 0), 0), invoices: paid.length,
      refundsNote: "Gross of refunds and Stripe fees",
    };
  } catch {
    return null;
  }
}
