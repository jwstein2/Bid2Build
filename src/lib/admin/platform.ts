import "server-only";
import type { createAdminClient } from "@/lib/supabase/server";
import { isDemoLogin } from "@/lib/demo/session";
import type { EstimateRow } from "./metrics";
import { stripSampleData } from "./model";
import type { ProductData } from "./product";
import type {
  BusinessRow, CompanyRow, ConsentRow, CostRow, EventRow, GrantRow, LabelRow, LeadRow, MeaningfulRow, MemberRow, OutboxRow, SignatureRow,
  SigningRequestRow, Snapshot, StripeEventRow, SubscriptionRow, UserRow, VersionRow,
} from "./model";

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

/** Like all(), but a table that is not installed yet (or not readable) yields null instead of failing the page. */
async function optional<T>(db: Db, table: string, columns: string, order = "created_at"): Promise<T[] | null> {
  try { return await all<T>(db, table, columns, order); } catch { return null; }
}

/** Every auth account with its email and sign-in state (service role only). Demo / practice logins go to `sample`. */
async function authUsers(db: Db, sample: Set<string>): Promise<UserRow[] | null> {
  const out: UserRow[] = [];
  try {
    for (let page = 1; page <= 50; page++) {
      const { data, error } = await db.auth.admin.listUsers({ page, perPage: PAGE });
      if (error) return null;
      const users = data?.users ?? [];
      // Demo / practice logins are sample accounts, not customers.
      for (const u of users) if (isDemoLogin(u)) sample.add(u.id); else out.push({ id: u.id, email: u.email ?? null, created_at: u.created_at, email_confirmed_at: u.email_confirmed_at ?? null, last_sign_in_at: u.last_sign_in_at ?? null });
      if (users.length < PAGE) break;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Load the raw rows behind the owner command center. Called only after requireAdmin(). Selects no
 * prices, line items, homeowner names or notes. The project address is read only to derive a state on
 * the server and is never sent to the browser. Emails are read for the owner's Customers page only.
 */
export async function loadSnapshot(db: Db, callerId: string): Promise<Snapshot> {
  const since7 = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const sampleUsers = new Set<string>();
  const [
    metrics, users, profiles, labels, admins, estimates, versions, signatures, signingRequests, subscriptions,
    businesses, companies, members, grants, consents, events, leads, leadsV2, costs, outbox, stripeEvents,
  ] = await Promise.all([
    db.rpc("admin_metrics", { p_caller: callerId }),
    authUsers(db, sampleUsers),
    all<{ id: string; created_at: string }>(db, "profiles", "id,created_at"),
    optional<LabelRow>(db, "admin_account_labels", "user_id,label,note,updated_at", "updated_at"),
    optional<{ user_id: string }>(db, "admin_roles", "user_id", "user_id"),
    all<EstimateRow>(db, "estimates", "id,user_id,company_id,trades,template_trade,status,created_at,location_state,location_zip,project_address"),
    all<VersionRow>(db, "estimate_versions", "estimate_id,user_id,created_at,version_number"),
    all<SignatureRow>(db, "signatures", "estimate_id,user_id,signed_at,pdf_status", "signed_at"),
    optional<SigningRequestRow>(db, "signing_requests", "id,estimate_id,user_id,company_id,status,created_at,signed_at,expires_at"),
    all<SubscriptionRow>(db, "subscriptions", "stripe_subscription_id,user_id,stripe_customer_id,status,plan,cancel_at_period_end,canceled_at,ended_at,updated_at,seat_quantity,current_period_end,company_id", "updated_at"),
    all<BusinessRow>(db, "business_profiles", "user_id,created_at,company_name"),
    optional<CompanyRow>(db, "companies", "id,created_at,name,owner_user_id"),
    optional<MemberRow>(db, "company_members", "company_id,user_id,role,status", "company_id"),
    optional<GrantRow>(db, "complimentary_grants", "id,email,user_id,status,plan,starts_at,expires_at,created_at,company_id,granted_by,note,extra_seats,invite_expires_at,revoked_at"),
    all<ConsentRow>(db, "market_consent", "user_id,share_prices", "updated_at"),
    db.from("analytics_events").select("event,user_id,created_at").in("event", ["checkout_started", "subscribed", "account_created"]).order("created_at", { ascending: false }).limit(10_000),
    optional<LeadRow>(db, "leads", "user_id,source,utm_source,utm_medium,utm_campaign,utm_content,landing_path,first_touch_at,first_campaign_id,first_campaign_name,stage,created_at"),
    optional<{ user_id: string | null; referrer_host: string | null; click_id_type: string | null; device_type: string | null }>(db, "leads", "user_id,referrer_host,click_id_type,device_type"),
    optional<CostRow>(db, "marketing_costs", "id,period_start,channel,campaign_id,amount_usd,note,created_at"),
    optional<OutboxRow>(db, "email_outbox", "kind,user_id,status,last_error,attempts,created_at,updated_at"),
    db.from("stripe_events").select("id,type,received_at,processed_at,error").gte("received_at", since7).order("received_at", { ascending: false }).limit(2000),
  ]);
  const [product, meaningful, workspaces, retired] = await Promise.all([
    loadProduct(db),
    db.rpc("growth_meaningful_estimates").then((r) => (r.error ? null : ((r.data ?? []) as MeaningfulRow[])), () => null),
    optional<{ demo_user_id: string | null; company_id: string | null }>(db, "demo_workspaces", "demo_user_id,company_id"),
    optional<{ demo_user_id: string | null; company_id: string | null }>(db, "demo_retired_logins", "demo_user_id,company_id", "demo_user_id"),
  ]);
  // Demo / Practice logins and their sample companies: from Auth, the registry (current and retired logins) and labels.
  const sampleCompanies = new Set<string>();
  for (const w of [...(workspaces ?? []), ...(retired ?? [])]) { if (w.demo_user_id) sampleUsers.add(w.demo_user_id); if (w.company_id) sampleCompanies.add(w.company_id); }
  for (const l of labels ?? []) if (l.label === "demo") sampleUsers.add(l.user_id);
  const pm = new Map((product.pmSubs ?? []).map((x) => [x.stripe_subscription_id, x]));
  const m = (metrics.data ?? {}) as { import_failures_7d?: number; pdf_errors_7d?: number };
  const extra = new Map((leadsV2 ?? []).filter((l) => l.user_id).map((l) => [l.user_id!, l]));
  return stripSampleData({
    users: users ?? profiles.map((p) => ({ id: p.id, email: null, created_at: p.created_at, email_confirmed_at: null, last_sign_in_at: null })),
    usersSource: users ? "auth" : "profiles",
    labels: labels ?? [], labelsInstalled: labels !== null,
    adminIds: new Set((admins ?? []).map((a) => a.user_id)),
    estimates, versions, signatures, signingRequests: signingRequests ?? [], subscriptions: subscriptions.map((x) => ({ ...x, ...pm.get(x.stripe_subscription_id) })), businesses,
    companies: companies ?? [], members: members ?? [], grants: grants ?? [], consents,
    events: (events.data ?? []) as EventRow[],
    leads: (leads ?? []).map((l) => ({ ...l, ...(l.user_id ? extra.get(l.user_id) : undefined) })),
    leadsInstalled: leads !== null, attributionV2: leadsV2 !== null,
    costs: costs ?? [], outbox: outbox ?? [], stripeEvents: (stripeEvents.data ?? []) as StripeEventRow[],
    pdfErrors7d: m.pdf_errors_7d ?? 0, importFailures7d: m.import_failures_7d ?? 0,
    product: product.data,
    meaningful,
    loadedAt: new Date().toISOString(),
  }, { userIds: sampleUsers, companyIds: sampleCompanies });
}

/**
 * V4 pipeline / scheduling rows for owner analytics (Phase 10). Each table is optional, so the dashboard
 * keeps working before a migration is applied. Columns are ids, stages and timestamps only.
 */
async function loadProduct(db: Db): Promise<{ data: ProductData; pmSubs: { stripe_subscription_id: string; pm_addon: boolean | null; pm_addon_until: string | null; pm_extra_editors: number | null }[] | null }> {
  const [pmSubs, stages, moves, schedules, publications, editors, reports] = await Promise.all([
    optional<{ stripe_subscription_id: string; pm_addon: boolean | null; pm_addon_until: string | null; pm_extra_editors: number | null }>(db, "subscriptions", "stripe_subscription_id,pm_addon,pm_addon_until,pm_extra_editors", "updated_at"),
    optional<ProductData["stages"][number]>(db, "estimates", "user_id,pipeline_stage"),
    optional<ProductData["stageMoves"][number]>(db, "estimate_stage_history", "changed_by,created_at"),
    optional<ProductData["schedules"][number]>(db, "project_schedules", "id,user_id,company_id,status,created_at"),
    optional<ProductData["publications"][number]>(db, "schedule_publications", "schedule_id,published_by,published_at", "published_at"),
    optional<ProductData["editors"][number]>(db, "pm_editors", "company_id,user_id,assigned_at", "assigned_at"),
    optional<ProductData["reports"][number]>(db, "report_generations", "user_id,action,created_at"),
  ]);
  return {
    pmSubs,
    data: {
      installed: { pipeline: stages !== null && moves !== null, schedules: schedules !== null, publications: publications !== null, editors: editors !== null, reports: reports !== null },
      stages: stages ?? [], stageMoves: moves ?? [], schedules: schedules ?? [], publications: publications ?? [], editors: editors ?? [], reports: reports ?? [],
    },
  };
}

export interface PlatformUsage { db_bytes: number; auth_users: number; buckets: { bucket: string; objects: number; bytes: number }[]; measured_at: string }
export interface AiUse { created_at: string; cost_usd: number | string; status: string }
export interface CostData {
  services: import("./costs").ServiceRow[]; expenses: import("./costs").ExpenseRow[]; installed: boolean;
  usage: PlatformUsage | null; ai: AiUse[] | null;
}

/** Owner cost records, platform usage aggregates and the AI usage log (cost and status only). Admin only. */
export async function loadCosts(db: Db): Promise<CostData> {
  const since = new Date(Date.now() - 400 * 86_400_000).toISOString();
  const [services, expenses, usage, ai] = await Promise.all([
    optional<import("./costs").ServiceRow>(db, "admin_services", "provider_key,name,purpose,category,status,plan,cost_type,amount_cents,billing_interval,next_renewal,allocation_pct,budget_monthly_cents,cost_source,dashboard_url,invoice_ref,notes,updated_at", "provider_key"),
    optional<import("./costs").ExpenseRow>(db, "admin_expenses", "id,service_key,incurred_on,amount_cents,kind,source,external_id,note,created_at", "incurred_on"),
    db.rpc("admin_platform_usage").then((r) => (r.error ? null : (r.data as PlatformUsage | null)), () => null),
    db.from("ai_generations").select("created_at,cost_usd,status").gte("created_at", since).limit(50_000).then((r) => (r.error ? null : (r.data as AiUse[])), () => null),
  ]);
  return { services: services ?? [], expenses: expenses ?? [], installed: services !== null && expenses !== null, usage, ai };
}
