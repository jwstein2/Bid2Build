import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Read-only provider usage monitors for the owner Tech Stack & Costs page.
 *
 * Every monitor reads its token from a server-only environment variable and makes GET requests
 * only. With the variable unset it returns `not_connected` without making a request. Errors are
 * reported by HTTP status only, so a token can never end up in the page.
 */

export type Monitor<T> =
  | { state: "not_connected"; env: string }
  | { state: "error"; env: string; message: string }
  | { state: "ok"; env: string; data: T; fetchedAt: string };

const TIMEOUT_MS = 8000;
const env = (name: string) => process.env[name]?.trim() || "";

async function getJson(url: string, headers: Record<string, string>): Promise<{ ok: true; body: unknown } | { ok: false; message: string }> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json", ...headers }, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return { ok: false, message: res.status === 401 || res.status === 403 ? `Token rejected (HTTP ${res.status}): check its permissions` : `Provider returned HTTP ${res.status}` };
    return { ok: true, body: await res.json() };
  } catch {
    return { ok: false, message: "Provider did not respond" };
  }
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/* ------------------------------- Netlify ------------------------------- */

export interface NetlifyUsage {
  team: string | null;
  plan: string | null;
  billingPeriod: string | null;
  buildMinutes: { used: number | null; included: number | null; periodStart: string | null; periodEnd: string | null; updatedAt: string | null } | null;
}

export const NETLIFY_ENV = "NETLIFY_API_TOKEN";

export async function netlifyUsage(): Promise<Monitor<NetlifyUsage>> {
  const token = env(NETLIFY_ENV);
  if (!token) return { state: "not_connected", env: NETLIFY_ENV };
  const h = { Authorization: `Bearer ${token}` };
  let accountId = env("NETLIFY_ACCOUNT_ID");
  let account: Record<string, unknown> = {};
  if (accountId) {
    const a = await getJson(`https://api.netlify.com/api/v1/accounts/${encodeURIComponent(accountId)}`, h);
    if (!a.ok) return { state: "error", env: NETLIFY_ENV, message: a.message };
    account = obj(a.body);
  } else {
    const a = await getJson("https://api.netlify.com/api/v1/accounts", h);
    if (!a.ok) return { state: "error", env: NETLIFY_ENV, message: a.message };
    const list = Array.isArray(a.body) ? a.body : [];
    if (list.length !== 1) return { state: "error", env: NETLIFY_ENV, message: list.length ? "Token sees several teams: set NETLIFY_ACCOUNT_ID" : "Token sees no team" };
    account = obj(list[0]);
    accountId = String(account.id ?? "");
  }
  const b = await getJson(`https://api.netlify.com/api/v1/${encodeURIComponent(accountId)}/builds/status`, h);
  const status = b.ok ? obj(Array.isArray(b.body) ? b.body[0] : b.body) : {};
  const m = obj(status.minutes);
  return {
    state: "ok", env: NETLIFY_ENV, fetchedAt: new Date().toISOString(),
    data: {
      team: typeof account.name === "string" ? account.name : null,
      plan: typeof account.type_name === "string" ? account.type_name : null,
      billingPeriod: typeof account.billing_period === "string" ? account.billing_period : null,
      buildMinutes: b.ok ? { used: num(m.current), included: num(m.included_minutes_with_packs) ?? num(m.included_minutes), periodStart: (m.period_start_date as string) ?? null, periodEnd: (m.period_end_date as string) ?? null, updatedAt: (m.last_updated_at as string) ?? null } : null,
    },
  };
}

/* ------------------------------- Supabase ------------------------------ */

export interface SupabaseUsage { status: string | null; region: string | null; requests: { label: string; count: number }[]; requestsTotal: number | null }

export const SUPABASE_ENV = "SUPABASE_MANAGEMENT_TOKEN";

export const projectRef = (url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "") => /^https:\/\/([a-z0-9]{20})\.supabase\.co/.exec(url)?.[1] ?? null;

/** Adds up every numeric field (except timestamps) across the rows the usage endpoint returns. */
export function sumCounts(body: unknown): { label: string; count: number }[] {
  const rows = Array.isArray(obj(body).result) ? (obj(body).result as unknown[]) : Array.isArray(body) ? body : [];
  const totals = new Map<string, number>();
  for (const r of rows) for (const [k, v] of Object.entries(obj(r))) {
    if (/time|date|^id$/i.test(k)) continue;
    const n = num(v);
    if (n != null) totals.set(k, (totals.get(k) ?? 0) + n);
  }
  return [...totals].map(([k, count]) => ({ label: k.replace(/^total_/, "").replace(/_/g, " "), count })).sort((a, b) => b.count - a.count);
}

