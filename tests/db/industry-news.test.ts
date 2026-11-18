/**
 * Industry news (20261221001000) against the real SQL: articles are readable only when published, per-user
 * preferences and saved/hidden state are private to each user, company defaults are readable by members and
 * saved only by owners/managers, search returns published public articles only (never company records), and
 * retention purges expired metadata.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;

d("industry news (database)", () => {
  let pool: Pool;
  let drop: () => Promise<void>;
  let alice: string, bob: string, owner: string, estimator: string;
  let company: string;
  const ids: Record<string, string> = {};
  const as = (u: string, sql: string, args: unknown[] = []) => asUser(pool, u, (q) => q(sql, args)).then((r) => r.rows);

  const article = async (key: string, o: { status?: string; source?: string; headline?: string; expires?: string } = {}) => {
    const r = await pool.query(
      `insert into public.news_articles (source_key, url, url_key, url_host, headline, publisher, published_at, geo_level, article_type, authority, trades, snippet, status, expires_at)
       values ($1, $2, $2, 'www.achrnews.com', $3, 'ACHR News', now(), 'national', 'news', 'industry', '{hvac}', 'Heat pump efficiency rules change for contractors.', $4, $5) returning id`,
      [o.source ?? "achr-news", `https://www.achrnews.com/articles/${key}`, o.headline ?? `Heat pump installers ${key}`, o.status ?? "published", o.expires ?? new Date(Date.now() + 86_400_000 * 90).toISOString()],
    );
    ids[key] = r.rows[0].id;
  };

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("b2b_test_industry_news"));
    [alice, bob, owner, estimator] = await Promise.all(["alice@example.com", "bob@example.com", "owner@example.com", "est@example.com"].map((e) => createUser(pool, e)));
    company = (await pool.query("insert into public.companies (name, owner_user_id) values ('Acme HVAC', $1) returning id", [owner])).rows[0].id;
    await pool.query("insert into public.company_members (company_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'estimator')", [company, owner, estimator]);
    await article("live");
    await article("hidden", { status: "hidden" });
    await article("excluded-src", { source: "bad-source", headline: "Heat pump excluded source story" });
    await article("old", { expires: new Date(Date.now() - 86_400_000).toISOString() });
    await pool.query("insert into public.news_source_state (source_key, excluded) values ('bad-source', true)");
  }, 180_000);
  afterAll(async () => { await drop?.(); });

  it("signed-in users read published articles only; anonymous visitors read nothing", async () => {
    const rows = await as(alice, "select id from public.news_articles");
    const got = rows.map((r) => r.id);
    expect(got).toContain(ids.live);
    expect(got).not.toContain(ids.hidden);
    await expect(as(alice, "insert into public.news_articles (source_key, url, url_key, url_host, headline, publisher, published_at, geo_level, article_type, authority, expires_at) values ('x', 'https://x.com/a', 'k', 'x.com', 'h', 'p', now(), 'national', 'news', 'industry', now())")).rejects.toThrow(/permission denied/);
    const c = await pool.connect();
    try {
      await c.query("begin; set local role anon");
      await expect(c.query("select id from public.news_articles")).rejects.toThrow(/permission denied/);
    } finally { await c.query("rollback").catch(() => {}); c.release(); }
  });

  it("source state and ingest runs are owner/service only", async () => {
    await expect(as(alice, "select * from public.news_source_state")).rejects.toThrow(/permission denied/);
    await expect(as(alice, "select * from public.news_ingest_runs")).rejects.toThrow(/permission denied/);
  });

  it("keeps each user's preferences private and notifications off by default", async () => {
    await as(alice, "insert into public.news_user_prefs (user_id, followed_trades) values ($1, '{hvac}')", [alice]);
    const mine = await as(alice, "select * from public.news_user_prefs");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ notify_official_rules: false, notify_local_disasters: false, notify_material_prices: false, email_digest: false });
    expect(await as(bob, "select * from public.news_user_prefs")).toHaveLength(0);
    await expect(as(bob, "insert into public.news_user_prefs (user_id) values ($1)", [alice])).rejects.toThrow(/row-level security|duplicate/);
    expect((await as(bob, "update public.news_user_prefs set followed_trades = '{roofing}' where user_id = $1 returning user_id", [alice]))).toHaveLength(0);
  });

  it("keeps saved, hidden and read state private per user", async () => {
    await as(alice, "insert into public.news_user_articles (user_id, article_id, saved, saved_at) values ($1, $2, true, now())", [alice, ids.live]);
    expect(await as(alice, "select * from public.news_user_articles where saved")).toHaveLength(1);
    expect(await as(bob, "select * from public.news_user_articles")).toHaveLength(0);
    await expect(as(bob, "insert into public.news_user_articles (user_id, article_id, hidden) values ($1, $2, true)", [alice, ids.live])).rejects.toThrow(/row-level security|duplicate/);
  });

  it("company defaults: members read them, only owners/managers save them, outsiders see nothing", async () => {
    await as(owner, "select public.news_company_defaults_save($1::jsonb)", [JSON.stringify({ followedTrades: ["hvac"], topics: ["safety"], geoEmphasis: "local" })]);
    expect(await as(estimator, "select followed_trades, topics, geo_emphasis from public.news_company_defaults")).toEqual([{ followed_trades: ["hvac"], topics: ["safety"], geo_emphasis: "local" }]);
    expect(await as(alice, "select * from public.news_company_defaults")).toHaveLength(0);
    await expect(as(estimator, "select public.news_company_defaults_save('{}'::jsonb)")).rejects.toThrow(/forbidden/);
    await expect(as(alice, "select public.news_company_defaults_save('{}'::jsonb)")).rejects.toThrow(/forbidden/);
    await expect(as(owner, "insert into public.news_company_defaults (company_id) values ($1)", [company])).rejects.toThrow(/permission denied/);
  });

  it("search returns published public articles only and skips excluded sources", async () => {
    const hits = await as(alice, "select * from public.news_search('heat pump', 10, '{hvac}')");
    const got = hits.map((r) => r.id);
    expect(got).toContain(ids.live);
    expect(got).not.toContain(ids.hidden);
    expect(got).not.toContain(ids["excluded-src"]);
    expect(hits[0]).toHaveProperty("url");
    expect(await as(alice, "select * from public.news_search('', 10, null)")).toHaveLength(0);
    // Anonymous callers can't run it.
    const c = await pool.connect();
    try {
      await c.query("begin; set local role anon");
      await expect(c.query("select * from public.news_search('heat pump', 5, null)")).rejects.toThrow(/permission denied/);
    } finally { await c.query("rollback").catch(() => {}); c.release(); }
  });

  it("retention purge removes expired metadata and is not callable by users", async () => {
    await expect(as(alice, "select public.news_purge_expired()")).rejects.toThrow(/permission denied/);
    const n = (await pool.query("select public.news_purge_expired() as n")).rows[0].n;
    expect(n).toBe(1);
    expect((await pool.query("select 1 from public.news_articles where id = $1", [ids.old])).rowCount).toBe(0);
  });
});
