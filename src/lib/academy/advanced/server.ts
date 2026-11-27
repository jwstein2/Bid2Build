import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/server";
import { isSupabaseConfigured, serverEnv } from "@/lib/env";
import { loadMe } from "@/lib/academy/server";
import type { CoverTheme } from "@/lib/academy/types";
import { accessFor } from "./billing";
import { isAdvancedBillingEnabled, isAdvancedFlagOn, isAutoAdvanceAllowed, stripeMode } from "./flags";
import { DEFAULT_STAGES, NO_ACCESS, type Access, type Stage } from "./plans";

/**
 * Academy Advanced read layer. Catalog metadata (titles, outlines, lesson counts, prices) is public; lesson bodies are
 * still filtered by RLS (academy_lesson_readable_in) when the lesson page reads them as the visitor.
 */

export type AdvSettings = { enabled: boolean; enrollment_open: boolean; current_stage: number; auto_advance: boolean; count_basis: "lifetime" | "active"; reservation_minutes: number };
export type AdvSubject = {
  slug: string; title: string; summary: string; description: string | null; outcomes: string[]; icon: string | null; cover_theme: CoverTheme;
  status: "draft" | "upcoming" | "published" | "retired"; recommended_next: string | null; recommend_reason: string | null; sort_order: number;
  courses: { id: string; slug: string; title: string; status: string; lessons: number; preview_lessons: number; minutes: number }[];
  purchasable: boolean;
};

const admin = () => (isSupabaseConfigured() && serverEnv().supabaseServiceKey ? createAdminClient() : null);

export const loadAdvSettings = cache(async (): Promise<AdvSettings | null> => {
  const db = admin();
  if (!db) return null;
  const { data, error } = await db.from("academy_adv_settings").select("enabled, enrollment_open, current_stage, auto_advance, count_basis, reservation_minutes").maybeSingle();
  return error || !data ? null : (data as AdvSettings);
});

export const loadStages = cache(async (): Promise<Stage[]> => {
  const db = admin();
  if (!db) return DEFAULT_STAGES;
  const { data, error } = await db.from("academy_adv_price_stages").select("*").order("stage");
  return error || !data?.length ? DEFAULT_STAGES : (data as Stage[]);
});

/** Is Advanced Learning visible to this visitor? Staff (Academy admin/instructor, platform admin) can always preview. */
export const advancedState = cache(async () => {
  const [{ me, user }, settings] = await Promise.all([loadMe(), loadAdvSettings()]);
  const staff = Boolean(me.platform_admin || me.role === "admin" || me.role === "instructor");
  const migrated = settings !== null;
  const publicOn = isAdvancedFlagOn() && Boolean(settings?.enabled);
  return { me, user, settings, staff, migrated, visible: migrated && (publicOn || staff), publicOn, billing: isAdvancedBillingEnabled() && migrated, mode: stripeMode() };
});

export const loadMyAccess = cache(async (): Promise<Access> => {
  const { user } = await loadMe();
  const db = admin();
  if (!user || !db) return NO_ACCESS;
  return accessFor(db, user.id);
});

export const listSubjects = cache(async (opts: { includeDraft?: boolean } = {}): Promise<AdvSubject[]> => {
  const db = admin();
  if (!db) return [];
  const { data: subs, error } = await db.from("academy_adv_subjects").select("*").order("sort_order");
  if (error || !subs) return [];
  const { data: courses } = await db.from("academy_courses").select("id, slug, title, status, adv_subject, sort_order").not("adv_subject", "is", null).order("sort_order");
  const ids = (courses ?? []).map((c) => c.id as string);
  const { data: lessons } = ids.length
    ? await db.from("academy_lessons").select("course_id, access, estimated_minutes").in("course_id", ids).eq("status", "published")
    : { data: [] as { course_id: string; access: string; estimated_minutes: number | null }[] };
  const out: AdvSubject[] = [];
  for (const s of subs as Omit<AdvSubject, "courses" | "purchasable">[]) {
    if (!opts.includeDraft && !["upcoming", "published"].includes(s.status)) continue;
    const cs = (courses ?? []).filter((c) => c.adv_subject === s.slug).map((c) => {
      const ls = (lessons ?? []).filter((l) => l.course_id === c.id);
      return { id: c.id as string, slug: c.slug as string, title: c.title as string, status: c.status as string, lessons: ls.length, preview_lessons: ls.filter((l) => l.access !== "advanced").length, minutes: ls.reduce((n, l) => n + (l.estimated_minutes ?? 0), 0) };
    });
    const { data: p } = await db.rpc("academy_adv_purchasable", { p_subject: s.slug });
    out.push({ ...s, outcomes: s.outcomes ?? [], courses: cs, purchasable: p === true });
  }
  return out;
});

export async function getSubject(slug: string, opts: { includeDraft?: boolean } = {}): Promise<AdvSubject | null> {
  return (await listSubjects(opts)).find((s) => s.slug === slug) ?? null;
}

/** The pricing stage a new member would be quoted right now (display only; the quote is authoritative). */
export const displayStage = cache(async (): Promise<Stage> => {
  const [stages, settings] = await Promise.all([loadStages(), loadAdvSettings()]);
  const db = admin();
  const mode = stripeMode() ?? "test";
  let stage = settings?.current_stage ?? 1;
  if (db && settings) {
    const { data } = await db.rpc("academy_adv_effective_stage", { p_mode: mode, p_extra: 0, p_auto_allowed: isAutoAdvanceAllowed() });
    if (typeof data === "number") stage = data;
  }
  return stages.find((s) => s.stage === stage) ?? stages[0];
});

/** The person's live Academy memberships (newest first). */
export async function myMemberships(userId: string) {
  const db = admin();
  if (!db) return [];
  const { data } = await db.from("academy_adv_memberships").select("*").eq("user_id", userId).order("created_at", { ascending: false });
  return (data ?? []) as {
    id: string; plan: "one_subject" | "two_subjects" | "all_access"; subjects: string[]; amount_cents: number | null; stage: number | null; status: string;
    current_period_end: string | null; cancel_at_period_end: boolean; stripe_subscription_id: string; mode: string; created_at: string;
  }[];
}
