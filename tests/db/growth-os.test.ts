// Growth OS Phase 4 foundation: integration tests on real Postgres (scripts/test-db.sh) with the app's
// migrations applied first, then growth-os/supabase/migrations. Workers connect as the growth_worker role,
// so every grant and refusal below is the real one.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { createUser, dbAvailable, freshDb } from "./harness";
import { type Deps, type Llm, type Sql, sha256Hex, tick } from "../../growth-os/worker/core";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
const ROOT = path.resolve(import.meta.dirname, "../..");
const MIGRATION = path.join(ROOT, "growth-os/supabase/migrations/20270301001000_growth_os_foundation.sql");
const ROLLBACK = path.join(ROOT, "growth-os/supabase/rollback/20270301001000_growth_os_foundation_down.sql");

let admin: Pool;          // superuser (stands in for the SQL editor / an operator)
let workerPool: Pool;     // growth_worker login
let workerPoolEnded = false;
let url: string;
let drop: () => Promise<void>;

function sqlFor(pool: Pool): Sql {
  return (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0];
    values.forEach((_, i) => { text += `$${i + 1}` + strings[i + 1]; });
    return (await pool.query(text, values)).rows;
  }) as Sql;
}
const workerUrl = () => url.replace("postgres://postgres@", "postgres://growth_worker@");
const deps = (worker: string, extra: Partial<Deps> = {}): Deps => ({ sql: sqlFor(workerPool), worker, env: "test", deadlineMs: 20_000, ...extra });
const q = async (sql: string, params: unknown[] = []) => (await admin.query(sql, params)).rows;
const one = async (sql: string, params: unknown[] = []) => (await q(sql, params))[0];
const enqueue = (task: string, payload: object, key: string) =>
  one("select growth_api.enqueue($1, $2::jsonb, $3, 'test') as id", [task, JSON.stringify(payload), key]).then((r) => Number(r.id));
const job = (id: number) => one("select * from growth.jobs where id = $1", [id]);

