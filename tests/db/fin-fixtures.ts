/** Shared fixtures for the Financial Command Center DB tests (tests/db/fin-*.test.ts). */
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { asUser, createUser, type Row } from "./harness";

export const h = (s: string) => createHash("sha256").update(s).digest("hex");
export const fails = (p: Promise<unknown>) => p.then(() => "ok", (e: Error) => e.message);
export const n = (v: unknown) => Number(v);

export interface World {
  pool: Pool;
  owner: string; bk: string; rep: string; pm: string; viewer: string; acct: string; solo: string; rival: string;
  company: string; rivalCompany: string; book: string; rivalBook: string; soloBook: string;
}

export const asFn = (pool: Pool) => <T = Row>(u: string, sql: string, args: unknown[] = []) => asUser(pool, u, (q) => q(sql, args)).then((r) => r.rows[0] as T);
export const rowsFn = (pool: Pool) => (u: string, sql: string, args: unknown[] = []) => asUser(pool, u, (q) => q(sql, args)).then((r) => r.rows);

export async function sub(pool: Pool, u: string, plan: string, companyId: string | null, seats: number | null) {
  await pool.query(
    `select public.apply_subscription_update(p_user_id => $1::uuid, p_stripe_customer_id => 'cus_' || $1, p_stripe_subscription_id => 'sub_' || $1,
      p_status => 'active', p_plan => $2, p_price_id => 'price_x', p_current_period_end => '2099-01-01'::timestamptz, p_cancel_at_period_end => false,
      p_canceled_at => null, p_ended_at => null, p_event_created => now() - interval '1 minute', p_company_id => $3::uuid, p_seat_quantity => $4)`,
    [u, plan, companyId, seats],
  );
}

/** The Financial add-on on the user's Stripe subscription (what the webhook mirrors). */
export const finAddon = (pool: Pool, u: string, on: boolean, extra = 0) => pool.query("select public.apply_fin_update('sub_' || $1, $2, $3, now())", [u, on, extra]);

/** Make a lapsed add-on take effect now (no grace period left). */
export const lapse = async (pool: Pool, u: string) => {
  await finAddon(pool, u, false);
  await pool.query("update public.subscriptions set fin_addon_until = now() - interval '1 day' where stripe_subscription_id = 'sub_' || $1", [u]);
};

export async function setStage(pool: Pool, id: string, stage: string) {
  const c = await pool.connect();
  try {
    await c.query("begin"); await c.query("select set_config('app.stage_change', 'on', true)");
    await c.query("update public.estimates set pipeline_stage = $2 where id = $1", [id, stage]); await c.query("commit");
  } finally { c.release(); }
}

export const SCHEDULE = [{ label: "Deposit", percent: "30" }, { label: "Framing", percent: "20" }, { label: "Completion", percent: "50" }];

