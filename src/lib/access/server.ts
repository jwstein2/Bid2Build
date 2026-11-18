import "server-only";
/**
 * The signed-in person's effective workspace access, from the database (one RPC per request, deduplicated
 * with React cache()). Pages, layouts, API routes, universal search and the dashboard builder all read it
 * from here. Before the V6.7 SQL is applied it falls back to today's permissions (search_capabilities +
 * my_company + my_pm_access) with no access profile, so nothing is hidden that isn't hidden today.
 */
import { cache } from "react";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isFinancialsEnabled, isPmEnabled } from "@/lib/env";
import { missingMigration } from "@/lib/operations/server";
import type { CompanyRole } from "@/lib/enterprise/permissions";
import { FEATURE_BY_ID, type CapabilityRequirement, type FeatureId } from "./capabilities";
import { parseProfile, resolveAccess, restrictedFor, type AccessPolicy, type EffectiveAccess } from "./effective";

/** Raw database answer (my_workspace_access(), or the fallback shaped the same way). */
export interface WorkspaceRaw {
  premium: boolean;
  admin: boolean;
  company: { id: string; role: string; perms: string[] } | null;
  fin: { book: string; sandbox: boolean; perms: string[] } | null;
  member: null | { companyId: string; companyName: string; role: CompanyRole; isOwner: boolean; profile: unknown; policy: AccessPolicy; revoked?: string[] };
  pm: { scope: string; canEdit: boolean };
}

async function fetchRaw(db: SupabaseClient): Promise<WorkspaceRaw | null> {
  const { data, error } = await db.rpc("my_workspace_access");
  if (!error && data) return normalize(data as Partial<WorkspaceRaw>);
  if (error && !missingMigration(error)) throw error;
  // Fallback before 20261222001000_workspace_access.sql: same facts from the older functions.
  const [caps, company, pm] = await Promise.all([db.rpc("search_capabilities"), db.rpc("my_company"), db.rpc("my_pm_access")]);
  if (caps.error) { if (missingMigration(caps.error)) return null; throw caps.error; }
  const c = company.data as null | { id: string; name: string; role: CompanyRole; isOwner: boolean };
  const p = pm.data as null | { scope?: string; canEdit?: boolean };
  return normalize({
    ...(caps.data as Partial<WorkspaceRaw>),
    member: c ? { companyId: c.id, companyName: c.name, role: c.role, isOwner: c.isOwner, profile: null, policy: { denied: [], locked: [] } } : null,
    pm: { scope: p?.scope ?? "none", canEdit: Boolean(p?.canEdit) },
  });
}

function normalize(d: Partial<WorkspaceRaw>): WorkspaceRaw {
  const m = d.member;
  return {
    premium: Boolean(d.premium), admin: Boolean(d.admin),
    company: d.company ? { id: d.company.id, role: d.company.role, perms: d.company.perms ?? [] } : null,
    fin: d.fin ? { book: d.fin.book, sandbox: Boolean(d.fin.sandbox), perms: d.fin.perms ?? [] } : null,
    member: m ? { ...m, policy: { denied: m.policy?.denied ?? [], locked: m.policy?.locked ?? [] } } : null,
    pm: { scope: d.pm?.scope ?? "none", canEdit: Boolean(d.pm?.canEdit) },
  };
}

/** Pure: raw facts + feature switches -> effective access. */
export function accessFromRaw(raw: WorkspaceRaw, flags = { pm: isPmEnabled(), financials: isFinancialsEnabled() }): EffectiveAccess {
  const m = raw.member;
  return resolveAccess({
    company: m && raw.company ? { id: m.companyId, name: m.companyName, role: m.role, isOwner: m.isOwner, perms: raw.company.perms, profile: parseProfile(m.profile), policy: m.policy, revoked: m.revoked ?? [] } : null,
    finPerms: flags.financials && raw.fin ? raw.fin.perms : null,
    licenses: { pm: flags.pm && raw.pm.scope !== "none", pmEditor: raw.pm.canEdit, financials: flags.financials && Boolean(raw.fin), premium: raw.premium },
  });
}

/** One database read per request, shared by the layout, the page and any guard. */
export const loadWorkspaceRaw = cache(async (db: SupabaseClient) => fetchRaw(db));

export const loadEffectiveAccess = cache(async (db: SupabaseClient): Promise<EffectiveAccess | null> => {
  const raw = await loadWorkspaceRaw(db);
  return raw ? accessFromRaw(raw) : null;
});

/**
 * Direct-URL guard for pages and layouts. A company member whose access settings turn the feature off lands
 * on /no-access, which says which feature it is and who can grant it. Records are untouched. A missing plan
 * or seat is left to the page (its upgrade / "needs a seat" message), solo accounts and the primary account
 * holder are never redirected, and the database still enforces every record either way.
 */
export async function requireCapability(db: SupabaseClient, req: CapabilityRequirement | FeatureId): Promise<EffectiveAccess | null> {
  const r = typeof req === "string" ? { feature: req } : req;
  const access = await loadEffectiveAccess(db);
  if (restrictedFor(access, r)) redirect(`/no-access?feature=${encodeURIComponent(r.feature)}`);
  return access;
}

/** For API routes: true when allowed (or when access can't be computed, leaving the route's own checks). */
export async function apiAllows(db: SupabaseClient, req: CapabilityRequirement | FeatureId): Promise<boolean> {
  const r = typeof req === "string" ? { feature: req } : req;
  const access = await loadEffectiveAccess(db);
  return !restrictedFor(access, r);
}

/** Any feature of a workspace (layout guards for whole sections such as /financials). */
export async function requireAnyCapability(db: SupabaseClient, features: FeatureId[]): Promise<EffectiveAccess | null> {
  const access = await loadEffectiveAccess(db);
  if (access && features.every((f) => restrictedFor(access, { feature: f }))) redirect(`/no-access?feature=${encodeURIComponent(features[0])}`);
  return access;
}

export const featureLabel = (id: string) => (id in FEATURE_BY_ID ? FEATURE_BY_ID[id as FeatureId].label : null);
