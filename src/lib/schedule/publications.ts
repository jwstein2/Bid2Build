import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rowToBusiness } from "@/lib/data/mappers";
import { hashSigningToken, isSigningToken } from "@/lib/esign/token";
import { tradeName } from "@/lib/trades/catalog";
import { todayIn } from "./calendar";
import { buildCustomerReport, type CustomerReport, type DeliveryMethod, type ReportOptions } from "./report";
import { reportAssignee, type ReportAssignees } from "@/lib/projects/team";
import type { ScheduleData } from "./types";

type Row = Record<string, unknown>;

export interface Delivery { method: DeliveryMethod; at: string; by: string | null }
export interface Publication {
  id: string;
  scheduleId: string;
  version: number;
  scheduleRevision: number;
  publishedAt: string;
  publishedBy: string | null;
  publisherName: string | null;
  options: ReportOptions;
  content: CustomerReport;
  link: { state: "none" | "active" | "expired" | "revoked"; createdAt: string | null; expiresAt: string | null; viewCount: number; lastViewedAt: string | null };
  delivery: Delivery[];
}

export const PUBLICATION_COLUMNS = "id, schedule_id, version, schedule_revision, published_at, published_by, publisher_name, options, content, token_hash, link_created_at, link_expires_at, link_revoked_at, view_count, last_viewed_at, delivery";

export function linkState(r: Row, now = Date.now()): Publication["link"]["state"] {
  if (!r.token_hash) return "none";
  if (r.link_revoked_at) return "revoked";
  return r.link_expires_at && Date.parse(String(r.link_expires_at)) > now ? "active" : "expired";
}

export function mapPublication(r: Row): Publication {
  return {
    id: String(r.id), scheduleId: String(r.schedule_id), version: Number(r.version), scheduleRevision: Number(r.schedule_revision),
    publishedAt: String(r.published_at), publishedBy: r.published_by ? String(r.published_by) : null, publisherName: r.publisher_name ? String(r.publisher_name) : null,
    options: r.options as ReportOptions, content: r.content as CustomerReport,
    link: {
      state: linkState(r), createdAt: r.link_created_at ? String(r.link_created_at) : null, expiresAt: r.link_expires_at ? String(r.link_expires_at) : null,
      viewCount: Number(r.view_count ?? 0), lastViewedAt: r.last_viewed_at ? String(r.last_viewed_at) : null,
    },
    delivery: Array.isArray(r.delivery) ? (r.delivery as Delivery[]) : [],
  };
}

/** Published updates for a schedule the caller can read (RLS), newest first. Empty before the migration. */
export async function listPublications(supabase: SupabaseClient, scheduleId: string): Promise<Publication[]> {
  const { data, error } = await supabase.from("schedule_publications").select(PUBLICATION_COLUMNS).eq("schedule_id", scheduleId).order("version", { ascending: false }).limit(100);
  if (error || !data) return [];
  return (data as Row[]).map(mapPublication);
}

export async function getPublication(supabase: SupabaseClient, scheduleId: string, id: string): Promise<Publication | null> {
  const { data } = await supabase.from("schedule_publications").select(PUBLICATION_COLUMNS).eq("schedule_id", scheduleId).eq("id", id).maybeSingle();
  return data ? mapPublication(data as Row) : null;
}

/**
 * Branding and contact details of the bid's owner (a teammate's company bid carries the owner's
 * profile, as on its proposal). Read with the service role after the caller's access was checked.
 */
export async function ownerBranding(supabase: SupabaseClient, admin: SupabaseClient, scheduleId: string) {
  const { data: s } = await supabase.from("project_schedules").select("user_id").eq("id", scheduleId).maybeSingle();
  const ownerId = (s as { user_id?: string } | null)?.user_id;
  const { data: row } = ownerId ? await admin.from("business_profiles").select("*").eq("user_id", ownerId).maybeSingle() : { data: null };
  const b = rowToBusiness(row);
  return {
    company: { name: b.companyName, phone: b.phone ?? null, email: b.email ?? null, website: b.website ?? null, color: b.primaryColor ?? null, hasLogo: Boolean(b.logoPath) },
    logoPath: b.logoPath ?? null,
    contactName: b.contactName ?? null,
  };
}

/**
 * V4.2: "who's doing it" per section, from Team & Subcontractors assignments only, limited by the
 * project's report setting. Empty before that SQL runs or when the setting is "hidden".
 */
