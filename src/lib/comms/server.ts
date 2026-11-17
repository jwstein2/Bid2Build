import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { fail } from "@/lib/http/api";
import { rowToBusiness } from "@/lib/data/mappers";
import { mapTask } from "@/lib/schedule/server";
import { normalizeCalendar } from "@/lib/schedule/calendar";
import type { Dep, ScheduleData, Snapshot } from "@/lib/schedule/types";
import { NO_PERMISSIONS } from "@/lib/schedule/types";
import type { EstimateFact, ContactFact, SuppressionFact } from "./eligibility";
import { mapOffer, mapSettings, type CommAccess, type CommPermission, type CommSettings, type Offer, QUEUED_STATUSES } from "./types";

export const PENDING_REASON = "Relationship confirmed; not enrolled yet";
type Row = Record<string, unknown>;
type Db = SupabaseClient;

/** The caller's communications access, or null before the migration runs. */
export async function loadCommAccess(supabase: Db): Promise<CommAccess | null> {
  const { data, error } = await supabase.rpc("comm_access");
  if (error || !data) return null;
  return data as CommAccess;
}

export const can = (a: CommAccess | null, p: CommPermission) => Boolean(a?.accountId && a.pm && a.perms.includes(p));

/**
 * API guard: signed in, migration applied, Project Command Center on the account, and the permission.
 * Server-side enforcement for every write (the tables are read-only to browsers).
 */
export async function requireComm(perm: CommPermission): Promise<{ ok: true; userId: string; access: CommAccess & { accountId: string }; supabase: Db; admin: Db } | { ok: false; res: Response }> {
  const user = await getUser();
  if (!user) return { ok: false, res: fail(401, "not_authenticated", "Sign in required.") };
  const supabase = await createClient();
  const access = await loadCommAccess(supabase);
  if (!access) return { ok: false, res: fail(503, "not_ready", "Customer communications aren't set up on this site yet.") };
  if (!access.pm || !access.accountId) return { ok: false, res: fail(402, "pm_required", "Customer communications are part of Project Command Center.") };
  if (!access.perms.includes(perm)) return { ok: false, res: fail(403, "forbidden", "You don't have permission to do that. Ask your company owner.") };
  return { ok: true, userId: user.id, access: access as CommAccess & { accountId: string }, supabase, admin: createAdminClient() };
}

export async function loadSettings(db: Db, accountId: string): Promise<CommSettings> {
  const { data } = await db.from("comm_settings").select("*").eq("account_id", accountId).maybeSingle();
  return mapSettings(data as Row | null);
}

export async function ensureSettings(admin: Db, accountId: string, kind: "company" | "user") {
  await admin.from("comm_settings").upsert({ account_id: accountId, account_kind: kind }, { onConflict: "account_id", ignoreDuplicates: true });
}

export async function loadOffers(db: Db, accountId: string): Promise<Offer[]> {
  const { data } = await db.from("comm_offers").select("*").eq("account_id", accountId).order("created_at", { ascending: false });
  return ((data ?? []) as Row[]).map(mapOffer);
}

/** Account member user ids (company: active members; solo: the user). */
export async function accountOwner(admin: Db, accountId: string): Promise<{ kind: "company" | "user"; ownerId: string; companyName: string | null }> {
  const { data: c } = await admin.from("companies").select("id, owner_user_id, name").eq("id", accountId).maybeSingle();
  if (c) return { kind: "company", ownerId: String((c as Row).owner_user_id), companyName: String((c as Row).name ?? "") || null };
  return { kind: "user", ownerId: accountId, companyName: null };
}

/** Branding for the account (company owner's business profile, or the solo user's). */
export async function accountBranding(admin: Db, accountId: string) {
  const owner = await accountOwner(admin, accountId);
  const { data } = await admin.from("business_profiles").select("*").eq("user_id", owner.ownerId).maybeSingle();
  const b = rowToBusiness(data as Row | null);
  return { companyName: b.companyName || owner.companyName || "Your contractor", contactName: b.contactName ?? null, email: b.email ?? null, address: b.address ?? null, ownerId: owner.ownerId, kind: owner.kind };
}

