import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { openToken, sealToken } from "@/lib/tax-banking/bank/token-crypto";
import { logError } from "@/lib/http/api";

/**
 * Google Calendar for the Sales Hub (V8.4 P2). Official OAuth 2.0 with narrow scopes; reps never share a
 * password. Off until the owner adds GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET (a
 * Google Cloud OAuth client with redirect URI https://built2bid.org/api/sales/google/callback).
 *
 * Scopes:
 *   calendar.freebusy      read busy times only (never titles or details) to block booking slots
 *   calendar.events.owned  create, move and cancel the events we add (sessions, out-of-office);
 *                          we never edit or delete events we didn't create
 *   gmail.settings.basic   optional, only with SALES_GMAIL_RESPONDER=on: the vacation responder
 *
 * Refresh tokens are sealed with AES-256-GCM (SALES_TOKEN_KEY, or BANK_TOKEN_KEY) and readable only by the
 * service role. Customer invites from Google go out only when SALES_BOOKING_EMAILS=on.
 */

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const CAL = "https://www.googleapis.com/calendar/v3";
export const SCOPES = {
  freebusy: "https://www.googleapis.com/auth/calendar.freebusy",
  events: "https://www.googleapis.com/auth/calendar.events.owned",
  gmail: "https://www.googleapis.com/auth/gmail.settings.basic",
} as const;

export type Fetch = typeof fetch;
export const googleConfigured = (env = process.env) => Boolean(env.GOOGLE_CALENDAR_CLIENT_ID && env.GOOGLE_CALENDAR_CLIENT_SECRET);
export const responderAllowed = (env = process.env) => env.SALES_GMAIL_RESPONDER === "on";
export const customerEmailsOn = (env = process.env) => env.SALES_BOOKING_EMAILS === "on";
const tokenKey = (env = process.env) => env.SALES_TOKEN_KEY || env.BANK_TOKEN_KEY;

export function authUrl(opts: { redirectUri: string; state: string; withGmail: boolean; loginHint?: string | null }, env = process.env): string {
  const scopes = [SCOPES.freebusy, SCOPES.events, ...(opts.withGmail && responderAllowed(env) ? [SCOPES.gmail] : []), "openid", "email"];
  const q = new URLSearchParams({
    client_id: env.GOOGLE_CALENDAR_CLIENT_ID ?? "", redirect_uri: opts.redirectUri, response_type: "code", scope: scopes.join(" "),
    access_type: "offline", prompt: "consent", include_granted_scopes: "true", state: opts.state, ...(opts.loginHint ? { login_hint: opts.loginHint } : {}),
  });
  return `${AUTH}?${q.toString()}`;
}

export async function exchangeCode(code: string, redirectUri: string, f: Fetch = fetch, env = process.env) {
  const r = await f(TOKEN, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CALENDAR_CLIENT_ID ?? "", client_secret: env.GOOGLE_CALENDAR_CLIENT_SECRET ?? "", redirect_uri: redirectUri, grant_type: "authorization_code" }) });
  const b = (await r.json().catch(() => ({}))) as { refresh_token?: string; access_token?: string; scope?: string; id_token?: string; error?: string };
  if (!r.ok || !b.refresh_token) throw new Error(b.error ?? `token_exchange_${r.status}`);
  let email: string | null = null;
  try { email = JSON.parse(Buffer.from((b.id_token ?? "").split(".")[1] ?? "", "base64url").toString()).email ?? null; } catch { /* no id token */ }
  return { refresh: b.refresh_token, scopes: (b.scope ?? "").split(" ").filter(Boolean), email };
}

export async function saveConnection(admin: SupabaseClient, repId: string, c: { refresh: string; scopes: string[]; email: string | null }) {
  const { error } = await admin.from("sales_google_connections").upsert({
    rep_id: repId, google_email: c.email, refresh_token_sealed: sealToken(c.refresh, tokenKey()), scopes: c.scopes, status: "connected", last_error: null, connected_at: new Date().toISOString(),
  });
  if (error) throw error;
}

type Conn = { rep_id: string; refresh_token_sealed: string; scopes: string[]; calendar_id: string; status: string };

/** A short-lived access token, or null (not connected / revoked). Marks revoked access so the rep sees it. */
export async function accessFor(admin: SupabaseClient, repId: string, f: Fetch = fetch, env = process.env): Promise<{ token: string; conn: Conn } | null> {
  if (!googleConfigured(env)) return null;
  const { data } = await admin.from("sales_google_connections").select("rep_id,refresh_token_sealed,scopes,calendar_id,status").eq("rep_id", repId).maybeSingle();
  const conn = data as Conn | null;
  if (!conn || conn.status !== "connected") return null;
  try {
    const r = await f(TOKEN, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ refresh_token: openToken(conn.refresh_token_sealed, tokenKey(env)), client_id: env.GOOGLE_CALENDAR_CLIENT_ID ?? "", client_secret: env.GOOGLE_CALENDAR_CLIENT_SECRET ?? "", grant_type: "refresh_token" }) });
    const b = (await r.json().catch(() => ({}))) as { access_token?: string; error?: string };
    if (!r.ok || !b.access_token) {
      const revoked = b.error === "invalid_grant";
      await admin.from("sales_google_connections").update({ status: revoked ? "revoked" : "error", last_error: revoked ? "Google access was removed or expired. Reconnect." : String(b.error ?? r.status).slice(0, 300) }).eq("rep_id", repId);
      return null;
    }
    return { token: b.access_token, conn };
  } catch (e) {
    logError("sales.google.refresh", e);
    return null;
  }
}

