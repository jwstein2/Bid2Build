import "server-only";
import type { createAdminClient } from "@/lib/supabase/server";
import { bidState } from "@/lib/geo/address";
import { tradeName } from "@/lib/trades/catalog";
import { businessKey, tradeOf, type PlatformData } from "./metrics";

type Db = ReturnType<typeof createAdminClient>;
const PAGE = 1000;
const MAX_ROWS = 50_000;

/** Read every row of a table (selected columns only), a page at a time. Admin reporting only. */
async function all<T>(db: Db, table: string, columns: string, order = "created_at"): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await db.from(table).select(columns).order(order, { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export interface PlatformSnapshot extends PlatformData {
  /** Business display names for the leaderboard and activity feed (company or business profile name). */
  names: Map<string, string>;
  funnel30d: Record<string, number>;
  /** Checkout and subscription funnel events (event name + time only). */
  events: { event: string; created_at: string }[];
  importFailures7d: number; pdfErrors7d: number;
  loadedAt: string;
}

/**
 * Load the raw rows behind the command center. Called only after requireAdmin(). Selects no prices,
 * line items, customer names, emails or notes. The project address is read only to derive a state
 * on the server and is never sent to the browser.
 */
export async function loadPlatform(db: Db, callerId: string): Promise<PlatformSnapshot> {
  const [metrics, estimates, versions, signatures, subscriptions, profiles, businesses, companies, grants, consents, events] = await Promise.all([
    db.rpc("admin_metrics", { p_caller: callerId }),
    all<PlatformData["estimates"][number]>(db, "estimates", "id,user_id,company_id,trades,template_trade,status,created_at,location_state,location_zip,project_address"),
    all<PlatformData["versions"][number]>(db, "estimate_versions", "estimate_id,user_id,created_at,version_number"),
    all<PlatformData["signatures"][number]>(db, "signatures", "estimate_id,user_id,signed_at", "signed_at"),
    all<PlatformData["subscriptions"][number]>(db, "subscriptions", "user_id,status,plan,cancel_at_period_end,canceled_at,ended_at,updated_at,seat_quantity,current_period_end", "updated_at"),
    all<PlatformData["profiles"][number]>(db, "profiles", "id,created_at"),
    all<{ user_id: string; created_at: string; company_name: string | null }>(db, "business_profiles", "user_id,created_at,company_name"),
    all<{ id: string; created_at: string; name: string | null }>(db, "companies", "id,created_at,name"),
    all<PlatformData["grants"][number]>(db, "complimentary_grants", "user_id,status,plan,starts_at,expires_at"),
    all<PlatformData["consents"][number]>(db, "market_consent", "user_id,share_prices", "updated_at"),
    db.from("analytics_events").select("event,created_at").in("event", ["checkout_started", "subscribed"]).order("created_at", { ascending: false }).limit(5000),
  ]);
  const m = (metrics.data ?? {}) as { accounts?: number; verified_accounts?: number; funnel_30d?: Record<string, number>; import_failures_7d?: number; pdf_errors_7d?: number };
  const names = new Map<string, string>();
  for (const b of businesses) if (b.company_name?.trim()) names.set(`u:${b.user_id}`, b.company_name.trim());
  for (const c of companies) if (c.name?.trim()) names.set(c.id, c.name.trim());
  return {
    estimates, versions, signatures, subscriptions, profiles, companies, grants, consents,
    businesses: businesses.map((b) => ({ user_id: b.user_id, created_at: b.created_at, has_name: Boolean(b.company_name?.trim()) })),
    accounts: m.accounts ?? profiles.length, verifiedAccounts: m.verified_accounts ?? 0,
    names, funnel30d: m.funnel_30d ?? {}, events: (events.data ?? []) as { event: string; created_at: string }[], importFailures7d: m.import_failures_7d ?? 0, pdfErrors7d: m.pdf_errors_7d ?? 0,
    loadedAt: new Date().toISOString(),
  };
}

export type ActivityKind = "signup" | "business" | "finalized" | "signed" | "paid";
export interface ActivityItem { kind: ActivityKind; at: string; title: string; detail: string }

/** Recent platform events for the activity feed: business name, trade and state only. */
export function recentActivity(p: PlatformSnapshot, limit = 14): ActivityItem[] {
  const est = new Map(p.estimates.map((e) => [e.id, e]));
  const label = (key: string) => p.names.get(key) ?? "A contractor";
  const items: ActivityItem[] = [];
  for (const pr of p.profiles) items.push({ kind: "signup", at: pr.created_at, title: "New account", detail: p.names.get(`u:${pr.id}`) ?? "Account created" });
  for (const b of p.businesses) if (b.has_name) items.push({ kind: "business", at: b.created_at, title: "Business profile added", detail: label(`u:${b.user_id}`) });
  for (const c of p.companies) items.push({ kind: "business", at: c.created_at, title: "Enterprise company created", detail: label(c.id) });
  const firstVersion = new Map<string, string>();
  for (const v of p.versions) if (v.version_number === 1 || !firstVersion.has(v.estimate_id)) firstVersion.set(v.estimate_id, v.created_at);
  for (const [id, at] of firstVersion) {
    const e = est.get(id); if (!e) continue;
    items.push({ kind: "finalized", at, title: "Bid finalized", detail: [label(businessKey(e)), tradeName(tradeOf(e)), bidState(e).state].filter(Boolean).join(" · ") });
  }
  for (const s of p.signatures) {
    const e = est.get(s.estimate_id); if (!e) continue;
    items.push({ kind: "signed", at: s.signed_at, title: "Bid signed by customer", detail: [label(businessKey(e)), tradeName(tradeOf(e)), bidState(e).state].filter(Boolean).join(" · ") });
  }
  for (const s of p.subscriptions) if (s.status === "active" && s.updated_at) items.push({ kind: "paid", at: s.updated_at, title: `Subscription active: ${s.plan}`, detail: label(`u:${s.user_id}`) });
  return items.filter((i) => i.at).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit);
}
