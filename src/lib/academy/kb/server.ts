import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { isSupabaseConfigured, serverEnv } from "@/lib/env";
import { parseUsAddress } from "@/lib/geo/address";
import { tradeSlugFrom } from "@/lib/news/prefs";
import { logError } from "@/lib/http/api";
import { academyDb, isMissing, loadMe } from "../server";
import { categoryFor, isAnswered, type CodeCategory } from "./answer";
import { LOCATION_COOKIE, locationFrom, parseLocationCookie } from "./location";
import type { KbLocalInfo, KbLocation, KbResult } from "./types";

/**
 * Academy knowledge engine read layer. Reads run as the visitor (RLS: learners see verified material and title-only
 * rows under review; staff see everything). Search is plain Postgres full-text + exact section + approved terminology
 * (academy_kb_search): no AI call and no per-search cost.
 */

/** Whether the Codes area is visible: on for everyone once an admin turns it on; Academy staff always see it. */
export const kbAccess = cache(async (): Promise<{ migrated: boolean; enabled: boolean; staff: boolean; editor: boolean; admin: boolean }> => {
  const { me } = await loadMe();
  const staff = Boolean(me.role && ["admin", "moderator", "instructor"].includes(me.role));
  const editor = Boolean(me.role && ["admin", "instructor"].includes(me.role));
  const admin = me.role === "admin";
  const db = await academyDb();
  if (!db) return { migrated: false, enabled: false, staff, editor, admin };
  const { data, error } = await db.from("academy_settings").select("kb_enabled").maybeSingle();
  if (error) return { migrated: !(isMissing(error) || error.code === "42703"), enabled: false, staff, editor, admin };
  return { migrated: true, enabled: Boolean((data as { kb_enabled?: boolean } | null)?.kb_enabled), staff, editor, admin };
});

/**
 * The location to start from: explicit query params, then the visitor's saved Academy location (cookie), then the
 * signed-in account's business address / primary trade (never a full address is required), then nothing.
 */
export async function resolveLocation(sp: Record<string, string | string[] | undefined>): Promise<KbLocation> {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  if (one("state") || one("zip")) return locationFrom({ zip: one("zip"), state: one("state"), local: one("local"), trade: one("trade") }, "saved");
  const saved = parseLocationCookie((await cookies()).get(LOCATION_COOKIE)?.value);
  if (saved) return one("trade") ? { ...saved, trade: locationFrom({ trade: one("trade") }, "saved").trade } : saved;
  const user = await getUser();
  if (user && isSupabaseConfigured()) {
    const db = await createClient();
    const [{ data: biz }, { data: fin }, { me }] = await Promise.all([
      db.from("business_profiles").select("primary_trade, address").eq("user_id", user.id).maybeSingle().then((r) => r, () => ({ data: null })),
      db.from("fin_business_config").select("primary_trade_slug").limit(1).maybeSingle().then((r) => r, () => ({ data: null })),
      loadMe(),
    ]);
    const addr = parseUsAddress((biz as { address?: string | null } | null)?.address ?? null);
    const trade = one("trade") ?? (fin as { primary_trade_slug?: string | null } | null)?.primary_trade_slug ?? tradeSlugFrom((biz as { primary_trade?: string | null } | null)?.primary_trade ?? null) ?? me.primary_trade ?? undefined;
    if (addr.zip || addr.state) return locationFrom({ zip: addr.zip ?? undefined, state: addr.state ?? undefined, trade }, "business");
    const memberState = (me as { state_code?: string | null }).state_code ?? null;
    if (memberState || trade) return locationFrom({ state: memberState ?? undefined, trade }, "academy_profile");
  }
  return locationFrom({ trade: one("trade") }, "none");
}

export interface SearchInput { q: string; state: string | null; local: string | null; trade: string | null; family?: string | null; edition?: string | null; section?: string | null; history?: boolean }

export async function searchKb(input: SearchInput): Promise<{ results: KbResult[]; suggestions: { term: string; related: string[]; note: string | null }[]; ok: boolean }> {
  const db = await academyDb();
  if (!db) return { results: [], suggestions: [], ok: false };
  const q = input.q.slice(0, 300);
  const [{ data, error }, { data: sugg }] = await Promise.all([
    db.rpc("academy_kb_search", {
      p_q: q || null, p_state: input.state, p_local: input.local, p_trades: input.trade ? [input.trade] : null, p_family: input.family || null,
      p_edition: input.edition || null, p_section: input.section || null, p_include_history: Boolean(input.history), p_limit: 25,
    }),
    q.length >= 2 ? db.rpc("academy_kb_suggest", { p_q: q }) : Promise.resolve({ data: [] as unknown[] }),
  ]);
  if (error) {
    if (!isMissing(error)) logError("academy.kb.search", error);
    return { results: [], suggestions: [], ok: false };
  }
  const results = (data ?? []) as KbResult[];
  if (q && serverEnv().supabaseServiceKey) {
    // Aggregate trend only (no user id). Never blocks the page.
    const answered = isAnswered(results);
    void createAdminClient().rpc("academy_kb_log_search", { p_q: q, p_state: input.state, p_trade: input.trade, p_answered: answered }).then(({ error: e }) => { if (e && !isMissing(e)) logError("academy.kb.log_search", e); });
  }
  return { results, suggestions: ((sugg ?? []) as { term: string; related: string[]; note: string | null }[]), ok: true };
}

