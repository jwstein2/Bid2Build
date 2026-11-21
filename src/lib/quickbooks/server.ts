import "server-only";
/**
 * Stores the QuickBooks connection (tokens encrypted with BANK_TOKEN_KEY, service-role only), keeps the access token
 * fresh, saves worker/project matches and sends approved hours. Callers must first confirm the user manages the
 * team with scopeFor(); every query here is pinned to that scope.
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { openToken, sealToken } from "@/lib/tax-banking/bank/token-crypto";
import { mapTimesheet } from "@/lib/team/records";
import { qbEnvironment, type QbEnvironment } from "./config";
import { QbError, companyName, createTimeActivity, refreshTokens, revokeToken, listEntities, type QbEntity, type QbTokens } from "./client";
import { planExport, type JobLink, type SkipReason, type WorkerLink } from "./mapping";
import { logError } from "@/lib/http/api";

type Db = SupabaseClient;
export interface Scope { companyId: string | null; ownerId: string | null; canManage: boolean }
export interface Connection { id: string; realmId: string; companyName: string | null; environment: QbEnvironment; status: "active" | "needs_reauth"; lastSyncAt: string | null; lastError: string | null; createdAt: string }

/** Who the signed-in user acts for (their company, or themselves when solo) and whether they manage the team. */
export async function scopeFor(userDb: Db): Promise<Scope | null> {
  const { data, error } = await userDb.rpc("qb_my_scope");
  if (error || !data) return null;
  const r = data as Record<string, unknown>;
  return { companyId: (r.companyId as string) ?? null, ownerId: (r.ownerId as string) ?? null, canManage: r.canManage === true };
}

const mapConn = (r: Record<string, unknown>): Connection => ({
  id: String(r.id), realmId: String(r.realm_id), companyName: (r.company_name as string) ?? null, environment: r.environment === "production" ? "production" : "sandbox",
  status: r.status === "needs_reauth" ? "needs_reauth" : "active", lastSyncAt: (r.last_sync_at as string) ?? null, lastError: (r.last_error as string) ?? null, createdAt: String(r.created_at),
});

export async function liveConnection(admin: Db, s: Scope): Promise<Connection | null> {
  // Supabase's .eq() can't match NULL, so the empty side of the scope is pinned with .is().
  const q = admin.from("qb_connections").select("*").neq("status", "disconnected");
  const { data } = await (s.companyId ? q.eq("company_id", s.companyId).is("owner_id", null) : q.eq("owner_id", s.ownerId ?? "").is("company_id", null)).maybeSingle();
  return data ? mapConn(data as Record<string, unknown>) : null;
}