const api = async (token: string, url: string, init: RequestInit = {}, f: Fetch = fetch) => {
  const r = await f(url, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) } });
  const b = r.status === 204 ? {} : await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`google_${r.status}: ${JSON.stringify((b as { error?: unknown }).error ?? b).slice(0, 200)}`);
  return b as Record<string, unknown>;
};

/** Busy intervals only (no titles or details). Empty when not connected or Google is unreachable. */
export async function busyTimes(admin: SupabaseClient, repId: string, from: Date, to: Date, f: Fetch = fetch): Promise<{ start: string; end: string }[]> {
  const a = await accessFor(admin, repId, f);
  if (!a) return [];
  try {
    const b = await api(a.token, `${CAL}/freeBusy`, { method: "POST", body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: a.conn.calendar_id || "primary" }] }) }, f);
    const cals = (b.calendars ?? {}) as Record<string, { busy?: { start: string; end: string }[] }>;
    await admin.from("sales_google_connections").update({ last_sync_at: new Date().toISOString() }).eq("rep_id", repId);
    return Object.values(cals).flatMap((c) => c.busy ?? []);
  } catch (e) {
    logError("sales.google.freebusy", e);
    return [];
  }
}

export async function createEvent(admin: SupabaseClient, repId: string, ev: { summary: string; description: string; start: string; end: string; attendee?: string | null; location?: string | null; outOfOffice?: boolean }, f: Fetch = fetch): Promise<string | null> {
  const a = await accessFor(admin, repId, f);
  if (!a || !a.conn.scopes.includes(SCOPES.events)) return null;
  const notify = ev.attendee && customerEmailsOn() ? "all" : "none";
  const body = ev.outOfOffice
    ? { summary: ev.summary, start: { dateTime: ev.start }, end: { dateTime: ev.end }, eventType: "outOfOffice", outOfOfficeProperties: { autoDeclineMode: "declineOnlyNewConflictingInvitations", declineMessage: ev.description.slice(0, 500) } }
    : { summary: ev.summary, description: ev.description, start: { dateTime: ev.start }, end: { dateTime: ev.end }, location: ev.location ?? undefined,
        attendees: ev.attendee && customerEmailsOn() ? [{ email: ev.attendee }] : undefined, reminders: { useDefault: true } };
  try {
    const r = await api(a.token, `${CAL}/calendars/${encodeURIComponent(a.conn.calendar_id || "primary")}/events?sendUpdates=${notify}`, { method: "POST", body: JSON.stringify(body) }, f);
    return (r.id as string) ?? null;
  } catch (e) {
    logError("sales.google.create", e);
    return null;
  }
}

/** Removes an event we created. Never touches events we didn't create (we only hold their ids). */
export async function deleteEvent(admin: SupabaseClient, repId: string, eventId: string | null | undefined, f: Fetch = fetch): Promise<void> {
  if (!eventId) return;
  const a = await accessFor(admin, repId, f);
  if (!a) return;
  try {
    await api(a.token, `${CAL}/calendars/${encodeURIComponent(a.conn.calendar_id || "primary")}/events/${encodeURIComponent(eventId)}?sendUpdates=${customerEmailsOn() ? "all" : "none"}`, { method: "DELETE" }, f);
  } catch (e) {
    if (!/google_(404|410)/.test(String(e))) logError("sales.google.delete", e);
  }
}

/** Gmail vacation responder (Workspace supported setting). Gmail itself sends at most one reply per sender. */
export async function setResponder(admin: SupabaseClient, repId: string, r: { enable: boolean; subject: string; body: string; start: string; end: string }, f: Fetch = fetch): Promise<"set" | "failed" | "not_connected"> {
  if (!responderAllowed()) return "not_connected";
  const a = await accessFor(admin, repId, f);
  if (!a || !a.conn.scopes.includes(SCOPES.gmail)) return "not_connected";
  try {
    await api(a.token, "https://gmail.googleapis.com/gmail/v1/users/me/settings/vacation", { method: "PUT", body: JSON.stringify(r.enable
      ? { enableAutoReply: true, responseSubject: r.subject, responseBodyPlainText: r.body, restrictToContacts: false, restrictToDomain: false, startTime: String(new Date(r.start).getTime()), endTime: String(new Date(r.end).getTime()) }
      : { enableAutoReply: false }) }, f);
    return "set";
  } catch (e) {
    logError("sales.google.responder", e);
    return "failed";
  }
}
