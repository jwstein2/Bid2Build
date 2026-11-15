/**
 * Owner analytics for the V4 sales pipeline and project-scheduling program (Phase 10).
 * Counts only: no estimate amounts, schedule contents or customer details are read or shown.
 * Rows are scoped to genuine accounts with the same test/internal classification as every other owner
 * page (see scope() in model.ts), so "Include test data" behaves the same everywhere.
 */
import { inWindow, mrrParts, windowOf, type AccountFact, type Compare, compare, type Ratio, ratio } from "./model";
import type { Range } from "./view";

export interface ProductData {
  installed: { pipeline: boolean; schedules: boolean; publications: boolean; editors: boolean; reports: boolean };
  /** Bids by pipeline stage (no amounts). */
  stages: { user_id: string; pipeline_stage: string | null }[];
  stageMoves: { changed_by: string | null; created_at: string }[];
  schedules: { id: string; user_id: string; company_id: string | null; status: string; created_at: string }[];
  publications: { schedule_id: string; published_by: string | null; published_at: string }[];
  editors: { company_id: string; user_id: string; assigned_at: string }[];
  /** Internal Estimate Report generations (who, which action, when: never what was in it). */
  reports: { user_id: string; action: string; created_at: string }[];
}

export const EMPTY_PRODUCT: ProductData = {
  installed: { pipeline: false, schedules: false, publications: false, editors: false, reports: false },
  stages: [], stageMoves: [], schedules: [], publications: [], editors: [], reports: [],
};

/** Keep only rows that belong to accounts the owner is looking at (genuine unless test data is included). */
export function scopeProduct(p: ProductData, keep: (id: string | null | undefined) => boolean): ProductData {
  const schedules = p.schedules.filter((s) => keep(s.user_id));
  const kept = new Set(schedules.map((s) => s.id));
  return {
    installed: p.installed,
    stages: p.stages.filter((s) => keep(s.user_id)),
    stageMoves: p.stageMoves.filter((m) => keep(m.changed_by)),
    schedules,
    publications: p.publications.filter((x) => kept.has(x.schedule_id)),
    editors: p.editors.filter((e) => keep(e.user_id)),
    reports: p.reports.filter((r) => keep(r.user_id)),
  };
}

export interface RevenueSplit {
  coreCents: number; pmAddonCents: number; pmEditorCents: number; totalCents: number;
  pmAddonSubs: number; pmAddonAnnual: number; pmEditorSeats: number; pmEditorCompanies: number;
  /** Add-ons removed but still usable until the paid period ends (not churn until then). */
  pmAddonEnding: number;
  /** Add-ons whose paid period ended inside the window. */
  pmAddonEnded: number;
}

/** Recurring revenue by product, from the same paying subscriptions as the headline MRR. */
export function revenueSplit(facts: AccountFact[], range: Range, now: Date): RevenueSplit {
  const w = windowOf(range, now);
  const paying = facts.filter((f) => f.paying && f.sub);
  const parts = paying.map((f) => ({ f, p: mrrParts(f.sub!) }));
  const sum = (k: "core" | "pmAddon" | "pmEditors") => parts.reduce((n, x) => n + x.p[k], 0);
  const withAddon = parts.filter((x) => x.p.pmAddon > 0);
  const withEditors = parts.filter((x) => x.p.pmEditors > 0);
  const subs = facts.map((f) => f.sub).filter((s): s is NonNullable<typeof s> => Boolean(s));
  return {
    coreCents: sum("core"), pmAddonCents: sum("pmAddon"), pmEditorCents: sum("pmEditors"),
    totalCents: sum("core") + sum("pmAddon") + sum("pmEditors"),
    pmAddonSubs: withAddon.length, pmAddonAnnual: withAddon.filter((x) => x.f.sub!.plan === "annual").length,
    pmEditorSeats: withEditors.reduce((n, x) => n + (x.f.sub!.pm_extra_editors ?? 0), 0), pmEditorCompanies: withEditors.length,
    pmAddonEnding: subs.filter((s) => !s.pm_addon && s.pm_addon_until && Date.parse(s.pm_addon_until) > w.end).length,
    pmAddonEnded: subs.filter((s) => !s.pm_addon && inWindow(s.pm_addon_until, w.start, w.end)).length,
  };
}

export interface Adoption {
  pipelineAccounts: number; pipelineMovers: Compare; bidsByStage: { stage: string; n: number }[];
  reports: Compare; reportAccounts: number; reportAdoption: Ratio; reportsByAction: { action: string; n: number }[];
  schedules: number; schedulesNew: Compare; scheduleAccounts: number;
  publications: Compare; publicationsAll: number;
  editorSeats: number; editorCompanies: number;
}

const PIPELINE_STAGES = ["draft", "sent", "pending", "ready_for_review", "approved", "won", "scheduled", "in_progress", "completed", "lost"];

export function adoption(p: ProductData, facts: AccountFact[], range: Range, now: Date): Adoption {
  const w = windowOf(range, now);
  const cur = <T,>(rows: T[], at: (r: T) => string | null) => rows.filter((r) => inWindow(at(r), w.start, w.end));
  const prev = <T,>(rows: T[], at: (r: T) => string | null) => rows.filter((r) => inWindow(at(r), w.prevStart, w.start - 1));
  const distinct = <T,>(rows: T[], key: (r: T) => string | null) => new Set(rows.map(key).filter(Boolean)).size;

  const stageCount = new Map<string, number>();
  for (const s of p.stages) { const k = s.pipeline_stage ?? "draft"; stageCount.set(k, (stageCount.get(k) ?? 0) + 1); }
  const bidsByStage = [...PIPELINE_STAGES, ...[...stageCount.keys()].filter((k) => !PIPELINE_STAGES.includes(k))].filter((k) => stageCount.has(k)).map((stage) => ({ stage, n: stageCount.get(stage)! }));

  const reportsNow = cur(p.reports, (r) => r.created_at);
  const premium = facts.filter((f) => f.paying || f.comp).length;
  const actions = new Map<string, number>();
  for (const r of reportsNow) actions.set(r.action, (actions.get(r.action) ?? 0) + 1);
  const live = p.schedules.filter((s) => s.status !== "archived");
  return {
    pipelineAccounts: distinct(p.stages.filter((s) => s.pipeline_stage && s.pipeline_stage !== "draft"), (s) => s.user_id),
    pipelineMovers: compare(distinct(cur(p.stageMoves, (m) => m.created_at), (m) => m.changed_by), distinct(prev(p.stageMoves, (m) => m.created_at), (m) => m.changed_by)),
    bidsByStage,
    reports: compare(reportsNow.length, prev(p.reports, (r) => r.created_at).length),
    reportAccounts: distinct(reportsNow, (r) => r.user_id),
    reportAdoption: ratio(distinct(p.reports, (r) => r.user_id), premium),
    reportsByAction: [...actions].map(([action, n]) => ({ action, n })),
    schedules: live.length,
    schedulesNew: compare(cur(p.schedules, (s) => s.created_at).length, prev(p.schedules, (s) => s.created_at).length),
    scheduleAccounts: distinct(live, (s) => s.user_id),
    publications: compare(cur(p.publications, (x) => x.published_at).length, prev(p.publications, (x) => x.published_at).length),
    publicationsAll: p.publications.length,
    editorSeats: p.editors.length, editorCompanies: new Set(p.editors.map((e) => e.company_id)).size,
  };
}
