import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "../http/api";
import { isDemoLogin } from "../demo/session";
import { classifyAccount } from "../admin/classify";
import { site } from "../site";
import { FOUNDER_ADDRESS } from "./founder-welcome";
import { LIFECYCLE_STEPS, kindOf, planLifecycle, renderLifecycle, stepOfKind, tradeFromPath, type LifecycleFacts, type LifecyclePlan, type LifecycleStep } from "./lifecycle";
import { lifecycleUnsubSig, lifecycleUnsubUrls } from "./unsubscribe";

/**
 * Daily lifecycle email job (netlify/functions/lifecycle-cron.mts -> /api/cron/lifecycle).
 *
 * LIFECYCLE_EMAIL_MODE:
 *   off  (default) nothing is sent or recorded. A dry run still reports what WOULD be sent (counts only).
 *   test only accounts whose email is in LIFECYCLE_TEST_RECIPIENTS (the owner's own addresses) can
 *        receive anything, whatever their account class.
 *   live genuine accounts, by the rules in lifecycle.ts.
 * Sending also needs RESEND_API_KEY and LIFECYCLE_POSTAL_ADDRESS (CAN-SPAM footer). At most
 * LIFECYCLE_DAILY_CAP (default 40) lifecycle emails go out per UTC day.
 *
 * Each step is recorded in email_outbox before it is sent (unique (kind, user_id)), so a step can
 * reach an account at most once even if two runs overlap. Results are counts only, never addresses.
 */
type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;
export type LifecycleMode = "off" | "test" | "live";

export interface LifecycleConfig {
  mode: LifecycleMode;
  enabled: boolean;
  /** Why sending is off (null when enabled). */
  reason: string | null;
  apiKey: string;
  from: string;
  replyTo: string;
  postalAddress: string;
  testRecipients: string[];
  dailyCap: number;
  appUrl: string;
  /** Environment used to sign unsubscribe links. */
  env: Env;
}

export function lifecycleConfig(env: Env = process.env): LifecycleConfig {
  const m = (env.LIFECYCLE_EMAIL_MODE ?? "off").trim().toLowerCase();
  const mode: LifecycleMode = m === "test" || m === "live" ? m : "off";
  const apiKey = env.RESEND_API_KEY ?? "";
  const postalAddress = (env.LIFECYCLE_POSTAL_ADDRESS ?? "").trim();
  const testRecipients = (env.LIFECYCLE_TEST_RECIPIENTS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter((s) => s.includes("@"));
  const cap = Number(env.LIFECYCLE_DAILY_CAP);
  let signer = true;
  try { lifecycleUnsubSig("00000000-0000-4000-8000-000000000000", env); } catch { signer = false; }
  const reason = mode === "off" ? "LIFECYCLE_EMAIL_MODE is off"
    : !apiKey ? "RESEND_API_KEY is not set"
      : !postalAddress ? "LIFECYCLE_POSTAL_ADDRESS is not set"
        : mode === "test" && !testRecipients.length ? "LIFECYCLE_TEST_RECIPIENTS is empty"
          : !signer ? "no secret for unsubscribe links"
            : null;
  const address = env.LIFECYCLE_EMAIL_FROM || FOUNDER_ADDRESS;
  return {
    mode, enabled: reason === null, reason, apiKey, postalAddress, testRecipients,
    from: `"James at Built2Bid" <${address}>`,
    replyTo: env.LIFECYCLE_EMAIL_REPLY_TO || FOUNDER_ADDRESS,
    dailyCap: Number.isInteger(cap) && cap >= 0 ? Math.min(cap, 500) : 40,
    appUrl: site.url,
    env,
  };
}

// ---------------------------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------------------------
const PAGE = 1000, MAX_ROWS = 20_000;
const PAYING = new Set(["active", "past_due"]);
type Db = SupabaseClient;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Query = any;
async function rows<T>(db: Db, table: string, cols: string, build?: (q: Query) => Query): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    let q: Query = db.from(table).select(cols);
    if (build) q = build(q);
    const { data, error } = (await q.range(from, from + PAGE - 1)) as { data: unknown[] | null; error: { message: string } | null };
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}
const optionalRows = async <T,>(...a: Parameters<typeof rows>) => { try { return await rows<T>(...a); } catch { return [] as T[]; } };

