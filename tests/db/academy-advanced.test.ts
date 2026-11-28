import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb, type Row } from "./harness";

/**
 * Academy Advanced through the real migrations: seed, server-side paywall (RLS + outline), All Access software
 * entitlement, quotes and slot reservations (incl. the last-slot race), founding-member counting with refunds and
 * disputes, grandfathering, out-of-order webhooks and browser-role isolation.
 */
const available = await dbAvailable();
const d = available ? describe : describe.skip;

const AI = "ai-for-contractors";
const BM = "business-management";

d("academy advanced", () => {
  let pool: Pool;
  let drop: () => Promise<void>;
  let n = 0;
  const user = (name: string) => createUser(pool, `${name}-${++n}@example.test`);
  const one = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows[0] as Row;

  async function asAnon<T>(fn: (q: (sql: string, p?: unknown[]) => Promise<{ rows: Row[] }>) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try { await c.query("begin; set local role anon"); return await fn((sql, p) => c.query(sql, p) as Promise<{ rows: Row[] }>); }
    finally { await c.query("rollback").catch(() => {}); c.release(); }
  }
  let subSeq = 0;
  async function subscribe(uid: string, plan: string, subjects: string[], opts: { status?: string; periodEnd?: string; event?: string; sub?: string; stage?: number; amount?: number } = {}) {
    const sub = opts.sub ?? `sub_t${++subSeq}`;
    const price = (await one("select stripe_price_id, amount_cents, stage from public.academy_adv_prices where mode = 'test' and plan = $1 and stage = $2 and active", [plan, opts.stage ?? 1]));
    await pool.query("select public.academy_adv_apply_subscription($1::jsonb)", [JSON.stringify({
      user_id: uid, mode: "test", customer_id: `cus_${uid.slice(0, 8)}`, subscription_id: sub, price_id: price.stripe_price_id, amount_cents: price.amount_cents,
      plan, subjects, status: opts.status ?? "active", current_period_end: opts.periodEnd ?? new Date(Date.now() + 20 * 864e5).toISOString(),
      cancel_at_period_end: false, event_created: opts.event ?? new Date().toISOString(),
    })]);
    return sub;
  }
  const pay = (uid: string, inv: string, cents = 1499, sub = "sub_x") =>
    one("select public.academy_adv_record_invoice($1::jsonb) as r", [JSON.stringify({ user_id: uid, mode: "test", status: "paid", amount_paid: cents, amount_due: cents, invoice_id: inv, subscription_id: sub })]).then((r) => r.r as Row);
  const quote = (uid: string, plan: string, subjects: string[], auto = false) =>
    one("select * from public.academy_adv_quote($1, 'test', $2, $3::text[], 'new', null, null, $4)", [uid, plan, subjects, auto]);
  const readable = (uid: string | null, course: string) => {
    const sql = `select l.slug, l.access from public.academy_lessons l join public.academy_courses c on c.id = l.course_id where c.adv_subject = $1 order by l.sort_order`;
    return uid ? asUser(pool, uid, async (q) => (await q(sql, [course])).rows) : asAnon(async (q) => (await q(sql, [course])).rows);
  };

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("academy_adv_test"));
    pool.on("error", () => {}); // idle clients are terminated when the test database is dropped
    // The paid lesson text isn't in the public repo, so build a published fixture course per launch subject:
    // lesson 1 is the free preview, lessons 2-7 are advanced (the same shape as the real courses).
    for (const [subject, pillar] of [[AI, "growth"], [BM, "accounting"]]) {
      const c = await one("insert into public.academy_courses (slug, pillar, title, summary, level, status, published_at, adv_subject) values ($1, $2, $3, 'Fixture course.', 'advanced', 'published', now(), $4) returning id",
        [`fx-${subject}`, pillar, `Fixture ${subject}`, subject]);
      for (let i = 0; i < 7; i++) {
        await pool.query("insert into public.academy_lessons (course_id, slug, title, body_md, access, status, estimated_minutes, sort_order) values ($1, $2, $3, 'Body.', $4, 'published', 15, $5)",
          [c.id, `lesson-${i + 1}`, `Lesson ${i + 1}`, i === 0 ? "public" : "advanced", i * 10]);
      }
    }
    // Map fake test-mode prices for stages 1-2.
    for (const stage of [1, 2]) {
      for (const plan of ["one_subject", "two_subjects", "all_access"]) {
        await pool.query(`insert into public.academy_adv_prices (mode, plan, stage, amount_cents, stripe_product_id, stripe_price_id)
          select 'test', $1, $2, case $1 when 'one_subject' then one_subject_cents when 'two_subjects' then two_subjects_cents else all_access_cents end, 'prod_test', $3
          from public.academy_adv_price_stages where stage = $2`, [plan, stage, `price_${plan.replace("_", "")}s${stage}`]);
      }
    }
  }, 180_000);
  afterAll(async () => { await drop?.(); });

  it("seeds 10 subjects with the two launch subjects paired and the rest upcoming", async () => {
    const r = await one(`select (select count(*) from public.academy_adv_subjects) s, (select count(*) from public.academy_adv_subjects where status = 'upcoming') up,
      (select recommended_next from public.academy_adv_subjects where slug = $1) ai_next, (select recommended_next from public.academy_adv_subjects where slug = $2) bm_next,
      (select count(*) from public.academy_lessons l join public.academy_courses c on c.id = l.course_id where c.adv_subject is not null) lessons`, [AI, BM]);
    expect(r).toMatchObject({ s: "10", up: "8", ai_next: BM, bm_next: AI, lessons: "14" });
    expect((await one("select public.academy_adv_purchasable($1) p", [AI])).p).toBe(true);
    expect((await one("select public.academy_adv_purchasable('contractor-automation') p")).p).toBe(false);
    expect(await one("select * from public.academy_adv_library()")).toMatchObject({ subjects: 2, lessons: 14, paid_lessons: 12 });
  });

  it("a subject isn't sold while its course is still in review", async () => {
    await pool.query("update public.academy_courses set status = 'in_review' where adv_subject = $1", [BM]);
    try { expect((await one("select public.academy_adv_purchasable($1) p", [BM])).p).toBe(false); }
    finally { await pool.query("update public.academy_courses set status = 'published' where adv_subject = $1", [BM]); }
  });

  it("paywall: visitors and free members read only the preview lesson", async () => {
    const free = await user("free");
    for (const who of [null, free]) {
      const rows = await readable(who, AI);
      expect(rows.map((r) => r.access)).toEqual(["public"]);
    }
    const outline = await asAnon(async (q) => (await q("select access, locked from public.academy_course_outline((select id from public.academy_courses where adv_subject = $1))", [AI])).rows);
    expect(await readable(free, AI).then((r) => r.map((x) => x.slug))).toEqual(["lesson-1"]);
    expect(outline).toHaveLength(7);
    expect(outline.filter((o) => o.locked)).toHaveLength(6);
    expect(outline.find((o) => o.access === "public")?.locked).toBe(false);
  });

  it("one subject opens that subject only; All Access opens everything and includes Individual Unlimited", async () => {
    const one1 = await user("one"); const aa = await user("aa");
    await subscribe(one1, "one_subject", [AI]);
    await subscribe(aa, "all_access", []);
    expect(await readable(one1, AI)).toHaveLength(7);
    expect(await readable(one1, BM)).toHaveLength(1);
    expect(await readable(aa, AI)).toHaveLength(7);
    expect(await readable(aa, BM)).toHaveLength(7);
    expect(await one("select tier, source from public.user_entitlement($1)", [one1])).toEqual({ tier: "free", source: null });
    expect(await one("select tier, source from public.user_entitlement($1)", [aa])).toEqual({ tier: "unlimited", source: "academy_all_access" });
    expect((await one("select public.has_unlimited($1) u", [aa])).u).toBe(true);
    const acc = await asUser(pool, aa, async (q) => (await q("select public.academy_adv_my_access() a")).rows[0].a);
    expect(acc).toMatchObject({ all_access: true, software: true, plan: "all_access" });
  });

  it("access lasts through the paid period after cancelling, then ends; data stays", async () => {
    const u = await user("cancel");
    const sub = await subscribe(u, "all_access", [], { status: "canceled", periodEnd: new Date(Date.now() + 5 * 864e5).toISOString() });
    // A canceled Stripe status ends access at once (Stripe sets canceled only when the paid period is over).
    expect((await one("select source from public.user_entitlement($1)", [u])).source).toBeNull();
    await subscribe(u, "all_access", [], { sub, status: "active", periodEnd: new Date(Date.now() + 5 * 864e5).toISOString(), event: new Date(Date.now() + 1000).toISOString() });
    await pool.query("update public.academy_adv_memberships set cancel_at_period_end = true where stripe_subscription_id = $1", [sub]);
    expect((await one("select source from public.user_entitlement($1)", [u])).source).toBe("academy_all_access");
    expect(Number((await one("select count(*) c from public.academy_adv_memberships where user_id = $1", [u])).c)).toBe(1);
  });

  it("complimentary grants open lessons but never the software", async () => {
    const u = await user("grant");
    await pool.query("insert into public.academy_adv_grants (user_id, scope, reason) values ($1, 'all_access', 'partner')", [u]);
    expect(await readable(u, BM)).toHaveLength(7);
    expect((await one("select source from public.user_entitlement($1)", [u])).source).toBeNull();
    await pool.query("update public.academy_adv_grants set revoked_at = now() where user_id = $1", [u]);
    expect(await readable(u, BM)).toHaveLength(1);
  });

  it("browser roles can't read other people's memberships or write billing tables", async () => {
    const a = await user("rls-a"); const b = await user("rls-b");
    await subscribe(a, "one_subject", [AI]);
    expect(await asUser(pool, a, async (q) => (await q("select count(*) c from public.academy_adv_memberships")).rows[0].c)).toBe("1");
    expect(await asUser(pool, b, async (q) => (await q("select count(*) c from public.academy_adv_memberships")).rows[0].c)).toBe("0");
    await expect(asUser(pool, b, (q) => q("insert into public.academy_adv_memberships (user_id, mode, stripe_customer_id, stripe_subscription_id, plan, status, last_event_at) values ($1, 'test', 'c', 's_fake', 'all_access', 'active', now())", [b]))).rejects.toThrow();
    await expect(asUser(pool, b, (q) => q("select public.academy_adv_quote($1, 'test', 'all_access', '{}'::text[])", [b]))).rejects.toThrow(/permission/);
    await expect(asUser(pool, b, (q) => q("select count(*) from public.academy_adv_founding"))).rejects.toThrow(/permission/);
    await expect(asUser(pool, b, (q) => q("select count(*) from public.academy_adv_prices"))).rejects.toThrow(/permission/);
  });

  it("quotes: approved-stage price, one open quote per person, validation and pause", async () => {
    const u = await user("quote");
    const q1 = await quote(u, "two_subjects", [AI, BM]);
    expect(q1).toMatchObject({ stage: 1, amount_cents: 1499, status: "quoted", holds_slot: true, stripe_price_id: "price_twosubjectss1" });
    const q2 = await quote(u, "all_access", []);
    expect(q2.amount_cents).toBe(2999);
    expect((await one("select status from public.academy_adv_quotes where id = $1", [q1.id])).status).toBe("superseded");
    await expect(quote(u, "two_subjects", [AI])).rejects.toThrow(/bad_subjects/);
    await expect(quote(u, "one_subject", ["contractor-automation"])).rejects.toThrow(/subject_unavailable/);
    const acc = await one("select expires_at e from public.academy_adv_quote_accept($1, $2)", [q2.id, u]);
    expect(new Date(acc.e).getTime()).toBeGreaterThan(Date.now() + 30 * 60_000);
    await pool.query("update public.academy_adv_settings set enrollment_open = false");
    try { await expect(quote(u, "one_subject", [AI])).rejects.toThrow(/enrollment_paused/); }
    finally { await pool.query("update public.academy_adv_settings set enrollment_open = true"); }
    await pool.query("update public.academy_adv_quotes set expires_at = now() - interval '1 minute' where id = $1", [q2.id]);
    await expect(one("select public.academy_adv_quote_accept($1, $2)", [q2.id, u])).rejects.toThrow(/quote_expired/);
  });

  it("a missing Stripe price blocks checkout instead of charging a wrong amount", async () => {
    const u = await user("noprice");
    await pool.query("update public.academy_adv_prices set active = false where mode = 'test' and stage = 1 and plan = 'one_subject'");
    try { await expect(quote(u, "one_subject", [AI])).rejects.toThrow(/price_not_configured/); }
    finally { await pool.query("update public.academy_adv_prices set active = true where mode = 'test' and stage = 1 and plan = 'one_subject'"); }
  });

  it("founding members: first paid invoice counts once; $0 invoices don't count; positions are unique under load", async () => {
    await pool.query("delete from public.academy_adv_founding where mode = 'test'");
    const u = await user("found");
    expect((await pay(u, "in_zero", 0)).founding).toBeNull();
    const first = await pay(u, "in_f1");
    expect(first).toMatchObject({ founding: 1, new: true });
    expect(await pay(u, "in_f2")).toMatchObject({ founding: 1, new: false });
    const many = await Promise.all(Array.from({ length: 12 }, () => user("crowd")));
    const results = await Promise.all(many.map((m, i) => pay(m, `in_c${i}`)));
    const positions = results.map((r) => r.founding as number).sort((a, b) => a - b);
    expect(positions).toEqual(Array.from({ length: 12 }, (_, i) => i + 2));
    expect((await one("select public.academy_adv_qualifying_count('test') c")).c).toBe(13);
  });

  it("refunds and disputes remove a member from the count; a won dispute restores them", async () => {
    const u = await user("refund");
    await pay(u, "in_r1", 999);
    const status = async () => (await one("select status, disqualified_reason r from public.academy_adv_founding where user_id = $1", [u]));
    await one("select public.academy_adv_payment_event('in_r1', 500, null)");
    expect((await status()).status).toBe("qualifying");
    await one("select public.academy_adv_payment_event('in_r1', 999, null)");
    expect(await status()).toEqual({ status: "disqualified", r: "refunded" });
    const v = await user("dispute");
    await pay(v, "in_d1", 999);
    await one("select public.academy_adv_payment_event('in_d1', null, 'lost')");
    expect((await one("select disqualified_reason r from public.academy_adv_founding where user_id = $1", [v])).r).toBe("dispute_lost");
    await one("select public.academy_adv_payment_event('in_d1', null, 'won')");
    expect((await one("select status from public.academy_adv_founding where user_id = $1", [v])).status).toBe("qualifying");
    expect((await one("select public.academy_adv_payment_event('in_unknown', 1, null) r")).r).toBe("unknown");
  });

  it("manual stage by default: the count alone never changes the price", async () => {
    const u = await user("manual");
    expect(Number((await one("select public.academy_adv_qualifying_count('test') c")).c)).toBeGreaterThanOrEqual(10);
    expect((await quote(u, "one_subject", [AI], true)).stage).toBe(1); // auto allowed by env but setting off
  });

  it("auto-advance (setting + flag): the last stage-1 slot goes to exactly one of two simultaneous buyers", async () => {
    await pool.query("delete from public.academy_adv_founding where mode = 'test'");
    await pool.query("update public.academy_adv_quotes set status = 'expired' where status in ('quoted', 'checkout_open')");
    await pool.query("update public.academy_adv_price_stages set min_published_lessons = 0 where stage = 2");
    await pool.query("update public.academy_adv_settings set auto_advance = true");
    try {
      const nine = await Promise.all(Array.from({ length: 9 }, () => user("early")));
      for (const [i, m] of nine.entries()) await pay(m, `in_e${i}`);
      const [a, b] = [await user("race-a"), await user("race-b")];
      const [qa, qb] = await Promise.all([quote(a, "one_subject", [AI], true), quote(b, "one_subject", [AI], true)]);
      expect([qa.stage, qb.stage].sort()).toEqual([1, 2]);
      expect([qa.amount_cents, qb.amount_cents].sort((x, y) => x - y)).toEqual([999, 1299]);
      // Without the Netlify flag the setting does nothing.
      expect((await quote(await user("noflag"), "one_subject", [AI], false)).stage).toBe(1);
      // A returning founding member doesn't take a new slot.
      const back = nine[0];
      expect((await quote(back, "one_subject", [AI], true)).holds_slot).toBe(false);
    } finally {
      await pool.query("update public.academy_adv_settings set auto_advance = false");
      await pool.query("update public.academy_adv_price_stages set min_published_lessons = 24 where stage = 2");
    }
  });

  it("grandfathering: approving stage 2 changes new quotes only; existing members keep their rate; audited", async () => {
    const old = await user("grandfather");
    const sub = await subscribe(old, "two_subjects", [AI, BM]);
    const admin = await user("admin");
    await pool.query("select public.academy_adv_set_stage(2, $1, 'test')", [admin]);
    try {
      expect((await quote(await user("late"), "two_subjects", [AI, BM])).amount_cents).toBe(1799);
      // Renewal event for the old member: still the stage-1 price.
      await subscribe(old, "two_subjects", [AI, BM], { sub, event: new Date(Date.now() + 5000).toISOString() });
      expect(await one("select stage, amount_cents from public.academy_adv_memberships where stripe_subscription_id = $1", [sub])).toEqual({ stage: 1, amount_cents: 1499 });
      const log = await one("select details from public.academy_audit_log where action = 'advanced.stage_set' order by created_at desc limit 1");
      expect(log.details).toMatchObject({ from: 1, to: 2 });
    } finally { await pool.query("select public.academy_adv_set_stage(1, $1, 'reset')", [admin]); }
  });

  it("webhooks out of order: an older event never overwrites a newer one", async () => {
    const u = await user("order");
    const sub = await subscribe(u, "one_subject", [AI], { status: "active", event: new Date(Date.now() + 60_000).toISOString() });
    await subscribe(u, "one_subject", [AI], { sub, status: "incomplete", event: new Date(Date.now() - 60_000).toISOString() });
    expect((await one("select status from public.academy_adv_memberships where stripe_subscription_id = $1", [sub])).status).toBe("active");
  });

  it("unknown prices are logged for reconciliation instead of granting access", async () => {
    const u = await user("unknown");
    const r = await one("select public.academy_adv_apply_subscription($1::jsonb) r", [JSON.stringify({ user_id: u, mode: "test", customer_id: "cus_u", subscription_id: "sub_unknown", price_id: "price_nope", status: "active", event_created: new Date().toISOString() })]);
    expect(r.r).toMatchObject({ applied: false, reason: "unknown_plan" });
    expect(Number((await one("select count(*) c from public.academy_adv_issues where ref = 'sub_unknown'")).c)).toBe(1);
    expect(await readable(u, AI)).toHaveLength(1);
  });

  it("price map rejects an amount that doesn't match the stage", async () => {
    await expect(pool.query("insert into public.academy_adv_prices (mode, plan, stage, amount_cents, stripe_product_id, stripe_price_id) values ('test', 'one_subject', 3, 100, 'prod_x', 'price_bad')")).rejects.toThrow(/price_amount_mismatch/);
  });

  it("admin summary reports membership metrics", async () => {
    const s = (await one("select public.academy_adv_admin_summary('test') s")).s as Row;
    expect(s.members).toBeGreaterThan(0);
    expect(s.mrr_cents).toBeGreaterThan(0);
    expect(s.by_plan).toHaveProperty("all_access");
    expect(s.issues_open).toBeGreaterThanOrEqual(1);
  });
});
