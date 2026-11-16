import "server-only";
import { graph, type Fetch } from "./meta";
import type { TrialConfig } from "./config";

/**
 * Live checks against Meta for the admin page, using our own app and Page settings. Shows only
 * yes/no facts, scopes and ids; never a token.
 */
export const REQUIRED_SCOPES = ["pages_messaging", "pages_manage_metadata", "pages_read_engagement", "pages_show_list"] as const;
export const REQUIRED_FIELDS = ["feed", "messages", "messaging_postbacks"] as const;

export interface Check { key: string; label: string; ok: boolean | null; detail: string }
export interface PostCheck { id: string; kind: "organic_test" | "paid_ad"; readable: boolean | null; detail: string }

export async function metaReadiness(cfg: TrialConfig, fetchImpl?: Fetch): Promise<{ checks: Check[]; posts: PostCheck[] }> {
  const checks: Check[] = [];
  const has = (k: string, label: string, v: boolean, detail: string) => checks.push({ key: k, label, ok: v, detail });
  has("enabled", "Campaign switch (FB_TRIAL_ENABLED)", cfg.enabled, cfg.enabled ? "On" : "Off (paused): nothing is sent");
  has("app_id", "META_APP_ID", Boolean(cfg.appId), cfg.appId ? cfg.appId : "Missing");
  has("app_secret", "META_APP_SECRET (webhook signatures)", Boolean(cfg.appSecret), cfg.appSecret ? "Set" : "Missing");
  has("verify", "META_VERIFY_TOKEN", Boolean(cfg.verifyToken), cfg.verifyToken ? "Set" : "Missing");
  has("page_id", "META_PAGE_ID", Boolean(cfg.pageId), cfg.pageId || "Missing");
  has("page_token", "META_PAGE_ACCESS_TOKEN", Boolean(cfg.pageToken), cfg.pageToken ? "Set" : "Missing");
  has("posts", "Allowed post ids", cfg.testPostIds.length + cfg.adPostIds.length > 0, `${cfg.testPostIds.length} organic test, ${cfg.adPostIds.length} paid ad`);

  const posts: PostCheck[] = [
    ...cfg.testPostIds.map((id) => ({ id, kind: "organic_test" as const, readable: null, detail: "Not checked" })),
    ...cfg.adPostIds.map((id) => ({ id, kind: "paid_ad" as const, readable: null, detail: "Not checked" })),
  ];
  if (!cfg.pageToken || !cfg.pageId) return { checks, posts };

  // Token: valid, a PAGE token for our Page and our app, with the scopes the funnel needs.
  if (cfg.appId && cfg.appSecret) {
    const dbg = await graph<{ data?: { is_valid?: boolean; type?: string; app_id?: string; profile_id?: string; scopes?: string[]; expires_at?: number } }>(
      cfg, "GET", "debug_token", { params: { input_token: cfg.pageToken }, token: `${cfg.appId}|${cfg.appSecret}`, fetchImpl });
    if (dbg.ok && dbg.data.data) {
      const d = dbg.data.data;
      const scopes = d.scopes ?? [];
      const missing = REQUIRED_SCOPES.filter((s) => !scopes.includes(s));
      has("token_valid", "Page token is valid", Boolean(d.is_valid), d.is_valid ? `type ${d.type ?? "?"}, ${d.expires_at ? `expires ${new Date(d.expires_at * 1000).toISOString().slice(0, 10)}` : "never expires"}` : "Invalid or expired");
      has("token_page", "Token belongs to this Page and app", d.profile_id === cfg.pageId && d.app_id === cfg.appId, `page ${d.profile_id ?? "?"}, app ${d.app_id ?? "?"}`);
      has("scopes", "Permissions granted", missing.length === 0, missing.length ? `Missing: ${missing.join(", ")}` : REQUIRED_SCOPES.join(", "));
    } else {
      has("token_valid", "Page token is valid", false, dbg.ok ? "No data" : dbg.error.message);
    }
  }

  // Webhook subscription: our app is subscribed to this Page with the right fields.
  const sub = await graph<{ data?: { id?: string; subscribed_fields?: string[] }[] }>(cfg, "GET", `${cfg.pageId}/subscribed_apps`, { fetchImpl });
  if (sub.ok) {
    const mine = (sub.data.data ?? []).find((a) => !cfg.appId || a.id === cfg.appId);
    const fields = mine?.subscribed_fields ?? [];
    const missing = REQUIRED_FIELDS.filter((f) => !fields.includes(f));
    has("subscribed", "App subscribed to Page webhooks", Boolean(mine) && missing.length === 0, !mine ? "This app is not subscribed to the Page" : missing.length ? `Missing fields: ${missing.join(", ")}` : fields.join(", "));
  } else {
    has("subscribed", "App subscribed to Page webhooks", false, sub.error.message);
  }

  // Each allowed post: readable with the Page token and owned by the Page.
  for (const p of posts) {
    const r = await graph<{ id?: string; created_time?: string; is_published?: boolean }>(cfg, "GET", p.id, { params: { fields: "id,created_time,is_published" }, fetchImpl });
    if (r.ok) {
      p.readable = p.id.startsWith(`${cfg.pageId}_`);
      p.detail = `${r.data.is_published === false ? "unpublished (ad-only) post" : "published post"}, created ${String(r.data.created_time ?? "?").slice(0, 10)}${p.readable ? "" : ", not on this Page"}`;
    } else {
      p.readable = false;
      p.detail = r.error.message;
    }
  }
  return { checks, posts };
}