/** An accepted (Won) bid with one proposal version: total 40,000 = 37,000 + 3,000 tax; schedule 30/20/50. */
export async function wonBid(pool: Pool, u: string, companyId: string | null, opts: { title?: string; total?: string; tax?: string; schedule?: unknown[]; trades?: string[]; won?: boolean; items?: Row[] } = {}) {
  const trades = opts.trades ?? ["decks", "electrical"];
  const customer = (await pool.query("insert into public.customers (user_id, name, email, project_address) values ($1, 'Pat Rivera', 'pat@example.test', '1 Main St') returning id", [u])).rows[0].id as string;
  if (companyId) await pool.query("update public.customers set company_id = $2 where id = $1", [customer, companyId]).catch(() => {});
  const id = (await pool.query(
    "insert into public.estimates (user_id, company_id, title, customer_name, customer_email, trades, tax_rate) values ($1, $2, $3, 'Pat Rivera', 'pat@example.test', $4, 8.1081) returning id",
    [u, companyId, opts.title ?? "Backyard deck", trades])).rows[0].id as string;
  await pool.query("update public.estimates set customer_id = $2 where id = $1", [id, customer]);
  const cust = (await pool.query("select customer_id from public.estimates where id = $1", [id])).rows[0].customer_id as string | null;
  const total = opts.total ?? "40000.00";
  const snapshot = {
    schema: 1,
    estimate: {
      trades,
      groups: [{ id: "g1", name: "Framing", trade: "decks" }, { id: "g2", name: "Wiring", trade: "electrical" }],
      items: opts.items ?? [
        { id: "i1", groupId: "g1", costType: "material", quantity: "10", unitCost: "100.555" },
        { id: "i2", groupId: "g1", costType: "labor", quantity: "8", unitCost: "50" },
        { id: "i3", groupId: "g2", costType: "subcontractor", quantity: "1", unitCost: "2000" },
        { id: "i4", groupId: "g1", costType: "material", quantity: "5", unitCost: "10", isExample: true },
      ],
    },
  };
  const proposal = { paymentSchedule: opts.schedule ?? SCHEDULE.map((s) => ({ ...s, amount: "$0.00" })) };
  const tax = opts.tax ?? "3000.00";
  const subtotal = (Number(total) - Number(tax)).toFixed(2);
  const v1 = (await pool.query(
    `insert into public.estimate_versions (estimate_id, user_id, version_number, content_hash, snapshot, proposal, total_cost, subtotal, tax, total)
     values ($1, $2, 1, $3, $4, $5, 3405.55, $6, $8, $7) returning id`, [id, u, h(id + "v1"), snapshot, proposal, subtotal, total, tax])).rows[0].id as string;
  if (opts.won !== false) await setStage(pool, id, "won");
  return { id, v1, customer: cust };
}

export async function changeOrder(pool: Pool, b: { id: string }, u: string, companyId: string | null, num: number, amount: string, status: "draft" | "sent" | "approved" | "signed") {
  const decided = status === "approved" || status === "signed";
  return (await pool.query(
    `insert into public.change_orders (estimate_id, user_id, company_id, number, title, amount, status, approval_method, approval_note, approved_version, decided_at, version)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
    [b.id, u, companyId, num, `CO ${num}`, amount, status, decided ? "manual" : null, decided ? "Approved on site" : null, decided ? 1 : null, decided ? new Date() : null, decided ? 1 : 0],
  )).rows[0].id as string;
}

export async function setupWorld(pool: Pool): Promise<World> {
  const owner = await createUser(pool, "owner@acme.test");
  const bk = await createUser(pool, "books@acme.test");
  const rep = await createUser(pool, "rep@acme.test");
  const pm = await createUser(pool, "pm@acme.test");
  const viewer = await createUser(pool, "viewer@acme.test");
  const acct = await createUser(pool, "cpa@outside.test");
  const solo = await createUser(pool, "solo@test.test");
  const rival = await createUser(pool, "boss@rival.test");
  const company = (await pool.query("select public.create_company($1, 'Acme Decks') as id", [owner])).rows[0].id as string;
  const rivalCompany = (await pool.query("select public.create_company($1, 'Rival') as id", [rival])).rows[0].id as string;
  await pool.query(
    "insert into public.company_members (company_id, user_id, role, display_name) values ($1, $2, 'manager', 'Bo'), ($1, $3, 'estimator', 'Rae'), ($1, $4, 'manager', 'Pam'), ($1, $5, 'viewer', 'Vic')",
    [company, bk, rep, pm, viewer]);
  await sub(pool, owner, "enterprise", company, 6);
  await sub(pool, rival, "enterprise", rivalCompany, 3);
  await sub(pool, solo, "monthly", null, null);
  await finAddon(pool, owner, true, 0);
  await finAddon(pool, rival, true, 0);
  await finAddon(pool, solo, true, 0);
  const as = asFn(pool);
  const book = (await as<{ b: string }>(owner, "select public.fin_my_book() as b")).b;
  const rivalBook = (await as<{ b: string }>(rival, "select public.fin_my_book() as b")).b;
  const soloBook = (await as<{ b: string }>(solo, "select public.fin_my_book() as b")).b;
  return { pool, owner, bk, rep, pm, viewer, acct, solo, rival, company, rivalCompany, book, rivalBook, soloBook };
}