d("Growth OS foundation (growth-os/supabase/migrations/20270301001000)", () => {
  beforeAll(async () => {
    const db = await freshDb("byb_test_growth_os");
    admin = db.pool; url = db.url; drop = db.drop;
    // Supabase-managed pieces the migration expects: Vault and pg_net (stubs; never on a real project).
    await admin.query(`create schema if not exists vault;
      create table if not exists vault.decrypted_secrets (name text primary key, decrypted_secret text);
      create schema if not exists net;
      create table if not exists net.calls (id bigserial primary key, url text, headers jsonb);
      create or replace function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) returns bigint
        language sql as $$ insert into net.calls (url, headers) values (url, headers) returning id $$;`);
    await admin.query(readFileSync(MIGRATION, "utf8"));
    await admin.query("alter role growth_worker login");
    await admin.query("insert into vault.decrypted_secrets values ('growth_cron_secret', 'cron-secret-123'), ('growth_worker_url', 'https://example.test/functions/v1/growth-worker'), ('other_app_key', 'nope')");
    await admin.query("select growth_api.resume('tests')");
    workerPool = new Pool({ connectionString: workerUrl(), max: 10 });
  });
  afterAll(async () => { if (!workerPoolEnded) await workerPool?.end(); await drop?.(); });

  // ---------------------------------------------------------------------------------------------
  describe("least privilege", () => {
    it("the worker cannot read or write customer tables, Vault, or growth tables directly", async () => {
      const w = sqlFor(workerPool);
      await expect(w`select * from public.profiles limit 1`).rejects.toThrow(/permission denied/);
      await expect(w`select * from public.leads limit 1`).rejects.toThrow(/permission denied/);
      await expect(w`insert into public.leads (email_norm) values ('x@y.dev')`).rejects.toThrow(/permission denied/);
      await expect(w`select * from vault.decrypted_secrets`).rejects.toThrow(/permission denied/);
      await expect(w`select * from growth.jobs`).rejects.toThrow(/permission denied/);
      await expect(w`update growth.control set global_stop = false`).rejects.toThrow(/permission denied/);
      await expect(w`select growth_api.resume('worker tries')`).rejects.toThrow(/permission denied/);
      await expect(w`select growth_api.decide_approval(1, true)`).rejects.toThrow(/permission denied/);
    });

    it("the worker reads only growth_ secrets", async () => {
      const w = sqlFor(workerPool);
      expect((await w`select growth_api.secret('growth_cron_secret') as v`)[0].v).toBe("cron-secret-123");
      await expect(w`select growth_api.secret('other_app_key')`).rejects.toThrow(/outside Growth OS/);
    });

    it("signed-in customers get nothing: no schema access, no function access", async () => {
      const c = await admin.connect();
      try {
        await c.query("begin; set local role authenticated");
        await expect(c.query("select * from growth_read.acquisition_events")).rejects.toThrow(/permission denied/);
        await c.query("rollback; begin; set local role authenticated");
        await expect(c.query("select growth_api.stop('x')")).rejects.toThrow(/permission denied/);
      } finally { await c.query("rollback"); c.release(); }
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("reading authorized acquisition events", () => {
    it("ingests analytics_events and lead_events once, excluding internal/test/demo accounts", async () => {
      const real = await createUser(admin, "real@contractor.dev");
      const internal = await createUser(admin, "staff@built2bid.dev");
      await q("insert into public.admin_account_labels (user_id, label) values ($1, 'internal')", [internal]);
      await q("insert into public.analytics_events (user_id, event, event_id) values ($1, 'account_created', $3), ($2, 'account_created', $4)", [real, internal, `ac:${real}`, `ac:${internal}`]);
      const lead = await one("insert into public.leads (email_norm, user_id, stage) values ('real@contractor.dev', $1, 'signed_up') returning id", [real]);
      await q("insert into public.lead_events (lead_id, event, source, dedupe_key) values ($1, 'signed_up', 'app', 'su:1')", [lead.id]);

      const w = sqlFor(workerPool);
      const first = Number((await w`select growth_api.ingest() as n`)[0].n);
      const second = Number((await w`select growth_api.ingest() as n`)[0].n);
      expect(first).toBe(2);   // real account_created + lead.signed_up
      expect(second).toBe(0);  // idempotent
      const inbox = await q("select source, event, subject_ref from growth.events_inbox order by id");
      expect(inbox.map((r) => r.event)).toEqual(["account_created", "lead.signed_up"]);
      expect(inbox.some((r) => r.subject_ref === internal)).toBe(false);
      // The view exposes a hash, never the address.
      const fl = (await w`select * from growth_read.funnel_leads`)[0];
      expect(fl.email_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(fl)).not.toContain("real@contractor.dev");
    });

    it("does not skip a row whose id committed after a higher id (lookback window)", async () => {
      const u = await createUser(admin, "late@contractor.dev");
      await q("insert into public.analytics_events (id, user_id, event, event_id) overriding system value values (1000, $1, 'bid_created', 'late-hi')", [u]);
      await sqlFor(workerPool)`select growth_api.ingest()`;
      // An older id becomes visible only after the cursor moved past it.
      await q("insert into public.analytics_events (id, user_id, event, event_id) overriding system value values (900, $1, 'first_bid_started', 'late-lo')", [u]);
      await sqlFor(workerPool)`select growth_api.ingest(500, 2000)`;
      const got = await q("select count(*)::int as n from growth.events_inbox where props->>'event_id' in ('late-hi', 'late-lo')");
      expect(got[0].n).toBe(2);
    });

    it("dispatches inbox events to tasks that subscribe to them, once per (task, event)", async () => {
      await q(`insert into growth.agent_tasks (key, version, handler, description, risk_tier, requires_approval, triggers, enabled)
               values ('test.on_signup', 1, 'system.noop', 'reacts to signups', 0, false, '{account_created}', true)`);
      const w = sqlFor(workerPool);
      await w`select growth_api.dispatch_events()`;
      await w`update growth.events_inbox set dispatched_at = null`.catch(() => {});  // worker can't: proves no direct DML
      await q("update growth.events_inbox set dispatched_at = null");               // operator re-dispatch is still idempotent
      await w`select growth_api.dispatch_events()`;
      const jobs = await q("select count(*)::int as n from growth.jobs where task_key = 'test.on_signup'");
      expect(jobs[0].n).toBe(1);
      await q("update growth.agent_tasks set enabled = false where key = 'test.on_signup'");
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("durable jobs", () => {
    it("runs 100 jobs exactly once with 4 concurrent workers; duplicate keys are ignored", async () => {
      for (let i = 0; i < 100; i++) await enqueue("system.echo", { i }, `bulk:${i}`);
      expect(await enqueue("system.echo", { i: 0 }, "bulk:0")).toBe(Number((await one("select id from growth.jobs where idempotency_key = 'bulk:0'")).id));
      const results = await Promise.all([1, 2, 3, 4].map((k) => tick(deps(`w${k}`, { batch: 7 }))));
      expect(results.reduce((s, r) => s + r.ran, 0)).toBeGreaterThanOrEqual(100);
      const states = await q("select state, count(*)::int as n from growth.jobs where idempotency_key like 'bulk:%' group by 1");
      expect(states).toEqual([{ state: "succeeded", n: 100 }]);
      const runs = await one("select count(*)::int as n, count(distinct job_id)::int as d from growth.runs r join growth.jobs j on j.id = r.job_id where j.idempotency_key like 'bulk:%'");
      expect(runs).toEqual({ n: 100, d: 100 });
    });

    it("retries transient failures with backoff, then succeeds", async () => {
      const id = await enqueue("system.echo", { fail_times: 2 }, "retry:1");
      await tick(deps("wr"));
      let j = await job(id);
      expect(j.state).toBe("retry");
      expect(new Date(j.run_after).getTime()).toBeGreaterThan(Date.now() + 20_000);  // backed off ~30 s
      for (let i = 0; i < 2; i++) { await q("update growth.jobs set run_after = now() where id = $1", [id]); await tick(deps("wr")); }
      j = await job(id);
      expect(j.state).toBe("succeeded");
      expect(j.attempts).toBe(3);
    });

    it("sends permanent failures and exhausted retries to dead, with an audit row", async () => {
      const perm = await enqueue("system.echo", { permanent: true }, "dead:perm");
      const tired = await enqueue("system.echo", { fail_times: 99 }, "dead:tired");
      for (let i = 0; i < 6; i++) { await q("update growth.jobs set run_after = now() where id = $1", [tired]); await tick(deps("wd")); }
      expect((await job(perm)).state).toBe("dead");
      expect((await job(perm)).attempts).toBe(1);
      expect((await job(tired)).state).toBe("dead");
      expect((await job(tired)).attempts).toBe(5);
      expect((await q("select count(*)::int as n from growth.audit where action = 'job_dead'"))[0].n).toBeGreaterThanOrEqual(2);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("recovering from failures", () => {
    it("a worker that dies mid-job loses its lease; another worker finishes it once; the late completion is fenced", async () => {
      const id = await enqueue("system.echo", { crash: true }, "crash:1");
      const w = sqlFor(workerPool);
      const [claimed] = await w`select * from growth_api.claim('dying-worker', 1, 60)`;
      expect(Number(claimed.job_id)).toBe(id);
      await q("update growth.jobs set lease_expires_at = now() - interval '1 second' where id = $1", [id]);  // time passes
      const res = await tick(deps("rescuer"));
      expect(res.results.succeeded).toBe(1);
      const late = await w`select growth_api.complete(${claimed.run_id}, 'dying-worker', true) as s`;
      expect(late[0].s).toBe("fenced");
      const runs = await q("select status from growth.runs where job_id = $1 order by id", [id]);
      expect(runs.map((r) => r.status)).toEqual(["lost", "succeeded"]);
      expect((await job(id)).state).toBe("succeeded");
    });

    it("a reserved budget from a lost run is released", async () => {
      const u = await q("select u.state from growth.usage u join growth.runs r on r.id = u.run_id where r.status = 'lost'");
      expect(u.every((r) => r.state === "released")).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("approvals and CRM writes", () => {
    let leadId: string;
    beforeAll(async () => {
      const u = await createUser(admin, "crm@contractor.dev");
      leadId = (await one("insert into public.leads (email_norm, user_id, stage) values ('crm@contractor.dev', $1, 'signed_up') returning id", [u])).id;
    });

    it("an approval-gated job waits, runs only after approval, writes once and logs the change", async () => {
      const id = await enqueue("crm.apply_update", { action: "lead.set_stage", lead_id: leadId, stage: "activated" }, "crm:1");
      expect((await job(id)).state).toBe("awaiting_approval");
      await tick(deps("wa"));
      expect((await job(id)).state).toBe("awaiting_approval");
      expect((await one("select stage from public.leads where id = $1", [leadId])).stage).toBe("signed_up");

      const appr = (await job(id)).approval_id;
      expect(await one("select growth_api.decide_approval($1, true, 'ok') as s", [appr])).toEqual({ s: "approved" });
      await tick(deps("wa"));
      expect((await job(id)).state).toBe("succeeded");
      expect((await one("select stage from public.leads where id = $1", [leadId])).stage).toBe("activated");
      const ch = await one("select * from growth.change_log where approval_id = $1", [appr]);
      expect(ch.before.stage).toBe("signed_up");
      expect((await one("select status from growth.approvals where id = $1", [appr])).status).toBe("used");
    });

    it("refuses a payload changed after approval", async () => {
      const id = await enqueue("crm.apply_update", { action: "lead.set_stage", lead_id: leadId, stage: "paid" }, "crm:tamper");
      await one("select growth_api.decide_approval($1, true)", [(await job(id)).approval_id]);
      await q("update growth.jobs set payload = jsonb_set(payload, '{stage}', '\"churned\"') where id = $1", [id]);
      await tick(deps("wt"));
      const j = await job(id);
      expect(j.state).toBe("dead");
      expect(j.last_error).toMatch(/payload changed/);
      expect((await one("select stage from public.leads where id = $1", [leadId])).stage).toBe("activated");
    });

    it("refuses backward stage moves, rejected approvals and tier 3 tasks", async () => {
      const back = await enqueue("crm.apply_update", { action: "lead.set_stage", lead_id: leadId, stage: "prospect" }, "crm:back");
      await one("select growth_api.decide_approval($1, true)", [(await job(back)).approval_id]);
      await tick(deps("wb"));
      expect((await job(back)).state).toBe("dead");
      expect((await job(back)).last_error).toMatch(/not forward/);

      const rej = await enqueue("crm.apply_update", { action: "lead.add_event", lead_id: leadId, event: "called" }, "crm:rej");
      await one("select growth_api.decide_approval($1, false, 'no')", [(await job(rej)).approval_id]);
      expect((await job(rej)).state).toBe("canceled");

      await q(`insert into growth.agent_tasks (key, version, handler, description, risk_tier, requires_approval, enabled)
               values ('ads.launch', 1, 'system.noop', 'never automated', 3, true, true)`);
      await expect(enqueue("ads.launch", {}, "t3")).rejects.toThrow(/never automated/);
    });

    it("reverts a change, and refuses to revert over a later edit", async () => {
      const ch = await one("select id from growth.change_log where target_table = 'public.leads' order by id limit 1");
      await q("update public.leads set stage = 'paid' where id = $1", [leadId]);
      await expect(one("select growth_api.revert_change($1)", [ch.id])).rejects.toThrow(/changed since/);
      await q("update public.leads set stage = 'activated' where id = $1", [leadId]);
      expect(await one("select growth_api.revert_change($1) as s", [ch.id])).toEqual({ s: "reverted" });
      expect((await one("select stage from public.leads where id = $1", [leadId])).stage).toBe("signed_up");
    });

    it("adds an approved note to the lead timeline (and can remove it)", async () => {
      const id = await enqueue("crm.apply_update", { action: "lead.add_event", lead_id: leadId, event: "followup_due", note: "call Tue" }, "crm:note");
      await one("select growth_api.decide_approval($1, true)", [(await job(id)).approval_id]);
      await tick(deps("wn"));
      const ev = await one("select * from public.lead_events where lead_id = $1 and event = 'growth_followup_due'", [leadId]);
      expect(ev.meta.via).toBe("growth_os");
      const ch = await one("select id from growth.change_log where target_table = 'public.lead_events' order by id desc limit 1");
      await one("select growth_api.revert_change($1)", [ch.id]);
      expect(await q("select 1 from public.lead_events where id = $1", [ev.id])).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("emergency stop, pauses and budgets", () => {
    it("global stop: ticks do nothing, claim returns nothing; the worker can stop but not resume", async () => {
      await enqueue("system.noop", {}, "stop:1");
      await sqlFor(workerPool)`select growth_api.stop('circuit breaker test')`;
      const r = await tick(deps("ws"));
      expect(r.skipped).toMatch(/stopped/);
      expect(await sqlFor(workerPool)`select * from growth_api.claim('ws', 5, 60)`).toHaveLength(0);
      await expect(sqlFor(workerPool)`select growth_api.resume('x')`).rejects.toThrow(/permission denied/);
      await q("select growth_api.resume('operator resumes')");
      await tick(deps("ws"));
      expect((await one("select state from growth.jobs where idempotency_key = 'stop:1'")).state).toBe("succeeded");
      const audit = await q("select action from growth.audit where action in ('stop', 'resume') order by id");
      expect(audit.slice(-2).map((a) => a.action)).toEqual(["stop", "resume"]);
    });

    it("a stop raised mid-run puts the job back without finishing it", async () => {
      const handlers = { "system.echo": async (ctx: Parameters<NonNullable<Deps["handlers"]>[string]>[0]) => {
        await admin.query("select growth_api.stop('pressed during run')");
        await ctx.checkStop("resend");
        return { output: "should not get here" };
      } };
      const id = await enqueue("system.echo", { midrun: true }, "stop:mid");
      const r = await tick(deps("wm", { handlers }));
      expect(r.results.stopped).toBe(1);
      expect((await job(id)).state).toBe("retry");
      await q("select growth_api.resume('after mid-run stop')");
    });

    it("paused tasks are skipped until unpaused", async () => {
      await q("select growth_api.set_paused('task', 'system.noop', true)");
      const id = await enqueue("system.noop", {}, "pause:1");
      await tick(deps("wp"));
      expect((await job(id)).state).toBe("queued");
      await q("select growth_api.set_paused('task', 'system.noop', false)");
      await tick(deps("wp"));
      expect((await job(id)).state).toBe("succeeded");
    });

    it("refuses jobs whose estimated cost would break a budget, and settles actual cost", async () => {
      const body = "Summarize the acquisition events in one sentence.";
      await q("insert into growth.prompts (key, version, body, status, approved_by) values ('test.summary', 1, $1, 'approved', 'tests')", [body]);
      await q(`insert into growth.agent_tasks (key, version, handler, description, risk_tier, requires_approval, prompt_key, prompt_version,
               model, max_tokens, est_cost_usd, allowed_connectors, enabled)
               values ('test.summary', 1, 'llm.complete', 'AI test', 0, false, 'test.summary', 1, 'claude-opus-5-5', 500, 0.02, '{anthropic}', true)`);
      const llm: Llm = { complete: async (r) => ({ text: `ok (${r.model})`, tokensIn: 1000, tokensOut: 200, stopReason: "end_turn" }) };
      await q("select growth_api.set_budget('task:test.summary', 'day', 0.01)");
      const blocked = await enqueue("test.summary", { input: "events" }, "llm:blocked");
      await tick(deps("wl", { llm }));
      expect((await job(blocked)).state).toBe("queued");
      expect((await job(blocked)).last_error).toMatch(/waiting for budget: task:test.summary\/day/);

      await q("select growth_api.set_budget('task:test.summary', 'day', 1)");
      await tick(deps("wl", { llm }));
      expect((await job(blocked)).state).toBe("succeeded");
      const run = await one("select * from growth.runs where job_id = $1", [blocked]);
      expect(Number(run.cost_usd)).toBeCloseTo((1000 * 4 + 200 * 20) / 1e6, 6);   // Opus 5.5: $4 / $20 per MTok
      expect(run.prompt_sha256).toBe(await sha256Hex(body));
      const step = await one("select connector, action from growth.run_steps where run_id = $1", [run.id]);
      expect(step).toEqual({ connector: "anthropic", action: "messages.create" });
    });

    it("approved prompts and active tasks are immutable", async () => {
      await expect(q("update growth.prompts set body = 'changed' where key = 'test.summary'")).rejects.toThrow(/immutable/);
      await expect(q("update growth.agent_tasks set est_cost_usd = 0 where key = 'test.summary'")).rejects.toThrow(/immutable/);
      await q("update growth.agent_tasks set enabled = false where key = 'test.summary'");  // switching off is allowed
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("unattended operation", () => {
    it("schedules enqueue exactly one job per slot, even with overlapping ticks", async () => {
      await q("insert into growth.schedules (task_key, every, anchor, enabled) values ('system.noop', interval '1 minute', now() - interval '90 seconds', true)");
      await Promise.all([tick(deps("s1")), tick(deps("s2")), tick(deps("s3"))]);
      const n = await one("select count(*)::int as n from growth.jobs where created_by like 'schedule:%' and task_key = 'system.noop'");
      expect(n.n).toBe(1);
    });

    it("pg_cron's entry point calls the worker URL with the cron secret from Vault", async () => {
      await q("select growth.cron_tick()");
      const call = await one("select * from net.calls order by id desc limit 1");
      expect(call.url).toBe("https://example.test/functions/v1/growth-worker/tick");
      expect(call.headers["x-growth-cron-secret"]).toBe("cron-secret-123");
    });

    it("a worker configured for a different environment does nothing", async () => {
      const r = await tick(deps("wrong-env", { env: "production" }));
      expect(r.skipped).toMatch(/env mismatch/);
    });

    it("contact eligibility combines every suppression list", async () => {
      await q("insert into public.sales_bad_emails (email) values ('bounce@contractor.dev')");
      await q("insert into public.creator_outreach_suppressions (email, reason) values ('creator@contractor.dev', 'unsubscribe')");
      await q("insert into public.sales_suppressions (key) values ('d:donotcall.dev')");
      const w = sqlFor(workerPool);
      const check = async (e: string, p: string) => (await w`select * from growth_api.contact_eligibility(${e}, ${p})`)[0];
      expect(await check("bounce@contractor.dev", "sales_outreach")).toEqual({ allowed: false, reason: "bad_email" });
      expect(await check("creator@contractor.dev", "creator_outreach")).toEqual({ allowed: false, reason: "creator_suppressed" });
      expect(await check("owner@donotcall.dev", "sales_outreach")).toEqual({ allowed: false, reason: "sales_suppressed" });
      expect(await check("crm@contractor.dev", "marketing")).toEqual({ allowed: false, reason: "no_marketing_consent" });
      expect(await check("new@prospect.dev", "sales_outreach")).toEqual({ allowed: true, reason: "ok" });
    });
  });

  // ---------------------------------------------------------------------------------------------
  it("rollback removes every Growth OS object and leaves the app's tables alone", async () => {
    await workerPool.end(); workerPoolEnded = true;
    const before = await one("select count(*)::int as n from pg_tables where schemaname = 'public'");
    await q(readFileSync(ROLLBACK, "utf8"));
    const left = await q("select nspname from pg_namespace where nspname in ('growth', 'growth_read', 'growth_api')");
    expect(left).toHaveLength(0);
    expect((await one("select count(*)::int as n from pg_tables where schemaname = 'public'")).n).toBe(before.n);
    expect((await one("select count(*)::int as n from public.leads")).n).toBeGreaterThan(0);
  });
});
