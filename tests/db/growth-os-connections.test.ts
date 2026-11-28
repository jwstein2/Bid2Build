// Growth OS Phase 5 (Connections Center): database integration tests on real Postgres (scripts/test-db.sh).
// App migrations, then the Phase 4 foundation, then Phase 5 + the generated registry seed. The worker connects as
// growth_worker, so every grant and refusal is the real one. Platform HTTP calls are replaced by recorded fixtures.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { dbAvailable, freshDb } from "./harness";
import { type Deps, type Sql, tick } from "../../growth-os/worker/core";
import { connectorHandlers } from "../../growth-os/worker/connectors";
import { CONNECTORS, STATUSES } from "../../growth-os/connectors/registry";
import { seedSql } from "../../growth-os/connectors/gen-seed";
import { fakeFetch, type Route } from "../growth-os/connectors/fake-fetch";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
const ROOT = path.resolve(import.meta.dirname, "../..");
const M = (f: string) => readFileSync(path.join(ROOT, "growth-os/supabase", f), "utf8");

let admin: Pool, workerPool: Pool, url: string, drop: () => Promise<void>;
const q = async (sql: string, params: unknown[] = []) => (await admin.query(sql, params)).rows;
const one = async (sql: string, params: unknown[] = []) => (await q(sql, params))[0];
function sqlFor(pool: Pool): Sql {
  return (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0];
    values.forEach((_, i) => { text += `$${i + 1}` + strings[i + 1]; });
    return (await pool.query(text, values)).rows;
  }) as Sql;
}
const w = () => sqlFor(workerPool);
const status = async (provider: string) => (await one("select status from growth.connection_status_v where provider = $1", [provider])).status as string;
const vault = async (name: string) => (await one("select decrypted_secret as v from vault.decrypted_secrets where name = $1", [name]))?.v as string | undefined;
async function runTick(routes: Route[], now?: () => number) {
  const f = fakeFetch(routes);
  const deps: Deps = { sql: w(), worker: "test-worker", env: "test", deadlineMs: 20_000, handlers: connectorHandlers(f.fetch, { now }) };
  const out = await tick(deps);
  return { out, calls: f.calls };
}

