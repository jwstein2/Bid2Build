import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb, type Row } from "./harness";

/**
 * Academy monthly challenge (20270223001000): 4 distinct courses + a passed 20-question quiz in one UTC month earns
 * one free month of Individual Unlimited, once per account (and email identity) for life.
 */
const available = await dbAvailable();
const d = available ? describe : describe.skip;

d("academy monthly challenge rewards", () => {
  let pool: Pool;
  let drop: () => Promise<void>;
  let n = 0;
  beforeAll(async () => { ({ pool, drop } = await freshDb("academy_rewards_test")); }, 240_000);
  afterAll(async () => { await drop?.(); });

  /** A published course with `lessons` published lessons. */
  async function course(lessons = 1): Promise<{ id: string; lessons: string[] }> {
    n++;
    const c = (await pool.query(`insert into public.academy_courses (slug, pillar, title, summary, status, access) values ($1, 'sales', $2, 'Test course', 'published', 'public') returning id`,
      [`challenge-test-${n}`, `Challenge test course ${n}`])).rows[0].id as string;
    const ids: string[] = [];
    for (let i = 0; i < lessons; i++) {
      ids.push((await pool.query(`insert into public.academy_lessons (course_id, slug, title, status, access, estimated_minutes, sort_order) values ($1, $2, $3, 'published', 'public', 6, $4) returning id`,
        [c, `lesson-${i + 1}`, `Lesson number ${i + 1}`, i])).rows[0].id);
    }
    return { id: c, lessons: ids };
  }

  async function learner(email: string): Promise<string> {
    const uid = await createUser(pool, email);
    await asUser(pool, uid, (q) => q("select public.academy_join($1::jsonb)", [JSON.stringify({ accept_rules: true, display_name: `L ${uid.slice(0, 4)}` })]));
    return uid;
  }

  async function finish(uid: string, c: { lessons: string[] }) {
    for (const l of c.lessons) await asUser(pool, uid, (q) => q("select public.academy_complete_lesson($1, true, null)", [l]));
  }

  /** Start a challenge quiz, age it so it isn't flagged as too fast, and submit `right` correct answers. */
  async function quiz(uid: string, right: number, opts: { topic?: string; ageSeconds?: number } = {}): Promise<Row> {
    const start = await asUser(pool, uid, async (q) => (await q("select public.academy_challenge_quiz_start($1) s", [opts.topic ?? "safety"])).rows[0].s);
    const ids: string[] = start.questions.map((x: { id: string }) => x.id);
    const correct = new Map((await pool.query("select id, correct, cardinality(options) n from public.academy_kb_items where id = any($1::uuid[])", [ids])).rows.map((r) => [r.id, r]));
    const answers = Object.fromEntries(ids.map((id, i) => { const c = correct.get(id)!; return [id, i < right ? c.correct : (c.correct + 1) % c.n]; }));
    await aged(start.attempt_id, opts.ageSeconds ?? 600);
    return asUser(pool, uid, async (q) => (await q("select public.academy_challenge_quiz_submit($1, $2::jsonb) r", [start.attempt_id, JSON.stringify(answers)])).rows[0].r);
  }

  async function aged(attempt: string, seconds: number) {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('academy.challenge', 'on', true)");
      await c.query("update public.academy_kb_attempts set started_at = now() - make_interval(secs => $2) where id = $1", [attempt, seconds]);
      await c.query("commit");
    } finally { c.release(); }
  }

  /** Move a learner's records back in time (test only: triggers are bypassed for this session). */
  async function backdate(uid: string, interval: string) {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query("set local session_replication_role = replica");
      await c.query(`update public.academy_course_completions set completed_at = completed_at - $2::interval, first_lesson_at = first_lesson_at - $2::interval where user_id = $1`, [uid, interval]);
      await c.query(`update public.academy_kb_attempts set started_at = started_at - $2::interval, finished_at = finished_at - $2::interval where user_id = $1`, [uid, interval]);
      await c.query("commit");
    } finally { c.release(); }
  }

  const reward = async (uid: string) => (await pool.query("select * from public.academy_rewards where user_id = $1", [uid])).rows;
  const status = (uid: string) => asUser(pool, uid, async (q) => (await q("select public.academy_challenge_status() s")).rows[0].s);

  async function deliver(id: string) {
    const begin = (await pool.query("select public.academy_reward_begin($1) b", [id])).rows[0].b;
    if (begin.action === "comp_days") await pool.query("select public.academy_reward_grant_comp($1, $2)", [id, begin.starts_at]);
    return begin;
  }

  it("offers only topics with at least 25 approved questions", async () => {
    const rows = (await pool.query("select slug, public.academy_challenge_pool(slug) pool from public.academy_challenge_topics where active")).rows;
    const ok = rows.filter((r) => r.pool >= 25).map((r) => r.slug);
    expect(ok).toEqual(expect.arrayContaining(["safety", "general-contracting", "business-setup"]));
    const u = await learner("small-topic@contractor-co.com");
    await expect(asUser(pool, u, (q) => q("select public.academy_challenge_quiz_start('hvac')"))).rejects.toThrow(/topic_too_small/);
  });

  it("4 distinct trainings + a passing 20-question quiz earns the reward, delivered as 30 days of Unlimited", async () => {
    const uid = await learner("four-and-pass@contractor-co.com");
    for (let i = 0; i < 4; i++) await finish(uid, await course());
    expect((await status(uid)).month.trainings_done).toBe(4);
    const r = await quiz(uid, 17);
    expect(r).toMatchObject({ correct: 17, total: 20, passed: true });
    expect(r.claim).toMatchObject({ state: "qualified", status: "pending", action: "comp_days" });
    const [row] = await reward(uid);
    expect(row.course_ids).toHaveLength(4);
    const begin = await deliver(row.id);
    expect(begin.action).toBe("comp_days");
    const [after] = await reward(uid);
    expect(after.status).toBe("applied");
    const g = (await pool.query("select plan, pm_editors, included_seats, extra_seats, expires_at - starts_at len, note from public.complimentary_grants where id = $1", [after.grant_id])).rows[0];
    expect(g).toMatchObject({ plan: "unlimited", included_seats: 1, extra_seats: 0, pm_editors: null });
    expect(g.len.days).toBe(30);
    const ent = (await pool.query("select * from public.user_entitlement($1)", [uid])).rows[0];
    expect(ent).toMatchObject({ tier: "unlimited", source: "complimentary" });
    const s = await status(uid);
    expect(s.reward).toMatchObject({ status: "applied", action: "comp_days" });
    expect(s.milestones.map((m: { badge: string }) => m.badge)).toEqual(expect.arrayContaining(["challenge:free-month", "challenge:quiz-passed", "trainings:1"]));
    // Delivering again does nothing.
    expect((await pool.query("select public.academy_reward_begin($1) b", [row.id])).rows[0].b).toMatchObject({ action: "none", reason: "applied" });
    expect((await pool.query("select count(*)::int n from public.complimentary_grants where user_id = $1", [uid])).rows[0].n).toBe(1);
  });

  it("3 trainings + a passing quiz does not qualify", async () => {
    const uid = await learner("three-and-pass@contractor-co.com");
    for (let i = 0; i < 3; i++) await finish(uid, await course());
    const r = await quiz(uid, 20);
    expect(r.passed).toBe(true);
    expect(r.claim).toMatchObject({ state: "in_progress" });
    expect(await reward(uid)).toHaveLength(0);
  });

  it("4 trainings + a failed quiz (15/20) does not qualify; the 80% bar is enforced in the database", async () => {
    const uid = await learner("four-and-fail@contractor-co.com");
    for (let i = 0; i < 4; i++) await finish(uid, await course());
    const r = await quiz(uid, 15);
    expect(r).toMatchObject({ correct: 15, passed: false });
    expect(r.claim).toBeNull();
    expect(await reward(uid)).toHaveLength(0);
    expect((await status(uid)).month.quiz_status).toBe("failed");
  });

  it("repeating the same training does not increase the count or move its completion date", async () => {
    const uid = await learner("repeat@contractor-co.com");
    const c = await course(2);
    await finish(uid, c);
    const first = (await pool.query("select completed_at from public.academy_course_completions where user_id = $1", [uid])).rows[0].completed_at;
    for (let i = 0; i < 3; i++) {
      await asUser(pool, uid, (q) => q("select public.academy_complete_lesson($1, false, null)", [c.lessons[1]]));
      await asUser(pool, uid, (q) => q("select public.academy_complete_lesson($1, true, null)", [c.lessons[1]]));
    }
    const rows = (await pool.query("select completed_at from public.academy_course_completions where user_id = $1", [uid])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].completed_at).toEqual(first);
    expect((await status(uid)).month.trainings_done).toBe(1);
    await expect(pool.query("update public.academy_course_completions set completed_at = now() where user_id = $1", [uid])).rejects.toThrow(/immutable/);
  });

  it("requirements split across months do not qualify", async () => {
    const uid = await learner("split-months@contractor-co.com");
    for (let i = 0; i < 4; i++) await finish(uid, await course());
    await backdate(uid, "40 days");
    const r = await quiz(uid, 18);
    expect(r.passed).toBe(true);
    expect(r.claim).toMatchObject({ state: "in_progress" });
    expect((await status(uid)).month.trainings_done).toBe(0);
    // Those old courses can't be re-earned this month by re-marking lessons either.
    expect(await reward(uid)).toHaveLength(0);
  });

  it("only one lifetime reward per account and per email identity", async () => {
    const uid = await learner("j.smith.builds@gmail.com");
    for (let i = 0; i < 4; i++) await finish(uid, await course());
    await quiz(uid, 16);
    expect(await reward(uid)).toHaveLength(1);
    // Next month: qualifies again, still one reward.
    await backdate(uid, "40 days");
    for (let i = 0; i < 4; i++) await finish(uid, await course());
    const again = await quiz(uid, 20);
    expect(again.claim).toMatchObject({ state: "claimed" });
    expect((await pool.query("select count(*)::int n from public.academy_rewards where user_id = $1", [uid])).rows[0].n).toBe(1);
    const s = await status(uid);
    expect(s.reward).not.toBeNull();
    // Same Gmail identity on a new account (dots and +tag) cannot earn it again.
    const alt = await learner("jsmithbuilds+second@gmail.com");
    for (let i = 0; i < 4; i++) await finish(alt, await course());
    const alt1 = await quiz(alt, 20);
    expect(alt1.claim).toMatchObject({ state: "ineligible", reason: "email_already_rewarded" });
    expect((await status(alt)).email_used).toBe(true);
  });

  it("simultaneous claims and deliveries create exactly one reward and one grant", async () => {
    const uid = await learner("concurrent@contractor-co.com");
    for (let i = 0; i < 4; i++) await finish(uid, await course());
    // Pass the quiz without the auto-claim being decisive: claim from many sessions at once afterwards too.
    const r = await quiz(uid, 19);
    expect(r.claim.state).toBe("qualified");
    const claims = await Promise.all(Array.from({ length: 8 }, () => asUser(pool, uid, async (q) => (await q("select public.academy_challenge_claim() c")).rows[0].c)));
    expect(claims.every((c) => c.state === "claimed")).toBe(true);
    const [row] = await reward(uid);
    const begins = await Promise.all(Array.from({ length: 6 }, () => pool.query("select public.academy_reward_begin($1) b", [row.id]).then((x) => x.rows[0].b)));
    expect(begins.filter((b) => b.action === "comp_days")).toHaveLength(1);
    const winner = begins.find((b) => b.action === "comp_days");
    const grants = await Promise.all(Array.from({ length: 4 }, () => pool.query("select public.academy_reward_grant_comp($1, $2) g", [row.id, winner.starts_at]).then((x) => x.rows[0].g)));
    expect(grants.filter((g) => g.ok)).toHaveLength(1);
    expect((await pool.query("select count(*)::int n from public.complimentary_grants where user_id = $1", [uid])).rows[0].n).toBe(1);
  });

  it("routes monthly subscribers to a one-time Stripe credit that can't be recorded twice", async () => {
    const uid = await learner("monthly-sub@contractor-co.com");
    await pool.query(`insert into public.subscriptions (stripe_subscription_id, user_id, stripe_customer_id, status, plan, current_period_end, source_event_created)
      values ('sub_month_1', $1, 'cus_month_1', 'active', 'monthly', now() + interval '20 days', now())`, [uid]);
    for (let i = 0; i < 4; i++) await finish(uid, await course());
    const r = await quiz(uid, 18);
    expect(r.claim).toMatchObject({ state: "qualified", action: "stripe_credit" });
    const [row] = await reward(uid);
    const b = (await pool.query("select public.academy_reward_begin($1) b", [row.id])).rows[0].b;
    expect(b).toMatchObject({ action: "stripe_credit", customer: "cus_month_1", subscription: "sub_month_1" });
    await pool.query("select public.academy_reward_finish($1, true, 'cbtxn_1', 1999)", [row.id]);
    await pool.query("select public.academy_reward_finish($1, true, 'cbtxn_2', 1999)", [row.id]); // webhook-style retry: ignored
    const [after] = await reward(uid);
    expect(after).toMatchObject({ status: "applied", stripe_ref: "cbtxn_1", credit_cents: 1999 });
    await expect(pool.query("update public.academy_rewards set status = 'pending' where id = $1", [row.id])).rejects.toThrow(/academy_reward_final/);
    await expect(pool.query("delete from public.academy_rewards where id = $1", [row.id])).rejects.toThrow(/immutable/);
    // The subscription itself is untouched.
    expect((await pool.query("select status, plan, cancel_at_period_end from public.subscriptions where stripe_subscription_id = 'sub_month_1'")).rows[0])
      .toMatchObject({ status: "active", plan: "monthly", cancel_at_period_end: false });
  });

  it("sends annual, Enterprise, past-due and suspicious cases to admin review; cancelling subscribers get days after their period", async () => {
    const annual = await learner("annual-sub@contractor-co.com");
    await pool.query(`insert into public.subscriptions (stripe_subscription_id, user_id, stripe_customer_id, status, plan, current_period_end, source_event_created)
      values ('sub_year_1', $1, 'cus_year_1', 'active', 'annual', now() + interval '200 days', now())`, [annual]);
    const ent = await learner("enterprise-sub@contractor-co.com");
    await pool.query(`insert into public.subscriptions (stripe_subscription_id, user_id, stripe_customer_id, status, plan, current_period_end, source_event_created)
      values ('sub_ent_1', $1, 'cus_ent_1', 'active', 'enterprise', now() + interval '20 days', now())`, [ent]);
    const due = await learner("past-due@contractor-co.com");
    await pool.query(`insert into public.subscriptions (stripe_subscription_id, user_id, stripe_customer_id, status, plan, current_period_end, source_event_created)
      values ('sub_due_1', $1, 'cus_due_1', 'past_due', 'monthly', now() + interval '3 days', now())`, [due]);
    const leaving = await learner("cancelling@contractor-co.com");
    await pool.query(`insert into public.subscriptions (stripe_subscription_id, user_id, stripe_customer_id, status, plan, current_period_end, cancel_at_period_end, source_event_created)
      values ('sub_leave_1', $1, 'cus_leave_1', 'active', 'monthly', now() + interval '10 days', true, now())`, [leaving]);
    const fast = await learner("speedy@contractor-co.com");
    const clicker = await learner("clicker@contractor-co.com");
    await finish(clicker, await course(3)); // three lessons marked within seconds: flagged
    for (let i = 0; i < 3; i++) await finish(clicker, await course());
    await quiz(clicker, 20);
    expect((await reward(clicker))[0]).toMatchObject({ status: "review", review_reason: "suspicious_activity", flags: ["fast_course"] });

    for (const u of [annual, ent, due, leaving, fast]) for (let i = 0; i < 4; i++) await finish(u, await course());
    for (const u of [annual, ent, due, leaving]) await quiz(u, 20);
    const f = await quiz(fast, 20, { ageSeconds: 10 });
    expect(f.passed).toBe(true);

    expect((await reward(annual))[0]).toMatchObject({ status: "review", review_reason: "annual_subscriber" });
    expect((await reward(ent))[0]).toMatchObject({ status: "review", review_reason: "enterprise_member" });
    expect((await reward(due))[0]).toMatchObject({ status: "review", review_reason: "billing_issue" });
    expect((await reward(fast))[0]).toMatchObject({ status: "review", review_reason: "suspicious_activity", flags: ["fast_quiz"] });
    // Review items are never delivered automatically.
    expect((await pool.query("select public.academy_reward_begin($1) b", [(await reward(annual))[0].id])).rows[0].b).toMatchObject({ action: "none", reason: "review" });

    const [lv] = await reward(leaving);
    expect(lv).toMatchObject({ status: "pending", action: "comp_days" });
    await deliver(lv.id);
    const g = (await pool.query("select g.starts_at, s.current_period_end from public.complimentary_grants g, public.subscriptions s where g.id = $1 and s.stripe_subscription_id = 'sub_leave_1'",
      [(await reward(leaving))[0].grant_id])).rows[0];
    expect(Math.abs(new Date(g.starts_at).getTime() - new Date(g.current_period_end).getTime())).toBeLessThan(1000);

    // An admin can approve a reviewed reward once (30 days after the annual period), and the trail records it.
    const admin = await createUser(pool, "owner@contractor-co.com");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [admin]);
    const [an] = await reward(annual);
    const b = (await pool.query("select public.academy_reward_begin($1, $2, 'comp_days') b", [an.id, admin])).rows[0].b;
    expect(b.action).toBe("comp_days");
    await pool.query("select public.academy_reward_grant_comp($1, $2, $3)", [an.id, b.starts_at, admin]);
    expect((await pool.query("select public.academy_reward_begin($1, $2, 'comp_days') b", [an.id, admin])).rows[0].b).toMatchObject({ action: "none", reason: "applied" });
    const events = (await pool.query("select action from public.academy_reward_events where reward_id = $1 order by id", [an.id])).rows.map((e) => e.action);
    expect(events).toEqual(["qualified", "applying", "applied"]);
    await pool.query("select public.academy_reward_decline($1, $2, 'Enterprise seat already covers this')", [admin, (await reward(ent))[0].id]);
    expect((await reward(ent))[0].status).toBe("declined");
    const report = (await pool.query("select public.admin_academy_rewards($1) r", [admin])).rows[0].r;
    expect(report.totals.qualified).toBeGreaterThanOrEqual(5);
    expect(report.suspicious.some((s: { kind: string }) => s.kind === "quiz")).toBe(true);
    await expect(pool.query("select public.admin_academy_rewards($1)", [fast])).rejects.toThrow(/forbidden/);
  });

  it("test, internal and unverified accounts never qualify", async () => {
    const t = await learner("someone@example.test");
    for (let i = 0; i < 4; i++) await finish(t, await course());
    expect((await quiz(t, 20)).claim).toMatchObject({ state: "ineligible", reason: "excluded_test" });
    expect(await reward(t)).toHaveLength(0);
  });

  it("locks challenge attempts: no re-grading through study save, single submission, daily limit, answers hidden until submit", async () => {
    const uid = await learner("locked@contractor-co.com");
    const s = await asUser(pool, uid, async (q) => (await q("select public.academy_challenge_quiz_start('safety') s")).rows[0].s);
    expect(s.questions).toHaveLength(20);
    expect(Object.keys(s.questions[0]).sort()).toEqual(["id", "options", "prompt"]);
    // Same attempt is resumed, not a new one.
    const again = await asUser(pool, uid, async (q) => (await q("select public.academy_challenge_quiz_start('general-contracting') s")).rows[0].s);
    expect(again).toMatchObject({ attempt_id: s.attempt_id, resumed: true });
    await expect(asUser(pool, uid, (q) => q("select public.academy_kb_save($1, '{}'::jsonb, 1, false)", [s.attempt_id]))).rejects.toThrow(/challenge_attempt_locked/);
    await asUser(pool, uid, (q) => q("select public.academy_challenge_quiz_submit($1, '{}'::jsonb)", [s.attempt_id]));
    await expect(asUser(pool, uid, (q) => q("select public.academy_challenge_quiz_submit($1, '{}'::jsonb)", [s.attempt_id]))).rejects.toThrow(/already_submitted/);
    for (let i = 0; i < 4; i++) {
      const x = await asUser(pool, uid, async (q) => (await q("select public.academy_challenge_quiz_start('safety') s")).rows[0].s);
      await asUser(pool, uid, (q) => q("select public.academy_challenge_quiz_submit($1, '{}'::jsonb)", [x.attempt_id]));
    }
    await expect(asUser(pool, uid, (q) => q("select public.academy_challenge_quiz_start('safety')"))).rejects.toThrow(/rate_limited/);
    // Ordinary study sessions still work exactly as before.
    const items = (await pool.query("select id, correct from public.academy_kb_items where kind = 'question' and status = 'approved' limit 5")).rows;
    const saved = await asUser(pool, uid, async (q) => {
      const id = (await q("select public.academy_kb_start('quiz', $1::uuid[], '{}'::jsonb, null, null) id", [items.map((x) => x.id)])).rows[0].id;
      return (await q("select public.academy_kb_save($1, $2::jsonb, 5, true) r", [id, JSON.stringify(Object.fromEntries(items.map((x) => [x.id, x.correct])))])).rows[0].r;
    });
    expect(saved).toMatchObject({ correct: 5, total: 5 });
    // Other learners can't see this learner's reward or completions.
    const other = await learner("nosy@contractor-co.com");
    expect(await asUser(pool, other, async (q) => (await q("select count(*)::int n from public.academy_rewards")).rows[0].n)).toBe(0);
  });

  it("an expired quiz (past the 60-minute limit) scores zero", async () => {
    const uid = await learner("slowpoke@contractor-co.com");
    const r = await quiz(uid, 20, { ageSeconds: 70 * 60 });
    expect(r).toMatchObject({ expired: true, passed: false, correct: 0 });
  });

  it("is safe to re-run", async () => {
    const before = (await pool.query("select (select count(*) from public.academy_rewards)::int r, (select count(*) from public.academy_course_completions)::int c, (select count(*) from public.academy_challenge_topics)::int t")).rows[0];
    const { readFileSync } = await import("node:fs");
    await pool.query(readFileSync("supabase/migrations/20270223001000_academy_rewards.sql", "utf8"));
    const after = (await pool.query("select (select count(*) from public.academy_rewards)::int r, (select count(*) from public.academy_course_completions)::int c, (select count(*) from public.academy_challenge_topics)::int t")).rows[0];
    expect(after).toEqual(before);
  });

  it("rolls back cleanly, keeping courses, progress and grants, and re-applies", async () => {
    const { readFileSync } = await import("node:fs");
    const keep = async () => (await pool.query("select (select count(*) from public.academy_lesson_progress)::int p, (select count(*) from public.complimentary_grants)::int g, (select count(*) from public.academy_kb_attempts)::int a")).rows[0];
    const before = await keep();
    await pool.query(readFileSync("docs/academy/rewards/rollback_20270223001000.sql", "utf8"));
    expect((await pool.query("select to_regclass('public.academy_rewards') r, to_regprocedure('public.academy_challenge_claim()') f")).rows[0]).toEqual({ r: null, f: null });
    expect(await keep()).toEqual(before);
    await pool.query(readFileSync("supabase/migrations/20270223001000_academy_rewards.sql", "utf8"));
    expect((await pool.query("select count(*)::int n from public.academy_challenge_topics")).rows[0].n).toBe(12);
  });
});