async function storeTokens(admin: Db, connectionId: string, t: QbTokens): Promise<void> {
  const { error } = await admin.from("qb_connection_secrets").upsert({
    connection_id: connectionId, access_ciphertext: sealToken(t.accessToken), refresh_ciphertext: sealToken(t.refreshToken),
    access_expires_at: t.accessExpiresAt.toISOString(), refresh_expires_at: t.refreshExpiresAt?.toISOString() ?? null, updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`qb_store_tokens: ${error.message}`);
}

/** Saves a new connection after the Intuit callback, replacing any earlier one for this scope. */
export async function saveConnection(admin: Db, s: Scope, userId: string, realmId: string, t: QbTokens): Promise<void> {
  const env = qbEnvironment();
  const name = await companyName(env, realmId, t.accessToken).catch(() => null);
  const old = await liveConnection(admin, s);
  if (old) await markDisconnected(admin, old.id, userId);
  const { data, error } = await admin.from("qb_connections").insert({
    company_id: s.companyId, owner_id: s.companyId ? null : s.ownerId, realm_id: realmId, company_name: name, environment: env, connected_by: userId,
  }).select("id").single();
  if (error || !data) throw new Error(`qb_save_connection: ${error?.message}`);
  await storeTokens(admin, String((data as { id: string }).id), t);
}

async function markDisconnected(admin: Db, id: string, userId: string) {
  const now = new Date().toISOString();
  await admin.from("qb_connections").update({ status: "disconnected", disconnected_at: now, disconnected_by: userId, updated_at: now }).eq("id", id);
  await admin.from("qb_connection_secrets").delete().eq("connection_id", id);
}

/** A valid access token, refreshed when it has under two minutes left. Marks the connection for re-sign-in when Intuit refuses. */
export async function accessToken(admin: Db, c: Connection): Promise<string> {
  const { data } = await admin.from("qb_connection_secrets").select("*").eq("connection_id", c.id).maybeSingle();
  if (!data) throw new QbError("Reconnect QuickBooks to continue.", 401, true);
  const row = data as Record<string, string>;
  if (Date.parse(row.access_expires_at) - Date.now() > 120_000) return openToken(row.access_ciphertext);
  try {
    const t = await refreshTokens(openToken(row.refresh_ciphertext), c.environment);
    await storeTokens(admin, c.id, t);
    return t.accessToken;
  } catch (e) {
    if (e instanceof QbError && e.reauth) await needsReauth(admin, c.id, "QuickBooks asked to sign in again.");
    throw e;
  }
}

async function needsReauth(admin: Db, id: string, msg: string) {
  await admin.from("qb_connections").update({ status: "needs_reauth", last_error: msg.slice(0, 300), updated_at: new Date().toISOString() }).eq("id", id);
}

/** Calls QuickBooks with a fresh token; a 401 marks the connection for re-sign-in. */
async function withToken<T>(admin: Db, c: Connection, fn: (token: string) => Promise<T>): Promise<T> {
  const token = await accessToken(admin, c);
  try { return await fn(token); } catch (e) {
    if (e instanceof QbError && e.reauth) await needsReauth(admin, c.id, "QuickBooks asked to sign in again.");
    throw e;
  }
}

export async function disconnect(admin: Db, c: Connection, userId: string): Promise<void> {
  const { data } = await admin.from("qb_connection_secrets").select("refresh_ciphertext").eq("connection_id", c.id).maybeSingle();
  if (data) { try { await revokeToken(openToken((data as { refresh_ciphertext: string }).refresh_ciphertext), c.environment); } catch { /* best effort */ } }
  await markDisconnected(admin, c.id, userId);
}

export const entities = (admin: Db, c: Connection): Promise<QbEntity[]> => withToken(admin, c, (t) => listEntities(c.environment, c.realmId, t));

export interface Links { workers: WorkerLink[]; jobs: JobLink[] }
export async function loadLinks(admin: Db, c: Connection): Promise<Links> {
  const [w, j] = await Promise.all([
    admin.from("qb_worker_links").select("resource_id, qb_type, qb_id, qb_name").eq("connection_id", c.id),
    admin.from("qb_job_links").select("schedule_id, qb_customer_id, qb_name").eq("connection_id", c.id),
  ]);
  return {
    workers: ((w.data ?? []) as Record<string, string>[]).map((r) => ({ resourceId: r.resource_id, qbType: r.qb_type === "Vendor" ? "Vendor" : "Employee", qbId: r.qb_id, qbName: r.qb_name ?? null })),
    jobs: ((j.data ?? []) as Record<string, string>[]).map((r) => ({ scheduleId: r.schedule_id, qbCustomerId: r.qb_customer_id, qbName: r.qb_name ?? null })),
  };
}

/** Replaces one worker's or project's match (null clears it). The database refuses rows from another company. */
export async function saveLink(admin: Db, c: Connection, userId: string, link: { kind: "worker"; resourceId: string; qbType: "Employee" | "Vendor" | null; qbId: string | null; qbName: string | null } | { kind: "job"; scheduleId: string; qbId: string | null; qbName: string | null }): Promise<void> {
  if (link.kind === "worker") {
    if (!link.qbId || !link.qbType) { await admin.from("qb_worker_links").delete().eq("connection_id", c.id).eq("resource_id", link.resourceId); return; }
    const { error } = await admin.from("qb_worker_links").upsert({ connection_id: c.id, resource_id: link.resourceId, qb_type: link.qbType, qb_id: link.qbId, qb_name: link.qbName, updated_by: userId });
    if (error) throw new Error(error.message);
  } else {
    if (!link.qbId) { await admin.from("qb_job_links").delete().eq("connection_id", c.id).eq("schedule_id", link.scheduleId); return; }
    const { error } = await admin.from("qb_job_links").upsert({ connection_id: c.id, schedule_id: link.scheduleId, qb_customer_id: link.qbId, qb_name: link.qbName, updated_by: userId });
    if (error) throw new Error(error.message);
  }
}

export interface SyncResult { sent: number; failed: { entryId: string; message: string }[]; skipped: Record<SkipReason, number>; remaining: number }
const MAX_PER_RUN = 150;

/**
 * Sends approved, not-yet-sent entries between from and to. Entries are read through pm_timesheet as the signed-in
 * user, so only what they may approve is ever sent. Each entry is claimed in qb_time_exports before the QuickBooks
 * call, and QuickBooks' requestid stops a duplicate if a claim is retried after a timeout.
 */
export async function syncHours(admin: Db, userDb: Db, c: Connection, userId: string, from: string, to: string, days?: { from: string; to: string }): Promise<SyncResult> {
  const { data, error } = await userDb.rpc("pm_timesheet", { p_from: from, p_to: to });
  if (error) throw new Error(`qb_timesheet: ${error.message}`);
  const sheet = mapTimesheet(data);
  if (!sheet.canManage) throw new QbError("Only time approvers can send hours to QuickBooks.", 403);
  const links = await loadLinks(admin, c);
  const ids = sheet.entries.map((e) => e.id);
  const sentRows = ids.length ? await admin.from("qb_time_exports").select("entry_id").eq("connection_id", c.id).eq("status", "sent").in("entry_id", ids) : { data: [] };
  const sent = new Set(((sentRows.data ?? []) as { entry_id: string }[]).map((r) => r.entry_id));
  const plan = planExport(sheet.entries, { ...links, sent, tz: sheet.timezone ?? "America/Chicago", projects: sheet.projects, days });
  const batch = plan.send.slice(0, MAX_PER_RUN);
  const result: SyncResult = { sent: 0, failed: [], skipped: plan.skipped, remaining: plan.send.length - batch.length };
  if (batch.length === 0) return result;
  const token = await accessToken(admin, c);
  for (const item of batch) {
    // Claim: a new row, or retake one that failed before. A row that is 'sending' or 'sent' belongs to someone else.
    const claim = await admin.rpc("qb_claim_export", { p_connection: c.id, p_entry: item.entry.id, p_user: userId, p_hours: item.hours, p_date: item.txnDate });
    if (claim.error || claim.data !== true) { result.skipped.already_sent++; continue; }
    try {
      // Same entry + same payload = same requestid, so a retry after a timeout can't duplicate; a fixed match
      // (new payload) gets a fresh requestid instead of QuickBooks replaying the earlier error.
      const requestId = `${item.entry.id}-${createHash("sha256").update(JSON.stringify(item.payload)).digest("hex").slice(0, 8)}`;
      const qbId = await createTimeActivity(c.environment, c.realmId, token, item.payload, requestId);
      await admin.from("qb_time_exports").update({ status: "sent", qb_time_activity_id: qbId, error: null }).eq("connection_id", c.id).eq("entry_id", item.entry.id);
      result.sent++;
    } catch (e) {
      const message = e instanceof Error ? e.message.slice(0, 300) : "QuickBooks didn't accept this entry.";
      await admin.from("qb_time_exports").update({ status: "error", error: message }).eq("connection_id", c.id).eq("entry_id", item.entry.id);
      result.failed.push({ entryId: item.entry.id, message });
      logError("quickbooks.time_activity", e, { status: e instanceof QbError ? e.status : undefined, intuit_tid: e instanceof QbError ? e.tid ?? undefined : undefined });
      if (e instanceof QbError && e.reauth) { await needsReauth(admin, c.id, "QuickBooks asked to sign in again."); break; }
    }
  }
  const now = new Date().toISOString();
  await admin.from("qb_connections").update({ last_sync_at: now, last_error: result.failed[0]?.message ?? null, updated_at: now }).eq("id", c.id);
  return result;
}
