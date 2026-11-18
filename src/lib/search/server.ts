import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isFinancialsEnabled, isPmEnabled } from "@/lib/env";
import { missingMigration } from "@/lib/operations/server";
import { parseQuery, type ParsedQuery } from "./query";
import { FIN_KINDS, GROUPS, PM_KINDS, SEARCH_KINDS, isSearchKind, toResult, type GroupId, type SearchKind, type SearchResult, type SearchRow } from "./kinds";
import { scoredActions, toActionResult, type ActionResult, type SearchCaps } from "./actions";
import { searchNews, type NewsHit } from "@/lib/news/search";

export interface SearchParams {
  q: string;
  mode: "quick" | "page";
  types?: SearchKind[] | null;
  status?: string | null;
  trade?: string | null;
  customer?: string | null;
  project?: string | null;
  person?: string | null;
  from?: string | null;
  to?: string | null;
  sort?: "relevance" | "newest" | "oldest" | "name";
  page?: number;
  scope?: "all" | "project";
  context?: { estimateId?: string | null; scheduleId?: string | null };
}

export interface SearchGroup { id: GroupId; label: string; total: number; capped: boolean; results: SearchResult[] }
export interface SearchResponse {
  available: boolean;
  query: Pick<ParsedQuery, "text" | "understood" | "status"> & { types: SearchKind[] | null };
  groups: SearchGroup[];
  results: SearchResult[];         // page mode: one sorted page
  total: number;
  page: number;
  pageSize: number;
  actions: ActionResult[];
  /** The words read as a command ("new invoice"): show actions above records. */
  actionsFirst: boolean;
  admin: { userId: string; email: string; company: string | null }[];
  workspace: "live" | "sandbox" | null;
  /** V6.8: public industry articles, shown in their own group, never mixed with company records. */
  news: NewsHit[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const uuidOrNull = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : null);
export const dateOrNull = (v: unknown) => (typeof v === "string" && DATE.test(v) ? v : null);
export const PAGE_SIZE = 25;
const PER_TYPE_CAP = 300;

/** What the caller may do, from the database (company permissions, Premium, Financials book, admin) + feature switches. */
export async function loadCaps(db: SupabaseClient): Promise<SearchCaps | null> {
  const { data, error } = await db.rpc("search_capabilities");
  if (error) {
    if (missingMigration(error)) return null;
    throw error;
  }
  const d = (data ?? {}) as { premium?: boolean; admin?: boolean; company?: SearchCaps["company"]; fin?: SearchCaps["fin"] };
  return {
    premium: Boolean(d.premium), admin: Boolean(d.admin),
    company: d.company ? { id: d.company.id, role: d.company.role, perms: d.company.perms ?? [] } : null,
    fin: d.fin ? { book: d.fin.book, sandbox: Boolean(d.fin.sandbox), perms: d.fin.perms ?? [] } : null,
    flags: { pm: isPmEnabled(), financials: isFinancialsEnabled() },
  };
}

/** Kinds this account can search at all (feature switches). Row-level permissions are enforced by the database. */
export function searchableKinds(caps: SearchCaps): SearchKind[] {
  return SEARCH_KINDS.filter((k) => (caps.flags.financials || !FIN_KINDS.includes(k)) && (caps.flags.pm || !PM_KINDS.includes(k)));
}

export async function runSearch(db: SupabaseClient, p: SearchParams): Promise<SearchResponse> {
  const parsed = parseQuery(p.q);
  const empty: SearchResponse = { available: true, query: { text: parsed.text, understood: parsed.understood, status: parsed.status, types: parsed.types }, groups: [], results: [], total: 0, page: 1, pageSize: PAGE_SIZE, actions: [], actionsFirst: false, admin: [], workspace: null, news: [] };
  const caps = await loadCaps(db);
  if (!caps) return { ...empty, available: false };
  const allowed = searchableKinds(caps);
  // Explicit filters (results page) win over what the words implied.
  const wanted = p.types?.length ? p.types : parsed.types;
  const types = (wanted ?? allowed).filter((k) => allowed.includes(k));
  const status = p.status ?? parsed.status;
  const scored = p.mode === "quick" ? scoredActions(parsed.raw, caps) : [];
  const actions = scored.map(({ a }) => toActionResult(a, caps));
  const actionsFirst = (scored[0]?.s ?? 0) >= 80;
  const workspace = caps.fin ? (caps.fin.sandbox ? "sandbox" : "live") : null;
  const hasFilters = Boolean(status || p.trade || p.customer || p.project || p.person || p.from || p.to || p.scope === "project");
  const newsP = p.mode === "quick" && !wanted && !hasFilters ? searchNews(db, parsed.raw) : Promise.resolve([] as NewsHit[]);
  if ((!parsed.text && !wanted && !hasFilters) || !types.length) return { ...empty, actions, actionsFirst, workspace, news: await newsP };

  const page = Math.max(1, Math.min(200, p.page ?? 1));
  const { data, error } = await db.rpc("search_universal", {
    p_q: parsed.text,
    p_types: parsed.text && types.length === allowed.length && !wanted ? null : types,
    p_boost: parsed.boost.filter((k) => types.includes(k)),
    p_filters: { status, trade: p.trade ?? null, customer: p.customer ?? null, project: p.project ?? null, person: p.person ?? null, from: p.from ?? null, to: p.to ?? null, scope: p.scope === "project" ? "project" : null },
    p_context: { estimate_id: p.context?.estimateId ?? null, schedule_id: p.context?.scheduleId ?? null },
    p_per_type: p.mode === "quick" ? 5 : 0,
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
    p_sort: p.sort ?? "relevance",
  });
  if (error) {
    if (missingMigration(error)) return { ...empty, available: false, actions, actionsFirst };
    throw error;
  }
  const rows = ((data ?? []) as SearchRow[]).filter((r) => isSearchKind(r.kind));
  const results = rows.map(toResult);
  const totals = new Map<SearchKind, number>();
  for (const r of rows) totals.set(r.kind, r.total_kind);
  const groups: SearchGroup[] = GROUPS.map((g) => {
    const total = g.kinds.reduce((n, k) => n + (totals.get(k) ?? 0), 0);
    return { id: g.id, label: g.label, total, capped: g.kinds.some((k) => (totals.get(k) ?? 0) >= PER_TYPE_CAP), results: results.filter((r) => r.group === g.id) };
  }).filter((g) => g.results.length > 0);
  // Best group first: the group holding the top-scored result leads, then by best score.
  const best = new Map<GroupId, number>();
  rows.forEach((r, i) => { const gid = toResult(r).group; if (!best.has(gid)) best.set(gid, i); });
  groups.sort((a, b) => (best.get(a.id) ?? 0) - (best.get(b.id) ?? 0));

  let admin: SearchResponse["admin"] = [];
  if (caps.admin && p.mode === "quick" && parsed.raw.length >= 3) {
    const { data: acc } = await db.rpc("search_admin_accounts", { p_q: parsed.raw, p_limit: 5 });
    admin = ((acc ?? []) as { user_id: string; email: string; company_name: string | null }[]).map((a) => ({ userId: a.user_id, email: a.email, company: a.company_name }));
  }
  return {
    ...empty, groups, results: p.mode === "page" ? results : [], total: rows[0]?.total_all ?? 0, page, actions, actionsFirst, admin, workspace, news: await newsP,
  };
}

/** Parse the URL query of /api/search and /search into SearchParams (unknown values are dropped). */
export function paramsFromUrl(sp: URLSearchParams, mode: "quick" | "page"): SearchParams {
  const types = (sp.get("types") ?? sp.get("type") ?? "").split(",").filter(isSearchKind);
  const sort = sp.get("sort");
  return {
    q: (sp.get("q") ?? "").slice(0, 100),
    mode,
    types: types.length ? types : null,
    status: /^[a-z_,]{1,60}$/.test(sp.get("status") ?? "") ? sp.get("status") : null,
    trade: /^[a-z-]{2,40}$/.test(sp.get("trade") ?? "") ? sp.get("trade") : null,
    customer: uuidOrNull(sp.get("customer")),
    project: uuidOrNull(sp.get("project")),
    person: uuidOrNull(sp.get("person")),
    from: dateOrNull(sp.get("from")),
    to: dateOrNull(sp.get("to")),
    sort: sort === "newest" || sort === "oldest" || sort === "name" ? sort : "relevance",
    page: Number(sp.get("page")) || 1,
    scope: sp.get("scope") === "project" ? "project" : "all",
    context: { estimateId: uuidOrNull(sp.get("ctx_estimate")), scheduleId: uuidOrNull(sp.get("ctx_schedule")) },
  };
}