export interface LoadedFacts { facts: LifecycleFacts[]; emails: Map<string, string> }

/** Everything the planner needs, per account. Throws "migration" if 20261117003000 isn't applied. */
export async function loadLifecycleFacts(db: Db, now = new Date()): Promise<LoadedFacts> {
  const users: { id: string; email: string | null; created_at: string }[] = [];
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: PAGE });
    if (error) throw new Error(`auth: ${error.message}`);
    const list = data?.users ?? [];
    // Demo / practice logins are sample accounts with reserved addresses: never in the lifecycle program.
    for (const u of list) if (!isDemoLogin(u)) users.push({ id: u.id, email: u.email ?? null, created_at: u.created_at });
    if (list.length < PAGE) break;
  }
  const since = new Date(now.getTime() - 45 * 86_400_000).toISOString();
  const nowIso = now.toISOString();

  let profiles: { id: string; marketing_opt_in: boolean; lifecycle_unsubscribed_at: string | null }[];
  try { profiles = await rows(db, "profiles", "id,marketing_opt_in,lifecycle_unsubscribed_at"); }
  catch (e) { if (/lifecycle_unsubscribed_at/.test(String((e as Error).message))) throw new Error("migration"); throw e; }

  const [labels, admins, estimates, meaningful, events, subs, grants, leads, outbox] = await Promise.all([
    optionalRows<{ user_id: string; label: string }>(db, "admin_account_labels", "user_id,label"),
    optionalRows<{ user_id: string }>(db, "admin_roles", "user_id"),
    rows<{ id: string; user_id: string; template_trade: string | null; trades: string[] | null; updated_at: string }>(db, "estimates", "id,user_id,template_trade,trades,updated_at", (q: Query) => q.gte("updated_at", since)),
    (async () => { const { data, error } = await db.rpc("growth_meaningful_estimates"); return error ? [] : ((data ?? []) as { estimate_id: string; user_id: string; reached_at: string }[]); })(),
    rows<{ user_id: string; event: string; created_at: string }>(db, "analytics_events", "user_id,event,created_at", (q: Query) => q.in("event", ["export_succeeded", "proposal_sent", "subscribed"])),
    rows<{ user_id: string; status: string; updated_at: string }>(db, "subscriptions", "user_id,status,updated_at"),
    optionalRows<{ user_id: string | null; status: string; starts_at: string | null; expires_at: string | null }>(db, "complimentary_grants", "user_id,status,starts_at,expires_at"),
    optionalRows<{ user_id: string | null; suppressed_at: string | null; unsubscribed_at: string | null; landing_path: string | null }>(db, "leads", "user_id,suppressed_at,unsubscribed_at,landing_path", (q: Query) => q.not("user_id", "is", null)),
    rows<{ kind: string; user_id: string; status: string; sent_at: string | null; created_at: string }>(db, "email_outbox", "kind,user_id,status,sent_at,created_at", (q: Query) => q.like("kind", "lifecycle_%")),
  ]);

  const label = new Map(labels.map((l) => [l.user_id, l.label]));
  const adminIds = new Set(admins.map((a) => a.user_id));
  const profile = new Map(profiles.map((p) => [p.id, p]));
  const meaningfulAt = new Map(meaningful.map((m) => [m.estimate_id, m.reached_at]));
  const firstOf = (map: Map<string, string>, id: string, at: string) => { const cur = map.get(id); if (!cur || at < cur) map.set(id, at); };
  const delivered = new Map<string, string>(), subscribed = new Map<string, string>();
  for (const e of events) firstOf(e.event === "subscribed" ? subscribed : delivered, e.user_id, e.created_at);
  const paying = new Map<string, string>();
  for (const s of subs) if (PAYING.has(s.status)) paying.set(s.user_id, subscribed.get(s.user_id) ?? s.updated_at);
  const comp = new Set(grants.filter((g) => g.user_id && g.status === "active" && (!g.starts_at || g.starts_at <= nowIso) && (!g.expires_at || g.expires_at > nowIso)).map((g) => g.user_id as string));
  const lead = new Map(leads.map((l) => [l.user_id as string, l]));
  const byUser = new Map<string, LifecycleFacts["estimates"]>();
  for (const e of estimates) {
    const list = byUser.get(e.user_id) ?? [];
    list.push({ id: e.id, trade: e.template_trade ?? e.trades?.[0] ?? null, updatedAt: e.updated_at, meaningfulAt: meaningfulAt.get(e.id) ?? null });
    byUser.set(e.user_id, list);
  }
  const done = new Map<string, { steps: LifecycleStep[]; last: string | null }>();
  for (const o of outbox) {
    const s = stepOfKind(o.kind);
    if (!s) continue;
    const d = done.get(o.user_id) ?? { steps: [], last: null };
    d.steps.push(s);
    const at = o.sent_at ?? (o.status === "sending" ? o.created_at : null);
    if (at && (!d.last || at > d.last)) d.last = at;
    done.set(o.user_id, d);
  }

  const facts: LifecycleFacts[] = [];
  const emails = new Map<string, string>();
  for (const u of users) {
    if (!u.email) continue;
    const isPaying = paying.has(u.id);
    // Older accounts can only ever qualify for E (paying 7-30 days); skip the rest early.
    if (!isPaying && u.created_at < since) continue;
    const p = profile.get(u.id);
    const l = lead.get(u.id);
    const d = done.get(u.id);
    emails.set(u.id, u.email);
    facts.push({
      userId: u.id, email: u.email, createdAt: u.created_at,
      cls: classifyAccount(u.email, { label: label.get(u.id), isAdmin: adminIds.has(u.id) }).cls,
      unsubscribed: Boolean(p?.lifecycle_unsubscribed_at),
      suppressed: Boolean(l?.suppressed_at || l?.unsubscribed_at),
      marketingOptIn: Boolean(p?.marketing_opt_in),
      payingSince: isPaying ? paying.get(u.id)! : null,
      complimentary: comp.has(u.id),
      estimates: byUser.get(u.id) ?? [],
      firstDeliveredAt: delivered.get(u.id) ?? null,
      landingTrade: tradeFromPath(l?.landing_path),
      done: d?.steps ?? [],
      lastSentAt: d?.last ?? null,
    });
  }
  return { facts, emails };
}