export async function supabaseUsage(): Promise<Monitor<SupabaseUsage>> {
  const token = env(SUPABASE_ENV);
  if (!token) return { state: "not_connected", env: SUPABASE_ENV };
  const ref = projectRef();
  if (!ref) return { state: "error", env: SUPABASE_ENV, message: "Project ref not found in NEXT_PUBLIC_SUPABASE_URL" };
  const h = { Authorization: `Bearer ${token}` };
  const [p, u] = await Promise.all([
    getJson(`https://api.supabase.com/v1/projects/${ref}`, h),
    getJson(`https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/usage.api-requests-count`, h),
  ]);
  if (!p.ok && !u.ok) return { state: "error", env: SUPABASE_ENV, message: p.message };
  const proj = p.ok ? obj(p.body) : {};
  const requests = u.ok ? sumCounts(u.body) : [];
  return {
    state: "ok", env: SUPABASE_ENV, fetchedAt: new Date().toISOString(),
    data: { status: typeof proj.status === "string" ? proj.status : null, region: typeof proj.region === "string" ? proj.region : null, requests, requestsTotal: u.ok ? requests.reduce((n, r) => n + r.count, 0) : null },
  };
}

/* ------------------------------ Anthropic ------------------------------ */

export interface AnthropicCost { totalCents: number; byModel: { model: string; cents: number }[]; since: string; refreshedAt: string | null }

export const ANTHROPIC_ADMIN_ENV = "ANTHROPIC_ADMIN_KEY";

/** Organization API cost this calendar month (UTC), from the Usage and Cost Analytics API. Amounts are decimal cents. */
export async function anthropicCost(now: Date): Promise<Monitor<AnthropicCost>> {
  const key = env(ANTHROPIC_ADMIN_ENV);
  if (!key) return { state: "not_connected", env: ANTHROPIC_ADMIN_ENV };
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const client = new Anthropic({ apiKey: key, timeout: TIMEOUT_MS, maxRetries: 0 });
  try {
    const byModel = new Map<string, number>();
    let refreshedAt: string | null = null;
    let pages = 0;
    const first = await client.beta.organization.analytics.cost.list({ starting_at: since, group_by: ["model"], limit: 100 });
    for await (const page of first.iterPages()) {
      refreshedAt = page.data_refreshed_at ?? refreshedAt;
      for (const row of page.data) {
        const cents = Number(row.cost.amount);
        if (!Number.isFinite(cents)) continue;
        const m = row.group.model ?? "Other (not model-specific)";
        byModel.set(m, (byModel.get(m) ?? 0) + cents);
      }
      if (++pages >= 5) break;
    }
    const list = [...byModel].map(([model, cents]) => ({ model, cents: Math.round(cents) })).sort((a, b) => b.cents - a.cents);
    return { state: "ok", env: ANTHROPIC_ADMIN_ENV, fetchedAt: new Date().toISOString(), data: { totalCents: list.reduce((n, r) => n + r.cents, 0), byModel: list, since, refreshedAt } };
  } catch (e) {
    const status = e instanceof Anthropic.APIError ? e.status : undefined;
    return { state: "error", env: ANTHROPIC_ADMIN_ENV, message: status === 401 || status === 403 ? `Key rejected (HTTP ${status}): it must be an Admin API key` : status ? `Anthropic returned HTTP ${status}` : "Anthropic did not respond" };
  }
}

/* --------------------------- Advertising (setup only) --------------------------- */

export interface AdsSetup { key: "google-ads" | "meta-ads"; name: string; needs: string[]; present: string[]; missing: string[] }

export const ADS_ENV = {
  "google-ads": ["GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_CUSTOMER_ID", "GOOGLE_ADS_REFRESH_TOKEN"],
  "meta-ads": ["META_ADS_ACCESS_TOKEN", "META_ADS_ACCOUNT_ID"],
} as const;

/** Advertising APIs are not called yet: each needs provider review first. This only reports which settings exist. */
export function adsSetup(): AdsSetup[] {
  const make = (key: AdsSetup["key"], name: string, needs: string[]): AdsSetup => {
    const names = [...ADS_ENV[key]];
    return { key, name, needs, present: names.filter((n) => env(n)), missing: names.filter((n) => !env(n)) };
  };
  return [
    make("google-ads", "Google Ads", ["A Google Ads manager account and a developer token (Google reviews the application; Basic access is free)", "An OAuth client in Google Cloud and a refresh token for the ads account", "The 10-digit customer ID of the ads account"]),
    make("meta-ads", "Meta Ads", ["A Meta Business app with the Marketing API product", "A system-user access token with the ads_read permission only", "The ad account ID (act_…)"]),
  ];
}
