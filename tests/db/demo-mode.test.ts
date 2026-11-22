/**
 * Demo Mode / Practice Mode isolation and the guide progress store (migration 20270102001000), on a
 * real Postgres with every migration applied. Runs with `npm run test:db`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";
import { pgRpc } from "./demo-helpers";
import { buildDemoDataset } from "../../src/lib/demo/dataset";
import { applyDemoDataset, demoSteps } from "../../src/lib/demo/apply";

const ok = await dbAvailable();
const d = describe.skipIf(!ok);

d("Demo Mode isolation (20270102001000)", () => {
  let pool: Pool, drop: () => Promise<void>;
  let owner: string, stranger: string, demo: string, ws: { workspaceId: string; companyId: string; demoUserId: string };
  let data0: ReturnType<typeof buildDemoDataset>;
  const ANCHOR = "2026-11-18";

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("b2b_demo_mode"));
    owner = await createUser(pool, "owner@built.test");
    stranger = await createUser(pool, "someone@built.test");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [owner]);
    // The owner's real data, which the demo must never see or touch.
    await pool.query("insert into public.customers (user_id, name, email) values ($1, 'Real Customer', 'real@customer.test')", [owner]);
    demo = await createUser(pool, "owner-demo-1@example.com");
    ws = (await pool.query("select public.demo_provision($1, $2, 'owner_demo') as r", [owner, demo])).rows[0].r;
    const data = buildDemoDataset({ kind: "owner_demo", namespace: ws.workspaceId, anchor: ANCHOR });
    data0 = data;
    const r = await applyDemoDataset(pgRpc(pool), ws.workspaceId, data, { budgetMs: 300_000 });
    expect(r.error).toBeUndefined();
    expect(r.done).toBe(true);
  }, 400_000);
  afterAll(async () => { await drop?.(); });

  it("only the platform owner can create an owner demo, only with a reserved demo email and a fresh login", async () => {
    const other = await createUser(pool, "stranger-demo@example.com");
    await expect(pool.query("select public.demo_provision($1, $2, 'owner_demo')", [stranger, other])).rejects.toThrow(/forbidden/);
    const realish = await createUser(pool, "lookalike@gmail.test");
    await expect(pool.query("select public.demo_provision($1, $2, 'practice')", [stranger, realish])).rejects.toThrow(/demo_email_required/);
    // A real account can never be turned into a demo login.
    await expect(pool.query("select public.demo_provision($1, $2, 'practice')", [stranger, owner])).rejects.toThrow(/demo_email_required|demo_user_not_fresh/);
    // No demo inside a demo.
    const nested = await createUser(pool, "nested@example.com");
    await expect(pool.query("select public.demo_provision($1, $2, 'practice')", [demo, nested])).rejects.toThrow(/forbidden/);
  });

  it("seeds the documented sample company", async () => {
    const n = async (sql: string, p: unknown[] = []) => Number((await pool.query(sql, p)).rows[0].count);
    expect(await n("select count(*) from public.customers where user_id = $1", [demo])).toBe(150);
    expect(await n("select count(*) from public.estimates where user_id = $1", [demo])).toBe(169);
    expect(await n("select count(*) from public.project_schedules s join public.estimates e on e.id = s.estimate_id where e.user_id = $1", [demo])).toBe(45);
    expect(await n("select count(*) from public.fin_invoices i join public.fin_books b on b.id = i.book_id where b.company_id = $1 or b.owner_user_id = $2", [ws.companyId, demo])).toBe(data0.invoices.length);
    expect(await n("select count(*) from public.pm_resources where company_id = $1 and kind = 'staff'", [ws.companyId])).toBe(8);
    expect(await n("select count(*) from public.pm_resources where company_id = $1 and kind = 'subcontractor'", [ws.companyId])).toBe(18);
    // V7.3 Contractors & Workforce: Red's Electric holds four workers; crews have members and stated capacity.
    expect(await n("select count(*) from public.pm_resources w join public.pm_resources c on c.id = w.parent_id where c.company_id = $1 and c.name like 'Red''s Electric%'", [ws.companyId])).toBe(4);
    expect(await n("select count(*) from public.pm_resources where company_id = $1 and kind = 'crew' and capacity_declared", [ws.companyId])).toBe(2);
    expect(await n("select count(*) from public.pm_crew_members m join public.pm_resources c on c.id = m.crew_id where c.company_id = $1", [ws.companyId])).toBe(2);
    expect(await n("select count(*) from public.schedule_tasks t join public.pm_resources r on r.id = t.resource_id where r.company_id = $1 and r.name = 'Marco Diaz' and not t.assignment_inherited", [ws.companyId])).toBe(2);
    expect(await n("select count(*) from public.comm_messages where account_id in ($1, $2)", [demo, ws.companyId])).toBeGreaterThanOrEqual(200);
    // Every contact is fictional: reserved example domains and 555-01xx numbers only.
    const bad = await pool.query("select email, phone from public.customers where user_id = $1 and (email !~* '@example\\.(com|net|org)$' or phone !~ '555-01[0-9]{2}')", [demo]);
    expect(bad.rows).toEqual([]);
    const status = (await pool.query("select status, seed_step from public.demo_workspaces where id = $1", [ws.workspaceId])).rows[0];
    expect(status.status).toBe("ready");
  });

  it("keeps real and demo data apart under RLS, both ways", async () => {
    const realSeesDemo = await asUser(pool, owner, (q) => q("select count(*) from public.customers where user_id = $1", [demo]));
    expect(Number(realSeesDemo.rows[0].count)).toBe(0);
    const realEstimates = await asUser(pool, owner, (q) => q("select count(*) from public.estimates"));
    expect(Number(realEstimates.rows[0].count)).toBe(0);
    const demoSeesReal = await asUser(pool, demo, (q) => q("select count(*) from public.customers where user_id = $1", [owner]));
    expect(Number(demoSeesReal.rows[0].count)).toBe(0);
    const strangerSees = await asUser(pool, stranger, (q) => q("select count(*) from public.customers"));
    expect(Number(strangerSees.rows[0].count)).toBe(0);
    // The registry itself is invisible to signed-in users.
    await expect(asUser(pool, owner, (q) => q("select * from public.demo_workspaces"))).rejects.toThrow(/permission denied/);
  });

  it("a new estimate created in Demo Mode is saved to the demo account, never the real one", async () => {
    const data = buildDemoDataset({ kind: "owner_demo", namespace: ws.workspaceId, anchor: ANCHOR });
    const fresh = "aaaaaaaa-0000-4000-8000-00000000d0d0";
    // Like the builder would: a brand-new estimate with its own section and line ids.
    const src = data.estimates[0].payload as { groups?: { id: string }[]; items?: { id: string }[] } & Record<string, unknown>;
    let text = JSON.stringify({ ...src, id: fresh, title: "New bid made during a demo" });
    [...(src.groups ?? []), ...(src.items ?? [])].forEach((x, i) => { text = text.split(x.id).join(`bbbbbbbb-0000-4000-8000-${String(i).padStart(12, "0")}`); });
    const payload = JSON.parse(text) as Record<string, unknown>;
    await asUser(pool, demo, (q) => q("select public.save_estimate($1::jsonb)", [JSON.stringify(payload)]));
    const row = (await pool.query("select user_id, company_id from public.estimates where id = $1", [fresh])).rows[0];
    expect(row.user_id).toBe(demo);
    expect([null, ws.companyId]).toContain(row.company_id);
    const ownerSees = await asUser(pool, owner, (q) => q("select count(*) from public.estimates where id = $1", [fresh]));
    expect(Number(ownerSees.rows[0].count)).toBe(0);
    // A real account can't write into the demo estimate either.
    await expect(asUser(pool, owner, (q) => q("select public.save_estimate($1::jsonb)", [JSON.stringify({ ...payload, title: "hijack" })]))).rejects.toThrow();
  });

  it("blocks sending, signing and billing from a demo tenant at the database", async () => {
    await expect(pool.query("insert into public.comm_messages (account_id, status) values ($1, 'scheduled')", [demo])).rejects.toThrow(/demo_mode_no_send/);
    await expect(pool.query("insert into public.email_outbox (user_id) values ($1)", [demo])).rejects.toThrow(/demo_mode_no_send/);
    await expect(pool.query("insert into public.signing_requests (user_id) values ($1)", [demo])).rejects.toThrow(/demo_mode_no_signing/);
    await expect(pool.query("insert into public.subscriptions (user_id) values ($1)", [demo])).rejects.toThrow(/demo_mode_no_billing/);
    await expect(pool.query("insert into public.subscriptions (company_id) values ($1)", [ws.companyId])).rejects.toThrow(/demo_mode_no_billing/);
    // Seeded messages are history only: nothing is queued to go out.
    const queued = await pool.query("select count(*) from public.comm_messages where account_id in ($1, $2) and status in ('scheduled', 'approved', 'sending')", [demo, ws.companyId]);
    expect(Number(queued.rows[0].count)).toBe(0);
  });

  it("runs seed steps in order exactly once", async () => {
    const rpc = pgRpc(pool);
    const total = demoSteps(buildDemoDataset({ kind: "owner_demo", namespace: ws.workspaceId, anchor: ANCHOR })).length;
    // Repeating an earlier step (a retried request) is a no-op; skipping ahead is refused.
    await expect(rpc("demo_apply", { p_workspace: ws.workspaceId, p_kind: "customers", p_rows: [], p_seed_version: null, p_step: 2 })).resolves.toBeDefined();
    await expect(rpc("demo_apply", { p_workspace: ws.workspaceId, p_kind: "finish", p_rows: [], p_seed_version: null, p_step: total + 5 })).rejects.toThrow(/out_of_order/);
    // A real (non-demo) workspace id is refused outright.
    await expect(rpc("demo_apply", { p_workspace: "00000000-0000-0000-0000-000000000001", p_kind: "base", p_rows: {}, p_seed_version: "x", p_step: 0 })).rejects.toThrow(/not_a_demo_workspace/);
  });

  it("reset retires the old login and never deletes anything", async () => {
    const before = Number((await pool.query("select count(*) from public.customers where user_id = $1", [demo])).rows[0].count);
    const fresh = await createUser(pool, "owner-demo-2@example.com");
    const r = (await pool.query("select public.demo_provision($1, $2, 'owner_demo') as r", [owner, fresh])).rows[0].r;
    expect(r.workspaceId).toBe(ws.workspaceId);
    expect(r.retired).toBe(demo);
    expect((await pool.query("select public.is_demo_account($1) as v", [demo])).rows[0].v).toBe(true);
    expect((await pool.query("select count(*) from public.demo_retired_logins where demo_user_id = $1", [demo])).rows[0].count).toBe("1");
    // The old rows stay (attributable, invisible to everyone but that retired login); the real account is untouched.
    expect(Number((await pool.query("select count(*) from public.customers where user_id = $1", [demo])).rows[0].count)).toBe(before);
    expect(Number((await pool.query("select count(*) from public.customers where user_id = $1", [owner])).rows[0].count)).toBe(1);
    const w = (await pool.query("select demo_user_id, status, seed_step, reset_count from public.demo_workspaces where id = $1", [ws.workspaceId])).rows[0];
    expect(w.demo_user_id).toBe(fresh);
    expect(w.seed_step).toBe(0);
  });

  it("records guide progress per person and keeps it private", async () => {
    const rec = (uid: string, p: Record<string, unknown>) => asUser(pool, uid, (q) => q("select public.guide_record($1::jsonb) as r", [JSON.stringify(p)]));
    await rec(stranger, { event: "offered", tourId: "pm-hub", version: 1, dedupe: "offered:pm-hub:1:2026-11-18" });
    await rec(stranger, { event: "offered", tourId: "pm-hub", version: 1, dedupe: "offered:pm-hub:1:2026-11-18" });
    let g = (await pool.query("select status, offered_count from public.guide_progress where user_id = $1 and tour_id = 'pm-hub'", [stranger])).rows[0];
    expect(g).toMatchObject({ status: "offered", offered_count: 1 });
    await rec(stranger, { event: "started", tourId: "pm-hub", version: 1, step: 0 });
    await rec(stranger, { event: "step", tourId: "pm-hub", version: 1, step: 3 });
    g = (await pool.query("select status, last_step from public.guide_progress where user_id = $1 and tour_id = 'pm-hub'", [stranger])).rows[0];
    expect(g).toMatchObject({ status: "in_progress", last_step: 3 });
    await rec(stranger, { event: "completed", tourId: "pm-hub", version: 1, step: 7 });
    await rec(stranger, { event: "dismissed", tourId: "pm-hub", version: 1 });
    g = (await pool.query("select status, completed_at from public.guide_progress where user_id = $1 and tour_id = 'pm-hub'", [stranger])).rows[0];
    expect(g.status).toBe("completed");
    expect(g.completed_at).not.toBeNull();
    const others = await asUser(pool, owner, (q) => q("select count(*) from public.guide_progress where user_id = $1", [stranger]));
    expect(Number(others.rows[0].count)).toBe(0);
    // Demo activity is labelled as such, never as a real account's.
    await rec(demo, { event: "started", tourId: "demo-tour", version: 1, step: 0 });
    const ev = (await pool.query("select workspace from public.guide_events where user_id = $1 and tour_id = 'demo-tour'", [demo])).rows[0];
    expect(ev.workspace).toBe("demo");
  });

  it("AI help usage can be logged alongside the existing AI kinds", async () => {
    const def = (await pool.query("select pg_get_constraintdef(oid) d from pg_constraint where conname = 'ai_generations_kind_check'")).rows[0].d as string;
    for (const k of ["scope", "exclusions", "academy_summary", "guide_help"]) expect(def).toContain(k);
  });

  it("the owner overview is aggregates only, for the platform owner only", async () => {
    await expect(pool.query("select public.admin_guide_overview($1, 30)", [stranger])).rejects.toThrow(/forbidden/);
    const o = (await pool.query("select public.admin_guide_overview($1, 30) as r", [owner])).rows[0].r;
    const real = o.tours.filter((t: { workspace: string }) => t.workspace === "real");
    expect(real.find((t: { tourId: string }) => t.tourId === "demo-tour")).toBeUndefined();
    expect(o.tours.find((t: { tourId: string; workspace: string }) => t.tourId === "demo-tour")?.workspace).toBe("demo");
  });
});

d("Practice Mode: 24-month sample company with a simulated bank (20270219003000)", () => {
  let pool: Pool, drop: () => Promise<void>;
  let user: string, practice: string, ws: { workspaceId: string; companyId: string; demoUserId: string };
  let data: ReturnType<typeof buildDemoDataset>;
  // The seed runs as of "today" in the database, so anchor on today like the server does.
  const ANCHOR = new Date().toISOString().slice(0, 10);
  const n = async (sql: string, p: unknown[] = []) => Number((await pool.query(sql, p)).rows[0].count);

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("b2b_practice_24m"));
    user = await createUser(pool, "contractor@built.test");   // any signed-in user, not an admin
    practice = await createUser(pool, "practice-abc123def4@example.com");
    ws = (await pool.query("select public.demo_provision($1, $2, 'practice') as r", [user, practice])).rows[0].r;
    data = buildDemoDataset({ kind: "practice", namespace: ws.workspaceId, anchor: ANCHOR });
    const r = await applyDemoDataset(pgRpc(pool), ws.workspaceId, data, { budgetMs: 300_000 });
    expect(r.error ? `${r.step}: ${r.error}` : undefined).toBeUndefined();
    expect(r.done).toBe(true);
  }, 400_000);
  afterAll(async () => { await drop?.(); });

  it("gives Practice the full company on a no-billing complimentary grant", async () => {
    expect(ws.companyId).toBeTruthy();
    expect(await n("select count(*) from public.estimates where user_id = $1", [practice])).toBe(169);
    expect(await n("select count(*) from public.complimentary_grants where user_id = $1 and status = 'active' and plan = 'enterprise'", [practice])).toBe(1);
    expect(await n("select count(*) from public.subscriptions where user_id = $1 or company_id = $2", [practice, ws.companyId])).toBe(0);
    // Two years of history: the oldest bid is more than 23 months back.
    const oldest = (await pool.query("select min(created_at)::date d from public.estimates where user_id = $1", [practice])).rows[0].d as Date;
    expect((Date.now() - oldest.getTime()) / 86_400_000).toBeGreaterThan(700);
  });

  it("the bank is clearly fake: mock, sandbox, SIMULATED names, no token, never syncs", async () => {
    const c = (await pool.query("select c.* from public.fin_bank_connections c join public.fin_books b on b.id = c.book_id where b.company_id = $1", [ws.companyId])).rows;
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ provider: "mock", sandbox: true, status: "active", next_sync_at: null });
    expect(c[0].institution_name).toMatch(/SIMULATED/);
    expect(c[0].provider_item_ref).toMatch(/^demo-sim:/);
    expect(await n("select count(*) from public.fin_bank_connection_secrets where connection_id = $1", [c[0].id])).toBe(0);
    const a = (await pool.query("select * from public.fin_bank_accounts where connection_id = $1", [c[0].id])).rows;
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ last4: "0000", kind: "checking" });
    expect(a[0].name).toMatch(/SIMULATED/);
    // Every bank line says SIMULATED.
    expect(await n("select count(*) from public.fin_bank_transactions where account_id = $1 and description not like '%(SIMULATED)'", [a[0].id])).toBe(0);
  });

  it("reconciles to the cent: monthly statements, balances, matched lines, month-end reconciliations", async () => {
    const acct = (await pool.query("select a.id from public.fin_bank_accounts a join public.fin_bank_connections c on c.id = a.connection_id join public.fin_books b on b.id = c.book_id where b.company_id = $1", [ws.companyId])).rows[0].id;
    const lines = data.bank.statements.flatMap((s) => s.transactions);
    expect(await n("select count(*) from public.fin_bank_transactions where account_id = $1", [acct])).toBe(lines.length);
    expect(await n("select count(*) from public.fin_bank_imports where account_id = $1 and file_name like '%(SIMULATED)%'", [acct])).toBe(data.bank.statements.filter((s) => s.transactions.length).length);
    const bal = (await pool.query("select public.fin_bank_balance($1, current_date) as b", [acct])).rows;
    // fin_bank_balance needs view permission: read it as the practice login.
    const asPractice = await asUser(pool, practice, (q) => q("select public.fin_bank_balance($1, current_date) as b", [acct]));
    expect(asPractice.rows[0].b).toBe(data.bank.currentBalance);
    expect(bal).toBeDefined();
    const latest = (await pool.query("select current_balance from public.fin_bank_balances where account_id = $1 order by as_of desc limit 1", [acct])).rows[0];
    expect(latest.current_balance).toBe(data.bank.currentBalance);
    const unmatched = await n("select count(*) from public.fin_bank_transactions t where t.account_id = $1 and not exists (select 1 from public.fin_bank_matches m where m.bank_txn_id = t.id and m.status = 'active')", [acct]);
    expect(unmatched).toBe(lines.filter((t) => !t.post).length);
    const rec = (await pool.query("select status, difference from public.fin_reconciliations where account_id = $1", [acct])).rows;
    expect(rec).toHaveLength(data.bank.reconcile.length);
    expect(rec.every((x) => x.status === "reconciled" && Number(x.difference) === 0)).toBe(true);
    expect(data.bank.reconcile.length).toBeGreaterThanOrEqual(22);
  });

  it("has realistic exceptions: refund, change orders, overdue invoices, owner draws excluded, a loss-making job", async () => {
    const book = (await pool.query("select id from public.fin_books where company_id = $1 and sandbox_of is null", [ws.companyId])).rows[0].id;
    expect(await n("select count(*) from public.fin_refunds where book_id = $1 and status = 'active'", [book])).toBe(1);
    const co = (await pool.query("select status from public.change_orders where company_id = $1 order by status", [ws.companyId])).rows.map((x) => x.status);
    expect(co).toEqual(["approved", "approved", "declined", "sent"]);
    expect(await n("select count(*) from public.fin_invoices where book_id = $1 and status in ('issued', 'partially_paid', 'open', 'overdue', 'sent') and due_date < current_date", [book])).toBeGreaterThan(0);
    expect(await n("select count(*) from public.fin_bank_matches where book_id = $1 and target_type = 'excluded'", [book])).toBe(8);
    expect(await n("select count(*) from public.fin_cash_events where book_id = $1", [book])).toBe(data.cashPlan.length);
    // At least one job cost more than it billed.
    const loss = await n(`select count(*) from public.fin_jobs j where j.book_id = $1 and
      (select coalesce(sum(amount), 0) from public.fin_expenses x where x.job_id = j.id) >
      (select coalesce(sum(total), 0) from public.fin_invoices i where i.job_id = j.id and i.status <> 'void')`, [book]);
    expect(loss).toBeGreaterThan(0);
  });

  it("never shows up in the owner's admin numbers (20270219004000)", async () => {
    const admin = await createUser(pool, "owner-admin@built.test");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [admin]);
    const real = Number((await pool.query("select count(*) from auth.users u where not public.is_demo_account(u.id)")).rows[0].count);
    const m = (await pool.query("select public.admin_metrics($1) as r", [admin])).rows[0].r;
    expect(m.accounts).toBe(real);
    expect(m.trade_popularity).toEqual([]);                     // only sample bids exist in this database
    const g = (await pool.query("select public.growth_funnel($1, now() - interval '3 years') as r", [admin])).rows[0].r;
    expect(g.signups_total).toBe(real);
    expect(g.activated_total).toBe(0);
    expect(await n("select count(*) from public.growth_meaningful_estimates()")).toBe(0);
    const c = (await pool.query("select public.admin_comp_list($1, '{}'::jsonb) as r", [admin])).rows[0].r;
    expect(c.metrics.total).toBe(0);
    expect(c.rows).toEqual([]);
    const pt = (await pool.query("select public.admin_proposal_text_metrics($1, 3650) as r", [admin])).rows[0].r;
    expect(pt.estimates).toBe(0);
    expect(pt.proposals.exported).toBe(0);
    // The sample data is really there: the reports leave it out on purpose.
    expect(await n("select count(*) from public.estimates where user_id = $1", [practice])).toBe(169);
  });

  it("stays isolated: the practising user's real account sees none of it", async () => {
    const seen = await asUser(pool, user, (q) => q("select count(*) from public.fin_bank_transactions"));
    expect(Number(seen.rows[0].count)).toBe(0);
    const est = await asUser(pool, user, (q) => q("select count(*) from public.estimates"));
    expect(Number(est.rows[0].count)).toBe(0);
  });
});