d("Growth OS Connections Center (Phase 5)", () => {
  beforeAll(async () => {
    const db = await freshDb("byb_test_growth_conn");
    admin = db.pool; url = db.url; drop = db.drop;
    // Supabase Vault and pg_net stand-ins (the real ones exist on every Supabase project).
    await admin.query(`create schema if not exists vault;
      create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text, description text);
      create view vault.decrypted_secrets as select id, name, secret as decrypted_secret, description from vault.secrets;
      create function vault.create_secret(new_secret text, new_name text, new_description text) returns uuid language sql as
        $$ insert into vault.secrets (name, secret, description) values (new_name, new_secret, new_description) returning id $$;
      create function vault.update_secret(secret_id uuid, new_secret text, new_name text, new_description text) returns void language sql as
        $$ update vault.secrets set secret = new_secret, name = new_name, description = new_description where id = secret_id $$;
      create schema if not exists net;
      create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) returns bigint language sql as $$ select 1::bigint $$;`);
    await admin.query(M("migrations/20270301001000_growth_os_foundation.sql"));
    await admin.query(M("migrations/20270302001000_growth_os_connections.sql"));
    await admin.query(M("migrations/20270302001100_growth_connectors_seed.sql"));
    await admin.query("alter role growth_worker login");
    await admin.query("update growth.schedules set enabled = false");  // tests enqueue explicitly
    await admin.query("select growth_api.resume('tests')");
    workerPool = new Pool({ connectionString: url.replace("postgres://postgres@", "postgres://growth_worker@"), max: 5 });
  });
  afterAll(async () => { await workerPool?.end(); await drop?.(); });

  // -------------------------------------------------------------------------------------------
  describe("A1: every integration shows exactly one of the five statuses", () => {
    it("the generated seed matches registry.ts", () => {
      expect(M("migrations/20270302001100_growth_connectors_seed.sql")).toBe(seedSql());
    });

    it("all registry connectors and operations are present with a valid status", async () => {
      const ov = (await one("select growth_api.connections_overview() as o")).o;
      expect(ov.connectors.map((c: { provider: string }) => c.provider)).toEqual(CONNECTORS.map((c) => c.provider));
      for (const c of ov.connectors) {
        expect(STATUSES).toContain(c.status);
        const reg = CONNECTORS.find((x) => x.provider === c.provider)!;
        expect(c.operations.map((o: { op_key: string }) => o.op_key)).toEqual(reg.operations.map((o) => o.key));
        for (const o of c.operations) expect(STATUSES).toContain(o.status);
      }
    });

    it("before any connection, nothing is live: baselines only", async () => {
      const rows = await q("select provider, status from growth.connection_status_v");
      const byP = Object.fromEntries(rows.map((r) => [r.provider, r.status]));
      expect(Object.values(byP)).not.toContain("verified_operational");
      expect(Object.values(byP)).not.toContain("limited");
      expect(byP.video_tools).toBe("unsupported");
      expect(byP.tiktok_business).toBe("awaiting_platform_approval");
      expect(byP.linkedin).toBe("awaiting_platform_approval");
      expect(byP.google_ads).toBe("awaiting_platform_approval");
      expect(byP.stripe).toBe("awaiting_authorization");
      expect((await one("select status from growth.operation_status_v where provider = 'ga4_gtm' and op_key = 'gtm.read'")).status).toBe("unsupported");
    });
  });

  // -------------------------------------------------------------------------------------------
  describe("A3: administrator authorization", () => {
    it("the worker and signed-in customers cannot register, start OAuth, approve scopes, attach secrets or revoke", async () => {
      const x = w();
      await expect(x`select growth_api.register_connection('stripe', 'acct')`).rejects.toThrow(/permission denied/);
      await expect(x`select growth_api.oauth_begin('youtube', 'x')`).rejects.toThrow(/permission denied/);
      await expect(x`select growth_api.approve_privileged_scopes('youtube', 'x', array['a'])`).rejects.toThrow(/permission denied/);
      await expect(x`select growth_api.attach_manual_secret('stripe', 'x', 'growth_stripe_k')`).rejects.toThrow(/permission denied/);
      await expect(x`select growth_api.revoke_connection('stripe', 'x')`).rejects.toThrow(/permission denied/);
      await expect(x`select growth_api.connections_overview()`).rejects.toThrow(/permission denied/);
      await expect(x`select * from growth.connections`).rejects.toThrow(/permission denied/);
      const c = await admin.connect();
      try {
        await c.query("begin; set local role authenticated");
        await expect(c.query("select growth_api.connections_overview()")).rejects.toThrow(/permission denied/);
      } finally { await c.query("rollback"); c.release(); }
    });

    it("unsupported connectors cannot be registered", async () => {
      await expect(q("select growth_api.register_connection('video_tools', 'opusclip')")).rejects.toThrow(/unsupported/);
    });

    it("privileged scopes need a separate recorded approval before OAuth can request them", async () => {
      await q("select growth_api.register_connection('facebook_pages', '61596515102500', 'Built2Bid', false, 'admin:james')");
      await expect(q("select growth_api.oauth_begin('facebook_pages', '61596515102500', array['pages_show_list', 'pages_manage_posts'])"))
        .rejects.toThrow(/privileged approval/);
      await expect(q("select growth_api.approve_privileged_scopes('facebook_pages', '61596515102500', array['pages_show_list'])"))
        .rejects.toThrow(/not privileged/);
      const sha = (await one("select growth_api.approve_privileged_scopes('facebook_pages', '61596515102500', array['pages_manage_posts'], 'admin:james') as s")).s;
      expect(sha).toBe(createHash("sha256").update("pages_manage_posts").digest("hex"));
      const r = (await one("select growth_api.oauth_begin('facebook_pages', '61596515102500', array['pages_show_list', 'pages_manage_posts']) as r")).r;
      expect(r.scopes).toEqual(["pages_show_list", "pages_manage_posts"]);
      await expect(q("select growth_api.oauth_begin('facebook_pages', '61596515102500', array['user_posts'])")).rejects.toThrow(/registry entry/);
    });

    it("manual secrets must exist in Vault and be named for their provider", async () => {
      await q("select growth_api.register_connection('stripe', 'built2bid')");
      await expect(q("select growth_api.attach_manual_secret('stripe', 'built2bid', 'growth_stripe_restricted_key')")).rejects.toThrow(/no Vault secret/);
      await expect(q("select growth_api.attach_manual_secret('stripe', 'built2bid', 'growth_buffer_api_key')")).rejects.toThrow(/must start with/);
      await expect(q("select growth_api.attach_manual_secret('youtube', 'x', 'growth_youtube_x')")).rejects.toThrow(/does not take a manual secret/);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe("A2: simulated or stale can never show as verified", () => {
    it("nobody can write verified_operational by hand, not even the database owner", async () => {
      await expect(q("update growth.connections set status = 'verified_operational', last_verified_at = now() where provider = 'stripe'"))
        .rejects.toThrow(/only be set by a health check/);
      await expect(q("insert into growth.connections (provider, account_ref, status, last_verified_at) values ('buffer', 'x', 'verified_operational', now())"))
        .rejects.toThrow(/only be set by a health check/);
    });

    it("a simulated connection with a perfect check stays limited and is labelled simulated", async () => {
      await q("select growth_api.register_connection('meta_business', 'sim-portfolio', 'Simulated', true)");
      const s = (await one(`select growth_api.record_check('meta_business', 'sim-portfolio', 'ok', 200, 5, array['business_management', 'ads_read'],
        null, null, null, 'test') as s`)).s;
      expect(s).toBe("limited");
      const v = await one("select status, is_simulated, last_error from growth.connection_status_v where provider = 'meta_business'");
      expect(v).toMatchObject({ status: "limited", is_simulated: true });
      expect(v.last_error).toMatch(/Simulated/);
      const c = await admin.connect();
      try {
        await c.query("begin; select set_config('growth.status_writer', 'health_check', true)");
        await expect(c.query("update growth.connections set status = 'verified_operational', last_verified_at = now() where account_ref = 'sim-portfolio'"))
          .rejects.toThrow(/connections_simulated_never_live/);
      } finally { await c.query("rollback"); c.release(); }
      await expect(q("select growth_api.oauth_begin('meta_business', 'sim-portfolio')")).rejects.toThrow(/simulated/);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe("OAuth flow (growth-oauth Edge Function steps) and A4: tokens only in Vault", () => {
    const TOKEN = "EAAGtokenvalue-should-never-leak-123456";
    let state: string;

    it("start returns an S256 challenge for the stored verifier; consume is single use", async () => {
      await q("select growth_api.register_connection('youtube', 'UCygpeFVjUVYNpmDpoXxFEXg', '@Built2Bid')");
      state = (await one("select growth_api.oauth_begin('youtube', 'UCygpeFVjUVYNpmDpoXxFEXg', null, 'admin:james') as r")).r.state;
      expect(state).toMatch(/^[0-9a-f]{64}$/);
      expect(await q("select * from growth.oauth_states where state_sha256 = $1", [state])).toHaveLength(0);   // only the hash is stored
      const s = (await w()`select growth_api.oauth_start(${state}) as s`)[0].s;
      expect(s.scopes).toEqual(["https://www.googleapis.com/auth/youtube.readonly", "https://www.googleapis.com/auth/yt-analytics.readonly"]);
      const c = (await w()`select growth_api.oauth_consume(${state}) as c`)[0].c;
      expect(s.code_challenge).toBe(createHash("sha256").update(c.code_verifier).digest("base64url"));
      await expect(w()`select growth_api.oauth_consume(${state})`).rejects.toThrow(/unknown, used or expired/);
      await expect(w()`select growth_api.oauth_start(${state})`).rejects.toThrow(/unknown or expired/);
    });

    it("complete stores the token in Vault and keeps the connection non-live until a health check", async () => {
      const sha = createHash("sha256").update(state).digest("hex");
      const token = JSON.stringify({ access_token: TOKEN, refresh_token: "1//refresh-secret-abcdef", obtained_at: new Date().toISOString() });
      await w()`select growth_api.oauth_complete(${sha}, ${token}::jsonb, ${["https://www.googleapis.com/auth/youtube.readonly"]}::text[], ${new Date(Date.now() + 3600e3).toISOString()}::timestamptz)`;
      await expect(w()`select growth_api.oauth_complete(${sha}, ${token}::jsonb, null, null)`).rejects.toThrow(/not in the callback step/);
      const row = await one("select secret_name, status, last_error_code, granted_scopes from growth.connections where provider = 'youtube'");
      expect(row.secret_name).toBe("growth_conn_youtube_ucygpefvjuvynpmdpoxxfexg");
      expect(JSON.parse((await vault(row.secret_name))!).access_token).toBe(TOKEN);
      expect(row).toMatchObject({ status: "awaiting_authorization", last_error_code: "pending_check" });
      expect(await status("youtube")).toBe("awaiting_authorization");
    });

    it("an expired link is refused", async () => {
      const st = (await one("select growth_api.oauth_begin('youtube', 'UCygpeFVjUVYNpmDpoXxFEXg') as r")).r.state;
      await q("update growth.oauth_states set expires_at = now() - interval '1 second' where state_sha256 = encode(sha256(convert_to($1, 'UTF8')), 'hex')", [st]);
      await expect(w()`select growth_api.oauth_start(${st})`).rejects.toThrow(/expired/);
    });

    it("health check with partial grants → awaiting authorization for the missing operation, then verified when all are granted", async () => {
      const yt = (scopes: string) => [
        { match: /oauth2\.googleapis\.com\/tokeninfo/, json: { scope: scopes } },
        { match: /youtube\/v3\/channels/, json: { items: [{ id: "UCygpeFVjUVYNpmDpoXxFEXg", snippet: { title: "Built2Bid" } }] } },
      ];
      await q("select growth_api.request_health_check('youtube', 'admin:james')");
      await runTick(yt("https://www.googleapis.com/auth/youtube.readonly"));
      const ops = await q("select op_key, status from growth.operation_status_v where provider = 'youtube' order by sort");
      expect(Object.fromEntries(ops.map((o) => [o.op_key, o.status]))).toMatchObject({ "channel.read": "limited", "analytics.read": "awaiting_authorization" });
      expect(await status("youtube")).toBe("limited");
      const last = await one("select last_error from growth.connections where provider = 'youtube'");
      expect(last.last_error).toMatch(/Missing permissions: https:\/\/www.googleapis.com\/auth\/yt-analytics.readonly/);

      await new Promise((r) => setTimeout(r, 1100));   // distinct idempotency second
      await q("select growth_api.request_health_check('youtube')");
      const { calls } = await runTick(yt("https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly"));
      expect(calls.some((c) => c.url.includes("tokeninfo"))).toBe(true);
      expect(await status("youtube")).toBe("verified_operational");
      // later-phase privileged operations are listed but not rolled up, and stay awaiting authorization
      expect((await one("select status from growth.operation_status_v where provider = 'youtube' and op_key = 'videos.upload'")).status).toBe("awaiting_authorization");
    });

    it("stale: a verified connection whose last good check is 27 h old shows limited", async () => {
      const c = await admin.connect();
      try {
        await c.query("begin; select set_config('growth.status_writer', 'health_check', true)");
        await c.query("update growth.connections set last_verified_at = now() - interval '27 hours' where provider = 'youtube'");
        const r = (await c.query("select status from growth.connection_status_v where provider = 'youtube'")).rows[0];
        expect(r.status).toBe("limited");
        const op = (await c.query("select reason from growth.operation_status_v where provider = 'youtube' and op_key = 'channel.read'")).rows[0];
        expect(op.reason).toMatch(/older than 26 hours/);
      } finally { await c.query("rollback"); c.release(); }
    });

    it("no token or refresh token appears in the overview, audit, checks or run steps", async () => {
      const blob = JSON.stringify(await q(`select (select growth_api.connections_overview())::text as a,
        (select string_agg(detail::text, ' ') from growth.audit) as b, (select string_agg(coalesce(message, ''), ' ') from growth.connection_checks) as c,
        (select string_agg(row_to_json(s)::text, ' ') from growth.run_steps s) as d, (select string_agg(row_to_json(r)::text, ' ') from growth.runs r) as e`));
      expect(blob).not.toContain(TOKEN);
      expect(blob).not.toContain("refresh-secret");
      expect(blob).not.toMatch(/EAAG[A-Za-z0-9]{10,}|rk_(live|test)_[A-Za-z0-9]{8,}|ya29\.[A-Za-z0-9]/);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe("A5: token refresh, and three failures pause the connector", () => {
    it("refreshes a token that expires within 24 h and keeps the refresh token Google did not resend", async () => {
      await q("update growth.connections set expires_at = now() + interval '10 minutes' where provider = 'youtube'");
      await q("insert into vault.secrets (name, secret) values ('growth_google_client_id', 'cid.apps.googleusercontent.com'), ('growth_google_client_secret', 'GOCSPX-test')");
      await q("select growth_api.enqueue('connector.refresh', '{}', 'refresh-1', 'test')");
      const { calls } = await runTick([{ match: /oauth2\.googleapis\.com\/token$/, json: { access_token: "ya29.newtoken", expires_in: 3599, scope: "x", token_type: "Bearer" } }]);
      expect(calls[0].init?.body).toContain("grant_type=refresh_token");
      const name = (await one("select secret_name from growth.connections where provider = 'youtube'")).secret_name;
      const t = JSON.parse((await vault(name))!);
      expect(t.access_token).toBe("ya29.newtoken");
      expect(t.refresh_token).toBe("1//refresh-secret-abcdef");
      const row = await one("select refresh_fail_count, expires_at > now() + interval '50 minutes' as later from growth.connections where provider = 'youtube'");
      expect(row).toMatchObject({ refresh_fail_count: 0, later: true });
      expect(await one("select 1 as x from growth.audit where action = 'token_refresh'")).toBeTruthy();
    });

    it("three failed refreshes → awaiting authorization, connector paused, owner alert recorded", async () => {
      await q("update growth.connections set expires_at = now() + interval '10 minutes' where provider = 'youtube'");
      for (let i = 1; i <= 3; i++) {
        await q("select growth_api.enqueue('connector.refresh', '{}', $1, 'test')", [`refresh-fail-${i}`]);
        await runTick([{ match: /oauth2\.googleapis\.com\/token$/, status: 400, json: { error: "invalid_grant", error_description: "Token has been expired or revoked." } }]);
      }
      const row = await one("select status, refresh_fail_count, last_error_code from growth.connections where provider = 'youtube'");
      expect(row).toMatchObject({ status: "awaiting_authorization", refresh_fail_count: 3, last_error_code: "refresh_failed" });
      expect((await one("select paused_connectors from growth.control")).paused_connectors).toContain("youtube");
      expect(await one("select detail from growth.audit where action = 'connector_alert'")).toMatchObject({ detail: expect.objectContaining({ provider: "youtube", paused: true }) });
      expect(await status("youtube")).toBe("awaiting_authorization");
      // a paused connector is skipped by the worker (no platform call)
      await q("select growth_api.request_health_check('youtube')");
      const { calls } = await runTick([]);
      expect(calls).toHaveLength(0);
      await q("select growth_api.set_paused('connector', 'youtube', false)");
    });
  });

  // -------------------------------------------------------------------------------------------
  describe("A6: manual-secret health checks and diagnostics (Stripe restricted key)", () => {
    it("all five reads allowed → verified; one refused → limited with a plain-language fix", async () => {
      await q("insert into vault.secrets (name, secret) values ('growth_stripe_restricted_key', 'rk_test_51abcdefghijklmnop')");
      await q("select growth_api.attach_manual_secret('stripe', 'built2bid', 'growth_stripe_restricted_key', 'admin:james')");
      expect(await status("stripe")).toBe("awaiting_authorization");
      await q("select growth_api.request_health_check('stripe')");
      const { calls } = await runTick([{ match: /api\.stripe\.com/, json: { data: [] } }]);
      expect(calls.map((c) => new URL(c.url).pathname)).toEqual(["/v1/customers", "/v1/subscriptions", "/v1/invoices", "/v1/charges", "/v1/balance_transactions"]);
      expect(calls.every((c) => (c.init?.method ?? "GET") === "GET")).toBe(true);
      expect(await status("stripe")).toBe("verified_operational");

      await new Promise((r) => setTimeout(r, 1100));
      await q("select growth_api.request_health_check('stripe')");
      await runTick([{ match: /balance_transactions/, status: 403, json: { error: { type: "invalid_request_error" } } }, { match: /api\.stripe\.com/, json: { data: [] } }]);
      expect(await status("stripe")).toBe("limited");
      const ov = (await one("select growth_api.connections_overview() as o")).o.connectors.find((c: { provider: string }) => c.provider === "stripe");
      expect(ov.checks[0]).toMatchObject({ outcome: "limited", missing_scopes: ["read:balance_transactions"] });
      expect(ov.operations[0].missing_scopes).toEqual(["read:balance_transactions"]);
    });

    it("a full secret key is refused without any call", async () => {
      await q("update vault.secrets set secret = 'sk_live_fullkeyshouldnotbeused' where name = 'growth_stripe_restricted_key'");
      await new Promise((r) => setTimeout(r, 1100));
      await q("select growth_api.request_health_check('stripe')");
      const { calls } = await runTick([]);
      expect(calls).toHaveLength(0);
      expect((await one("select last_error_code from growth.connections where provider = 'stripe'")).last_error_code).toBe("not_restricted_key");
    });

    it("Built2Bid Supabase: the worker's own growth_read access is checked for real", async () => {
      await q("select growth_api.register_connection('supabase', 'growth_db')");
      await q("update growth.connections set auth_kind = 'internal' where provider = 'supabase'");
      await q("select growth_api.request_health_check('supabase')");
      await runTick([]);
      expect((await one("select status from growth.operation_status_v where provider = 'supabase' and op_key = 'growth_read'")).status).toBe("verified_operational");
      expect((await one("select status from growth.operation_status_v where provider = 'supabase' and op_key = 'crm.apply'")).status).toBe("awaiting_authorization");
    });
  });

  // -------------------------------------------------------------------------------------------
  describe("A7: audit trail, revoke and rollback", () => {
    it("every connect / approve / refresh / check-status change / revoke is audited", async () => {
      await q("select growth_api.revoke_connection('youtube', 'UCygpeFVjUVYNpmDpoXxFEXg', 'test', 'admin:james')");
      expect(await vault("growth_conn_youtube_ucygpefvjuvynpmdpoxxfexg")).toBeUndefined();
      expect((await one("select count(*)::int as n from vault.secrets where name like 'growth_conn_youtube%'")).n).toBe(0);
      expect(await status("youtube")).toBe("awaiting_authorization");
      const actions = (await q("select distinct action from growth.audit")).map((r) => r.action);
      for (const a of ["connection_register", "scopes_approve", "oauth_begin", "oauth_complete", "secret_attach", "token_refresh",
        "token_refresh_failed", "connector_alert", "connector_status", "health_check_request", "connection_revoke"]) expect(actions).toContain(a);
      const reg = await one("select actor, detail from growth.audit where action = 'connection_register' and detail->>'provider' = 'facebook_pages'");
      expect(reg.detail.on_behalf).toBe("admin:james");
    });

    it("platform submissions are recorded for awaiting-approval connectors", async () => {
      await q("select growth_api.record_platform_submission('tiktok_business', 'drafted', 'draft in applications/05')");
      const v = await one("select platform_submission, status from growth.connection_status_v where provider = 'tiktok_business'");
      expect(v.platform_submission.status).toBe("drafted");
      expect(v.status).toBe("awaiting_platform_approval");
    });

    it("rollback removes Phase 5 and leaves the Phase 4 foundation working", async () => {
      await admin.query(M("rollback/20270302001000_growth_os_connections_down.sql"));
      expect((await one("select count(*)::int as n from vault.secrets where name like 'growth_conn_%'")).n).toBe(0);
      expect((await one("select count(*)::int as n from vault.secrets where name = 'growth_stripe_restricted_key'")).n).toBe(1);
      expect(await one("select to_regclass('growth.connectors') as t")).toEqual({ t: null });
      expect((await one("select growth_api.enqueue('system.noop', '{}', 'after-rollback', 'test') as id")).id).toBeTruthy();
      // re-apply cleanly (idempotent install path)
      await admin.query(M("migrations/20270302001000_growth_os_connections.sql"));
      await admin.query(M("migrations/20270302001100_growth_connectors_seed.sql"));
      expect((await one("select count(*)::int as n from growth.connectors")).n).toBe(CONNECTORS.length);
    });
  });
});