export async function reportAssignees(supabase: SupabaseClient, scheduleId: string): Promise<{ mode: ReportAssignees; bySection: Record<string, string> }> {
  // Never let this optional detail break previewing or publishing an update.
  try { return await loadReportAssignees(supabase, scheduleId); } catch { return { mode: "names", bySection: {} }; }
}
async function loadReportAssignees(supabase: SupabaseClient, scheduleId: string): Promise<{ mode: ReportAssignees; bySection: Record<string, string> }> {
  const none = { mode: "names" as ReportAssignees, bySection: {} };
  const { data: s, error } = await supabase.from("project_schedules").select("report_assignees").eq("id", scheduleId).maybeSingle();
  if (error || !s) return none;
  const mode = ((s as { report_assignees?: string }).report_assignees ?? "names") as ReportAssignees;
  if (mode === "hidden") return { mode, bySection: {} };
  const { data: rows } = await supabase.from("schedule_tasks").select("id, resource_id").eq("schedule_id", scheduleId).eq("kind", "section").not("resource_id", "is", null);
  const ids = [...new Set(((rows ?? []) as { resource_id: string }[]).map((r) => r.resource_id))];
  if (!ids.length) return { mode, bySection: {} };
  const { data: res } = await supabase.from("pm_resources").select("id, name, phone, email").in("id", ids);
  const byId = new Map(((res ?? []) as { id: string; name: string; phone: string | null; email: string | null }[]).map((r) => [r.id, r]));
  const bySection: Record<string, string> = {};
  for (const r of (rows ?? []) as { id: string; resource_id: string }[]) {
    const line = reportAssignee(mode, byId.get(r.resource_id) ?? null, null);
    if (line) bySection[r.id] = line;
  }
  return { mode, bySection };
}

/** Builds the report the customer would see now, compared with the last published update. */
export async function previewReport(supabase: SupabaseClient, admin: SupabaseClient, data: ScheduleData, options: Partial<ReportOptions>) {
  const [brand, pubs, asg] = await Promise.all([ownerBranding(supabase, admin, data.schedule.id), listPublications(supabase, data.schedule.id), reportAssignees(supabase, data.schedule.id)]);
  const report = buildCustomerReport(data, options, {
    assignees: asg.bySection,
    company: brand.company,
    today: todayIn(data.schedule.calendar.timezone),
    tradeLabel: tradeName,
    previous: pubs[0]?.content ?? null,
  });
  return { report, brand, last: pubs[0] ?? null, assigneeMode: asg.mode };
}

export const contentHash = (r: CustomerReport) => createHash("sha256").update(JSON.stringify(r)).digest("hex");

export async function loadLogoData(admin: SupabaseClient, path: string | null): Promise<{ data: Buffer; format: "png" } | null> {
  if (!path) return null;
  const { data: file } = await admin.storage.from("logos").download(path);
  return file ? { data: Buffer.from(await file.arrayBuffer()), format: "png" } : null;
}

export interface PublicUpdate { id: string; version: number; publishedAt: string; content: CustomerReport; logoPath: string | null; phase: "active" | "expired" | "revoked"; expiresAt: string | null }

/** Customer side: one publication by its secret link (service role). Null when the token is unknown. */
export async function loadUpdateByToken(admin: SupabaseClient, token: string): Promise<PublicUpdate | null> {
  if (!isSigningToken(token)) return null;
  const { data } = await admin.from("schedule_publications")
    .select("id, version, published_at, content, logo_path, token_hash, link_expires_at, link_revoked_at")
    .eq("token_hash", hashSigningToken(token)).maybeSingle();
  if (!data) return null;
  const r = data as Row;
  const state = linkState(r);
  return {
    id: String(r.id), version: Number(r.version), publishedAt: String(r.published_at), content: r.content as CustomerReport,
    logoPath: r.logo_path ? String(r.logo_path) : null, phase: state === "none" ? "revoked" : state, expiresAt: r.link_expires_at ? String(r.link_expires_at) : null,
  };
}

/** Counts a customer view (best effort; never blocks the page). */
export async function recordView(admin: SupabaseClient, id: string) {
  try {
    const { data } = await admin.from("schedule_publications").select("view_count").eq("id", id).maybeSingle();
    await admin.from("schedule_publications").update({ view_count: Number((data as { view_count?: number } | null)?.view_count ?? 0) + 1, last_viewed_at: new Date().toISOString() }).eq("id", id);
  } catch { /* ignore */ }
}

export function publicationDbError(e: { message?: string } | null): { status: number; code: string; message: string } {
  const m = e?.message ?? "";
  if (m.includes("stale_revision")) return { status: 409, code: "stale_revision", message: "The schedule changed after this preview. Review the preview again before publishing." };
  if (m.includes("forbidden")) return { status: 403, code: "forbidden", message: "You can view this schedule but can't publish customer updates." };
  if (m.includes("invalid")) return { status: 400, code: "invalid", message: "That request isn't valid." };
  return { status: 500, code: "server_error", message: "Something went wrong. Nothing was published. Please try again." };
}