/** Estimates (and their schedules) that belong to the account. Never another company's rows. */
export async function loadEstimateFacts(admin: Db, accountId: string, kind: "company" | "user"): Promise<EstimateFact[]> {
  let q = admin.from("estimates").select("id, customer_id, customer_email, customer_name, title, trades, estimate_date, updated_at, pipeline_stage, stage_changed_at").limit(5000);
  q = kind === "company" ? q.eq("company_id", accountId) : q.eq("user_id", accountId).is("company_id", null);
  const { data: est } = await q;
  const rows = (est ?? []) as Row[];
  const ids = rows.map((r) => String(r.id));
  const sched = new Map<string, Row>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await admin.from("project_schedules").select("estimate_id, status, updated_at").in("estimate_id", ids.slice(i, i + 300)).neq("status", "archived");
    for (const s of (data ?? []) as Row[]) sched.set(String(s.estimate_id), s);
  }
  // Customer email from the saved customer when the bid has none.
  const custIds = [...new Set(rows.map((r) => r.customer_id).filter(Boolean) as string[])];
  const cust = new Map<string, Row>();
  for (let i = 0; i < custIds.length; i += 300) {
    const { data } = await admin.from("customers").select("id, email, name").in("id", custIds.slice(i, i + 300));
    for (const c of (data ?? []) as Row[]) cust.set(String(c.id), c);
  }
  return rows.map((r) => {
    const s = sched.get(String(r.id));
    const c = r.customer_id ? cust.get(String(r.customer_id)) : undefined;
    return {
      id: String(r.id), customerId: (r.customer_id as string) ?? null, email: (r.customer_email as string) || (c?.email as string) || null,
      name: String(r.customer_name || c?.name || ""), title: String(r.title ?? ""), trades: (r.trades as string[]) ?? [],
      estimateDate: String(r.estimate_date), updatedAt: String(r.updated_at), stage: String(r.pipeline_stage ?? "draft"),
      stageChangedAt: (r.stage_changed_at as string) ?? null, scheduleStatus: (s?.status as string) ?? null, scheduleUpdatedAt: (s?.updated_at as string) ?? null,
    };
  });
}

export async function loadContactFacts(db: Db, accountId: string): Promise<(ContactFact & { name: string | null; customerId: string | null })[]> {
  const { data } = await db.from("comm_contacts").select("id, email, name, customer_id, status, status_reason, basis, last_nurture_at, last_reply_at, enrolled_at").eq("account_id", accountId).limit(10000);
  return ((data ?? []) as Row[]).map((r) => ({
    id: String(r.id), email: String(r.email), name: (r.name as string) ?? null, customerId: (r.customer_id as string) ?? null, status: r.status as ContactFact["status"], basis: r.basis as ContactFact["basis"],
    lastNurtureAt: (r.last_nurture_at as string) ?? null, lastReplyAt: (r.last_reply_at as string) ?? null, enrolledAt: String(r.enrolled_at),
    pending: r.status === "paused" && String(r.status_reason ?? "").startsWith(PENDING_REASON),
  }));
}

export async function loadSuppressions(admin: Db, accountId: string, emails?: string[]): Promise<SuppressionFact[]> {
  let q = admin.from("comm_suppressions").select("account_id, email, scope, reason").or(`account_id.is.null,account_id.eq.${accountId}`).limit(20000);
  if (emails?.length) q = q.in("email", emails);
  const { data } = await q;
  return ((data ?? []) as Row[]).map((r) => ({ accountId: (r.account_id as string) ?? null, email: String(r.email), scope: r.scope as SuppressionFact["scope"], reason: String(r.reason) }));
}

export async function logEvent(admin: Db, e: { accountId: string | null; kind: string; messageId?: string | null; contactId?: string | null; actorId?: string | null; details?: Record<string, unknown>; excerpt?: string | null; fromEmail?: string | null; subject?: string | null; needsAttention?: boolean; providerEventId?: string | null }) {
  const { error } = await admin.from("comm_events").insert({
    account_id: e.accountId, kind: e.kind, message_id: e.messageId ?? null, contact_id: e.contactId ?? null, actor_id: e.actorId ?? null,
    details: e.details ?? {}, excerpt: e.excerpt?.slice(0, 2000) ?? null, from_email: e.fromEmail?.slice(0, 320) ?? null, subject: e.subject?.slice(0, 300) ?? null,
    needs_attention: e.needsAttention ?? false, provider_event_id: e.providerEventId ?? null,
  });
  return !error || error.code !== "23505"; // false = duplicate provider event
}