export interface CoverageFamily {
  family: string; name: string; edition: string; authority: string; effective_date: string | null; status: string; local_confirmation_required: boolean; kind: string; expiration_date: string | null;
  /** Official page for this adoption (or the publication). */
  official_url: string | null;
  /** Verified sections with official text Built2Bid can search for this publication (0 = official reference only). */
  searchable_sections: number;
  category: CodeCategory;
}
export interface Coverage { state: string | null; note?: string | null; directory?: string | null; families: CoverageFamily[] }

/** What is on file for a state (and federal): adopted code families, editions and authorities. */
export async function coverageFor(state: string | null): Promise<Coverage> {
  const db = await academyDb();
  if (!db) return { state, families: [] };
  const ids = ["US", ...(state ? [state] : [])];
  const juris = state ? db.from("academy_kb_jurisdictions").select("notes, building_dept_url").eq("id", state).maybeSingle() : null;
  const { data, error } = await db.from("academy_kb_adoptions")
    .select("kind, authority_citation, official_url, effective_date, expiration_date, status, local_confirmation_required, jurisdiction_id, source_id, academy_kb_sources!academy_kb_adoptions_source_id_fkey(family_slug, edition, short_title, title, official_url, academy_kb_families(name))")
    .in("jurisdiction_id", ids).in("status", ["verified", "pending_review"]).limit(200);
  if (error) { if (!isMissing(error)) logError("academy.kb.coverage", error); return { state, families: [] }; }
  type Row = { kind: string; authority_citation: string; official_url: string | null; effective_date: string | null; expiration_date: string | null; status: string; local_confirmation_required: boolean; jurisdiction_id: string; source_id: string;
    academy_kb_sources: { family_slug: string; edition: string; short_title: string; title: string; official_url: string | null; academy_kb_families: { name: string } | null } | null };
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => r.academy_kb_sources && (r.kind !== "replaces" || r.jurisdiction_id === state) && (r.jurisdiction_id !== "US" || r.kind === "administers"));
  const sourceIds = [...new Set(rows.map((r) => r.source_id))];
  const counts = new Map<string, number>();
  if (sourceIds.length) {
    const { data: secs } = await db.from("academy_kb_sections").select("source_id").in("source_id", sourceIds).eq("status", "verified").neq("body_kind", "title_only").limit(5000);
    for (const x of (secs ?? []) as { source_id: string }[]) counts.set(x.source_id, (counts.get(x.source_id) ?? 0) + 1);
  }
  const families = rows
    .map((r) => ({
      official_url: r.official_url ?? r.academy_kb_sources!.official_url, searchable_sections: counts.get(r.source_id) ?? 0,
      category: r.kind === "replaces" ? ("safety" as const) : categoryFor(r.academy_kb_sources!.family_slug, r.academy_kb_sources!.title),
      family: r.academy_kb_sources!.family_slug, name: r.kind === "replaces" ? `OSHA-approved State Plan` : r.academy_kb_sources!.family_slug === "state_code" ? r.academy_kb_sources!.short_title : r.academy_kb_sources!.academy_kb_families?.name ?? r.academy_kb_sources!.short_title,
      edition: r.academy_kb_sources!.edition, authority: r.authority_citation, effective_date: r.effective_date, expiration_date: r.expiration_date, status: r.status,
      local_confirmation_required: r.local_confirmation_required, kind: r.kind,
    }))
    .filter((f, i, all) => all.findIndex((x) => x.family === f.family && x.authority === f.authority && x.edition === f.edition) === i)
    .sort((a, b) => Number(a.family.startsWith("osha") || a.family === "fmcsa" || a.family.startsWith("epa")) - Number(b.family.startsWith("osha") || b.family === "fmcsa" || b.family.startsWith("epa")) || a.name.localeCompare(b.name));
  const j = juris ? ((await juris).data as { notes: string | null; building_dept_url: string | null } | null) : null;
  return { state, families, note: j?.notes ?? null, directory: j?.building_dept_url ?? null };
}