// ---------------------------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------------------------
async function sendOne(cfg: LifecycleConfig, to: string, key: string, plan: LifecyclePlan, userId: string, fetchImpl: Fetch): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  const urls = lifecycleUnsubUrls(cfg.appUrl, userId, cfg.env);
  const email = renderLifecycle({ appUrl: cfg.appUrl, step: plan.step, trade: plan.trade, estimateId: plan.estimateId, unsubscribeUrl: urls.page, postalAddress: cfg.postalAddress });
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8_000);
  try {
    const r = await fetchImpl("https://api.resend.com/emails", {
      method: "POST", signal: ctl.signal,
      headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify({
        from: cfg.from, to: [to], reply_to: cfg.replyTo, subject: email.subject, text: email.text, html: email.html,
        headers: { "List-Unsubscribe": `<${urls.oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        tags: [{ name: "kind", value: kindOf(plan.step) }],
      }),
    });
    const body = (await r.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    return r.ok ? { ok: true, id: body.id ?? null } : { ok: false, error: `${r.status} ${body.name ?? ""} ${body.message ?? ""}`.trim().slice(0, 300) };
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e).slice(0, 300) };
  } finally {
    clearTimeout(t);
  }
}

export interface LifecycleResult {
  mode: LifecycleMode;
  enabled: boolean;
  reason: string | null;
  dryRun: boolean;
  /** Emails each step would send now (dry run) or was due (real run), before the daily cap. */
  due: Record<LifecycleStep, number>;
  sent: number;
  failed: number;
  capped: number;
  unavailable?: string;
}

const emptyDue = () => Object.fromEntries(LIFECYCLE_STEPS.map((s) => [s, 0])) as Record<LifecycleStep, number>;

export async function runLifecycle(db: Db, opts: { dryRun?: boolean; config?: LifecycleConfig; fetchImpl?: Fetch; now?: Date } = {}): Promise<LifecycleResult> {
  const cfg = opts.config ?? lifecycleConfig();
  const now = opts.now ?? new Date();
  const dryRun = Boolean(opts.dryRun) || !cfg.enabled;
  const out: LifecycleResult = { mode: cfg.mode, enabled: cfg.enabled, reason: cfg.reason, dryRun, due: emptyDue(), sent: 0, failed: 0, capped: 0 };

  let loaded: LoadedFacts;
  try { loaded = await loadLifecycleFacts(db, now); }
  catch (e) {
    out.unavailable = (e as Error).message === "migration" ? "migration 20261117003000 not applied" : "could not load account data";
    if (out.unavailable !== "migration 20261117003000 not applied") logError("lifecycle.load", e);
    return out;
  }
  const test = cfg.mode === "test";
  const allowed = new Set(cfg.testRecipients);
  const plans: { userId: string; plan: LifecyclePlan }[] = [];
  for (const f of loaded.facts) {
    if (test && !allowed.has((f.email ?? "").toLowerCase())) continue;
    const plan = planLifecycle(f, now.getTime(), { allowNonGenuine: test });
    if (plan) { plans.push({ userId: f.userId, plan }); out.due[plan.step]++; }
  }
  if (dryRun) return out;

  // A worker that stopped mid-send leaves a claim; mark it failed (no automatic resend of that step).
  await db.from("email_outbox").update({ status: "failed", last_error: "interrupted", locked_until: null, updated_at: now.toISOString() })
    .like("kind", "lifecycle_%").eq("status", "sending").lt("locked_until", now.toISOString());

  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const { count } = await db.from("email_outbox").select("id", { count: "exact", head: true }).like("kind", "lifecycle_%").in("status", ["sending", "sent"]).gte("created_at", dayStart);
  let budget = Math.max(0, cfg.dailyCap - (count ?? 0));

  for (const { userId, plan } of plans) {
    if (budget <= 0) { out.capped++; continue; }
    const to = loaded.emails.get(userId);
    if (!to) continue;
    const kind = kindOf(plan.step);
    const { data: claimed, error } = await db.from("email_outbox")
      .upsert({ kind, user_id: userId, status: "sending", attempts: 1, source_ref: "lifecycle", locked_until: new Date(now.getTime() + 60_000).toISOString(), meta: { trade: plan.trade, estimate_id: plan.estimateId } }, { onConflict: "kind,user_id", ignoreDuplicates: true })
      .select("id");
    if (error) { logError("lifecycle.claim", error, { kind }); continue; }
    if (!claimed?.length) continue; // already recorded by another run
    budget--;
    const id = (claimed[0] as { id: string }).id;
    const res = await sendOne(cfg, to, `lifecycle/${id}`, plan, userId, opts.fetchImpl ?? fetch);
    const at = new Date().toISOString();
    if (res.ok) {
      await db.from("email_outbox").update({ status: "sent", sent_at: at, provider_message_id: res.id, last_error: null, locked_until: null, updated_at: at }).eq("id", id);
      out.sent++;
    } else {
      await db.from("email_outbox").update({ status: "failed", last_error: res.error, locked_until: null, updated_at: at }).eq("id", id);
      out.failed++;
    }
  }
  return out;
}

/**
 * Owner review: send one example of every step (example data, no account data) to the test
 * recipients. Works in test or live mode only. Nothing is recorded.
 */
export async function sendLifecycleSamples(opts: { config?: LifecycleConfig; fetchImpl?: Fetch; now?: Date } = {}): Promise<{ sent: number; failed: number; reason: string | null }> {
  const cfg = opts.config ?? lifecycleConfig();
  if (!cfg.enabled) return { sent: 0, failed: 0, reason: cfg.reason };
  if (!cfg.testRecipients.length) return { sent: 0, failed: 0, reason: "LIFECYCLE_TEST_RECIPIENTS is empty" };
  const day = (opts.now ?? new Date()).toISOString().slice(0, 10);
  const sampleUser = "00000000-0000-4000-8000-000000000000";
  let sent = 0, failed = 0;
  for (const to of cfg.testRecipients) {
    for (const step of LIFECYCLE_STEPS) {
      const plan: LifecyclePlan = { step, trade: "decks", estimateId: step === "b" || step === "c" ? sampleUser : null };
      const res = await sendOne(cfg, to, `lifecycle-sample/${day}/${step}/${to}`, plan, sampleUser, opts.fetchImpl ?? fetch);
      if (res.ok) sent++; else failed++;
    }
  }
  return { sent, failed, reason: null };
}