/**
 * Durable suppression + cancel everything still queued for that address on the account (or all
 * accounts for a hard bounce). Contacts move to the matching status.
 */
export async function suppress(admin: Db, s: { accountId: string | null; email: string; scope: "marketing" | "project_updates" | "all"; reason: "unsubscribe" | "stop_request" | "ambiguous_opt_out" | "bounce" | "complaint" | "manual"; source: string; messageId?: string | null; actorId?: string | null }) {
  const email = s.email.toLowerCase();
  // Unique on (account, email, scope): a repeat is a harmless duplicate-key error.
  await admin.from("comm_suppressions").insert({ account_id: s.accountId, email, scope: s.scope, reason: s.reason, source: s.source.slice(0, 100), message_id: s.messageId ?? null, created_by: s.actorId ?? null });
  const status = s.reason === "bounce" ? "bounced" : s.reason === "unsubscribe" || s.reason === "stop_request" ? "unsubscribed" : "suppressed";
  if (s.scope !== "project_updates") {
    let c = admin.from("comm_contacts").update({ status, status_reason: `${s.reason} (${s.source})`.slice(0, 300), status_changed_at: new Date().toISOString(), status_changed_by: s.actorId ?? null }).eq("email", email);
    if (s.accountId) c = c.eq("account_id", s.accountId);
    await c;
  }
  let q = admin.from("comm_messages").update({ status: "canceled", status_reason: `Suppressed: ${s.reason}`, locked_until: null }).eq("to_email", email).in("status", QUEUED_STATUSES);
  if (s.accountId) q = q.eq("account_id", s.accountId);
  if (s.scope === "marketing") q = q.eq("kind", "nurture");
  if (s.scope === "project_updates") q = q.eq("kind", "project_update");
  await q;
  await logEvent(admin, { accountId: s.accountId, kind: "suppressed", messageId: s.messageId, actorId: s.actorId, details: { reason: s.reason, scope: s.scope, source: s.source } });
}

/** In-app notice (one per dedupe key per person). */
export async function notify(admin: Db, n: { userId: string; companyId: string | null; kind: "customer_update" | "customer_reply"; dedupeKey: string; title: string; scheduleId?: string | null; data: Record<string, unknown> }) {
  await admin.from("user_notifications").upsert({ user_id: n.userId, company_id: n.companyId, kind: n.kind, dedupe_key: n.dedupeKey.slice(0, 200), title: n.title.slice(0, 300), schedule_id: n.scheduleId ?? null, data: n.data },
    { onConflict: "user_id,dedupe_key", ignoreDuplicates: true });
}

/** Schedule data with the service role (cron / webhooks run without a user). */
export async function loadScheduleAdmin(admin: Db, id: string): Promise<(ScheduleData & { raw: Row }) | null> {
  const { data: s } = await admin.from("project_schedules").select("*").eq("id", id).maybeSingle();
  if (!s) return null;
  const r = s as Row;
  const [{ data: tasks }, { data: deps }] = await Promise.all([
    admin.from("schedule_tasks").select("*").eq("schedule_id", id),
    admin.from("schedule_dependencies").select("*").eq("schedule_id", id),
  ]);
  return {
    raw: r,
    schedule: {
      id: String(r.id), estimateId: String(r.estimate_id), companyId: (r.company_id as string) ?? null, name: String(r.name), status: r.status as ScheduleData["schedule"]["status"],
      provisional: Boolean(r.provisional), calendar: normalizeCalendar(r.calendar as never), startDate: String(r.start_date), targetEndDate: (r.target_end_date as string) ?? null,
      progressMethod: r.progress_method === "weight" ? "weight" : "duration", revision: Number(r.revision), updatedAt: String(r.updated_at),
    },
    snapshot: r.source_snapshot as Snapshot,
    tasks: ((tasks ?? []) as Row[]).map(mapTask),
    deps: ((deps ?? []) as Row[]).map((d): Dep => ({ from: String(d.predecessor_id), to: String(d.successor_id), lagDays: Number(d.lag_days ?? 0), maxOverlap: Number(d.max_overlap ?? 0) })),
    revisions: [], canEdit: false, permissions: NO_PERMISSIONS,
  };
}

/** Who reviews a project's customer updates: its PM, else whoever created the schedule, else the bid owner. */
export const projectReviewer = (raw: Row) => String(raw.project_manager_id ?? raw.created_by ?? raw.user_id);