/** States that have at least one verified adoption (for the honest coverage list). */
export const verifiedStates = cache(async (): Promise<Map<string, number>> => {
  const db = await academyDb();
  const out = new Map<string, number>();
  if (!db) return out;
  const { data } = await db.from("academy_kb_adoptions").select("jurisdiction_id, kind").eq("status", "verified").neq("jurisdiction_id", "US").limit(2000);
  for (const r of (data ?? []) as { jurisdiction_id: string; kind: string }[]) if (r.kind !== "replaces") out.set(r.jurisdiction_id, (out.get(r.jurisdiction_id) ?? 0) + 1);
  return out;
});

export interface SectionDetail {
  id: string; citation: string; section_number: string; title: string; heading_path: string | null; kind: string; body_kind: string; body: string | null; summary: string | null;
  exceptions: string | null; page: string | null; trades: string[]; topics: string[]; official_url: string | null; status: string; last_verified_at: string | null; effective_date: string | null;
  amends_section: string | null; amend_action: string | null;
  source: { id: string; title: string; short_title: string; edition: string; publisher: string; rights: string; rights_note: string; read_url: string | null; official_url: string | null; jurisdiction_id: string | null; pagination_note: string | null; status: string; family_slug: string };
}

export async function getSection(id: string): Promise<SectionDetail | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const db = await academyDb();
  if (!db) return null;
  const { data, error } = await db.from("academy_kb_sections")
    .select("id, citation, section_number, title, heading_path, kind, body_kind, body, summary, exceptions, page, trades, topics, official_url, status, last_verified_at, effective_date, amends_section, amend_action, source:academy_kb_sources!academy_kb_sections_source_id_fkey(id, title, short_title, edition, publisher, rights, rights_note, read_url, official_url, jurisdiction_id, pagination_note, status, family_slug)")
    .eq("id", id).maybeSingle();
  if (error || !data) return null;
  const s = data as unknown as SectionDetail;
  // Requirement text only once verified (title-only rows have none).
  return s.status === "verified" ? s : { ...s, body: null, exceptions: null };
}

export async function applicabilityFor(sectionId: string, state: string | null, local: string | null) {
  const db = await academyDb();
  if (!db) return null;
  const { data } = await db.rpc("academy_kb_applicability", { p_section_id: sectionId, p_state: state, p_local: local });
  return data as KbResult["applicability"] | null;
}

export async function trailFor(type: "source" | "adoption" | "section", id: string): Promise<{ checked_at: string; method: string; result: string; source_url: string | null }[]> {
  const db = await academyDb();
  if (!db) return [];
  const { data } = await db.rpc("academy_kb_trail", { p_target_type: type, p_target_id: id });
  return (data ?? []) as { checked_at: string; method: string; result: string; source_url: string | null }[];
}

/** The picked local permitting authority, when it is on file (only verified local records are stored). */
export async function localAuthority(id: string | null): Promise<KbLocalInfo | null> {
  if (!id) return null;
  const db = await academyDb();
  if (!db) return null;
  const { data, error } = await db.from("academy_kb_jurisdictions")
    .select("id, name, kind, county_name, local_status, phone, detail, source_url, verified_at").eq("id", id).eq("active", true).maybeSingle();
  if (error) { if (!(isMissing(error) || error.code === "42703")) logError("academy.kb.local", error); return null; }
  const r = data as { id: string; name: string; kind: string | null; county_name: string | null; local_status: KbLocalInfo["status"] | null; phone: string | null; detail: KbLocalInfo["detail"] | null; source_url: string | null; verified_at: string | null } | null;
  if (!r || !r.verified_at) return null;
  return { id: r.id, name: r.name, kind: r.kind ?? undefined, county: r.county_name ?? undefined, status: r.local_status ?? "unknown", phone: r.phone ?? undefined, detail: r.detail ?? undefined, source_url: r.source_url ?? undefined, verified_at: r.verified_at };
}

/** Code families for the search filter (only ones with something on file). */
export const listFamilies = cache(async (): Promise<{ slug: string; name: string; short: string }[]> => {
  const db = await academyDb();
  if (!db) return [];
  const { data } = await db.from("academy_kb_families").select("slug, name, short_name, sort_order, academy_kb_sources!inner(id)").order("sort_order").limit(100);
  return ((data ?? []) as { slug: string; name: string; short_name: string }[]).map((f) => ({ slug: f.slug, name: f.name, short: f.short_name }));
});

/**
 * Verified local sections for federal citations ("29 CFR 1926.501" → section ids), so the codebook can link to the
 * verified text we hold and fall back to the official eCFR page for everything else.
 */
export const verifiedFederal = cache(async (): Promise<Map<string, string>> => {
  const out = new Map<string, string>();
  const db = await academyDb();
  if (!db) return out;
  const { data, error } = await db.from("academy_kb_sections").select("id, citation, section_number").eq("status", "verified").like("citation", "% CFR %").limit(500);
  if (error || !data) return out;
  for (const r of data as { id: string; citation: string }[]) {
    const base = r.citation.replace(/\(.*$/, "").trim();
    if (!out.has(base)) out.set(base, r.id);
  }
  return out;
});

