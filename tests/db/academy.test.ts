import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb, type Row } from "./harness";

/**
 * Contractor Academy through the real migrations: RLS and grants, membership, privacy masking in the directory,
 * point rules (no self-likes, new-account rule, per-pair cap, un-like withdraws), premium categories, lesson access,
 * role rules for moderation, the licence guard and lesson progress.
 */
const available = await dbAvailable();
const d = available ? describe : describe.skip;

d("contractor academy", () => {
  let pool: Pool;
  let drop: () => Promise<void>;
  let alice: string, bob: string, carol: string, mod: string, admin: string, outsider: string;

  async function asAnon<T>(fn: (q: (sql: string, p?: unknown[]) => Promise<{ rows: Row[] }>) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query("begin; set local role anon");
      return await fn((sql, p) => c.query(sql, p) as Promise<{ rows: Row[] }>);
    } finally { await c.query("rollback").catch(() => {}); c.release(); }
  }
  const join = (uid: string, extra: Record<string, unknown> = {}) =>
    asUser(pool, uid, (q) => q("select public.academy_join($1::jsonb) as me", [JSON.stringify({ accept_rules: true, display_name: `M ${uid.slice(0, 4)}`, trades: ["roofing"], ...extra })]));
  const post = (uid: string, title: string, category = "general") =>
    asUser(pool, uid, async (q) => (await q("select public.academy_create_post($1::jsonb) as id", [JSON.stringify({ category_slug: category, title, body: "Details about the job.", kind: "question" })])).rows[0].id as string);
  const points = async (uid: string) => Number((await pool.query("select coalesce(sum(points), 0) as p from public.academy_point_events where user_id = $1", [uid])).rows[0].p);
  const age = (uid: string) => pool.query("update public.academy_members set joined_at = now() - interval '3 days' where user_id = $1", [uid]);

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("academy_test"));
    [alice, bob, carol, mod, admin, outsider] = await Promise.all(["alice", "bob", "carol", "mod", "admin", "outsider"].map((n) => createUser(pool, `${n}@example.test`)));
    for (const u of [alice, bob, carol, mod]) await join(u);
    await join(admin);
    await pool.query("update public.academy_members set role = 'moderator' where user_id = $1", [mod]);
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [admin]);
  }, 120_000);
  afterAll(async () => { await drop?.(); });

  it("seeds the catalog: 38 trades, Sales Academy published with 12 lessons, the rest upcoming", async () => {
    const r = (await pool.query(`select (select count(*) from public.academy_trades) t, (select count(*) from public.academy_courses where status = 'published') pub,
      (select count(*) from public.academy_courses where status = 'upcoming') up,
      (select count(*) from public.academy_lessons l join public.academy_courses c on c.id = l.course_id where c.slug = 'contractor-sales-academy') sales`)).rows[0];
    expect(Number(r.t)).toBe(38);
    expect(Number(r.pub)).toBeGreaterThanOrEqual(7);
    expect(Number(r.up)).toBeGreaterThan(250);
    expect(Number(r.sales)).toBe(12);
  });

  it("anonymous visitors see published/upcoming courses and aggregate stats only", async () => {
    await pool.query("update public.academy_courses set status = 'draft' where slug = (select slug from public.academy_courses where status = 'upcoming' order by slug limit 1)");
    await asAnon(async (q) => {
      expect((await q("select count(*) n from public.academy_courses where status = 'draft'")).rows[0].n).toBe("0");
      const s = (await q("select public.academy_stats() s")).rows[0].s;
      expect(s.members).toBe(5);
      expect(s.online_window_minutes).toBe(5);
      await expect(q("select * from public.academy_members")).rejects.toThrow(/permission denied/);
    });
    await asAnon(async (q) => { await expect(q("select * from public.academy_posts")).rejects.toThrow(/permission denied/); });
  });

  it("non-members can't read the community and joining requires accepting the rules", async () => {
    await expect(asUser(pool, outsider, (q) => q("select * from public.academy_feed()"))).rejects.toThrow(/not_member/);
    await expect(asUser(pool, outsider, (q) => q("select * from public.academy_directory()"))).rejects.toThrow(/not_member/);
    await expect(asUser(pool, outsider, (q) => q("select public.academy_join('{\"display_name\":\"X\"}'::jsonb)"))).rejects.toThrow(/rules_required/);
    const rows = await asUser(pool, outsider, async (q) => (await q("select count(*) n from public.academy_members")).rows[0].n);
    expect(rows).toBe("0");
  });

  it("clients can't write community tables directly; posts go through the RPC", async () => {
    await expect(asUser(pool, alice, (q) => q("insert into public.academy_posts (author_id, category_slug, title, body) values ($1, 'general', 'Hello there', 'x')", [alice]))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, alice, (q) => q("update public.academy_members set role = 'admin' where user_id = $1", [alice]))).rejects.toThrow(/permission denied/);
    const id = await post(alice, "How do you price tear-offs?");
    const feed = await asUser(pool, bob, async (q) => (await q("select id, author_name, title from public.academy_feed()")).rows);
    expect(feed.map((r) => r.id)).toContain(id);
    // RLS: other members can't read the raw posts table (only the masked feed).
    expect(await asUser(pool, bob, async (q) => (await q("select count(*) n from public.academy_posts where id = $1", [id])).rows[0].n)).toBe("0");
  });

  it("points: no self-likes, no points from new accounts, un-like withdraws, per-pair daily cap", async () => {
    const p1 = await post(alice, "Question one about gutters");
    await expect(asUser(pool, alice, (q) => q("select public.academy_react('post', $1, true)", [p1]))).rejects.toThrow(/own_content/);
    await asUser(pool, bob, (q) => q("select public.academy_react('post', $1, true)", [p1]));
    expect(await points(alice)).toBe(0); // bob joined < 24h ago
    await asUser(pool, bob, (q) => q("select public.academy_react('post', $1, false)", [p1]));
    await age(bob);
    await asUser(pool, bob, (q) => q("select public.academy_react('post', $1, true)", [p1]));
    expect(await points(alice)).toBe(1);
    await asUser(pool, bob, (q) => q("select public.academy_react('post', $1, false)", [p1]));
    expect(await points(alice)).toBe(0);
    await pool.query("delete from public.academy_posts where author_id = $1", [alice]);
    await pool.query("update public.academy_settings set pair_daily_cap = 3");
    const ids: string[] = [];
    // academy_create_post allows 5/hour; four posts stay under the limit.
    for (let i = 0; i < 4; i++) ids.push(await post(alice, `Pair cap post ${i}`));
    for (const id of ids) await asUser(pool, bob, (q) => q("select public.academy_react('post', $1, true)", [id]));
    expect(await points(alice)).toBe(3);
  });

  it("helpful answers: only the post author marks them, +5 points and a badge", async () => {
    await age(carol);
    const pid = await post(bob, "Best way to follow up?");
    const cid = await asUser(pool, carol, async (q) => (await q("select public.academy_comment($1, 'Call within 48 hours, then text.') id", [pid])).rows[0].id);
    await expect(asUser(pool, alice, (q) => q("select public.academy_mark_helpful($1, true)", [cid]))).rejects.toThrow(/forbidden|not_allowed/);
    const before = await points(carol);
    await asUser(pool, bob, (q) => q("select public.academy_mark_helpful($1, true)", [cid]));
    expect(await points(carol)).toBe(before + 5);
    expect((await pool.query("select count(*) n from public.academy_badges where user_id = $1 and badge = 'helpful-answer'", [carol])).rows[0].n).toBe("1");
  });

  it("directory masks company and hides members who opt out; leaderboard respects opt-out", async () => {
    await asUser(pool, alice, (q) => q("select public.academy_update_profile($1::jsonb)", [JSON.stringify({ company_name: "Alice Roofing LLC", show_company: false, state_code: "MN", show_location: true })]));
    let rows = await asUser(pool, bob, async (q) => (await q("select user_id, company_name, state_code from public.academy_directory()")).rows);
    const a = rows.find((r) => r.user_id === alice)!;
    expect(a.company_name).toBeNull();
    expect(a.state_code).toBe("MN");
    await asUser(pool, alice, (q) => q("select public.academy_update_profile($1::jsonb)", [JSON.stringify({ show_company: true, directory_visible: false, leaderboard_visible: false })]));
    rows = await asUser(pool, bob, async (q) => (await q("select user_id from public.academy_directory()")).rows);
    expect(rows.map((r) => r.user_id)).not.toContain(alice);
    await expect(asUser(pool, bob, (q) => q("select public.academy_profile($1)", [alice]))).rejects.toThrow(/not_found/);
    const lb = await asUser(pool, bob, async (q) => (await q("select user_id from public.academy_leaderboard('all')")).rows);
    expect(lb.map((r) => r.user_id)).not.toContain(alice);
    expect(lb.map((r) => r.user_id)).toContain(carol);
  });

  it("premium categories need premium; staff can post announcements, members can't", async () => {
    await expect(post(bob, "Premium roundtable post", "premium-roundtable")).rejects.toThrow(/premium|forbidden|bad_category/);
    await pool.query("update public.academy_members set tier = 'premium' where user_id = $1", [bob]);
    await expect(post(bob, "Premium roundtable post", "premium-roundtable")).resolves.toBeTruthy();
    await expect(post(carol, "Announcement attempt", "announcements")).rejects.toThrow(/staff_only|forbidden/);
    await expect(post(mod, "Welcome to the Academy", "announcements")).resolves.toBeTruthy();
  });

  it("lesson bodies follow access: public to anyone, member lessons to members only", async () => {
    const q0 = `select l.slug, l.access from public.academy_lessons l join public.academy_courses c on c.id = l.course_id where c.slug = 'contractor-sales-academy'`;
    const anon = await asAnon(async (q) => (await q(q0)).rows);
    expect(anon.length).toBe(3);
    expect(anon.every((r) => r.access === "public")).toBe(true);
    expect((await asUser(pool, outsider, async (q) => (await q(q0)).rows)).length).toBe(3);
    expect((await asUser(pool, carol, async (q) => (await q(q0)).rows)).length).toBe(12);
    // The outline lists every lesson title but flags member lessons as locked for visitors.
    const outline = await asAnon(async (q) => (await q("select slug, locked from public.academy_course_outline((select id from public.academy_courses where slug = 'contractor-sales-academy'))")).rows);
    expect(outline.length).toBe(12);
    expect(outline.filter((o) => o.locked).length).toBe(9);
  });

  it("moderation roles: moderators suspend, only admins ban or change roles, nobody changes themselves", async () => {
    await expect(asUser(pool, carol, (q) => q("select public.academy_set_member($1, '{\"status\":\"suspended\"}'::jsonb)", [bob]))).rejects.toThrow(/forbidden/);
    await asUser(pool, mod, (q) => q("select public.academy_set_member($1, '{\"status\":\"suspended\"}'::jsonb)", [carol]));
    await expect(asUser(pool, carol, (q) => q("select public.academy_comment((select id from public.academy_posts limit 1), 'hi')"))).rejects.toThrow(/suspended/);
    await expect(asUser(pool, mod, (q) => q("select public.academy_set_member($1, '{\"status\":\"banned\"}'::jsonb)", [carol]))).rejects.toThrow(/admin_only/);
    await expect(asUser(pool, mod, (q) => q("select public.academy_set_member($1, '{\"role\":\"admin\"}'::jsonb)", [mod]))).rejects.toThrow(/cannot_change_self/);
    await asUser(pool, admin, (q) => q("select public.academy_set_member($1, '{\"status\":\"banned\"}'::jsonb)", [carol]));
    await expect(join(carol)).rejects.toThrow(/banned/);
    const log = (await pool.query("select action from public.academy_audit_log where target_id = $1 order by id", [carol])).rows.map((r) => r.action);
    expect(log.filter((a) => a === "member.update").length).toBe(2);
  });

  it("Enterprise company admins get no Academy role automatically", async () => {
    await pool.query("select public.create_company($1, 'Outsider Builders') as id", [outsider]);
    const me = await asUser(pool, outsider, async (q) => (await q("select public.academy_me() me")).rows[0].me);
    expect(me.member ?? false).toBe(false);
    expect(me.role ?? null).toBeNull();
  });

  it("a resource can be marked licensed only with an active, unexpired licence", async () => {
    const r = (await pool.query("select id from public.academy_resources limit 1")).rows[0].id;
    await expect(pool.query("update public.academy_resources set permission_status = 'licensed' where id = $1", [r])).rejects.toThrow(/license_required/);
    const lic = (await pool.query(`insert into public.academy_creator_licenses (creator_name, permission_date, authorized_content, permitted_uses, expires_at)
      values ('Test Creator', current_date, 'One video', 'Embed with credit', current_date - 1) returning id`)).rows[0].id;
    await expect(pool.query("update public.academy_resources set permission_status = 'licensed', license_id = $2 where id = $1", [r, lic])).rejects.toThrow(/license_required/);
    await pool.query("update public.academy_creator_licenses set expires_at = current_date + 30 where id = $1", [lic]);
    await pool.query("update public.academy_resources set permission_status = 'licensed', license_id = $2 where id = $1", [r, lic]);
    await pool.query("update public.academy_resources set permission_status = 'link_only', license_id = null where id = $1", [r]);
  });

  it("lesson completion records progress and finishing a course awards a badge", async () => {
    const course = (await pool.query("select id, slug from public.academy_courses where slug = 'roofing-sales'")).rows[0];
    expect(course).toBeTruthy();
    const lessons = (await pool.query("select id from public.academy_lessons where course_id = $1", [course.id])).rows;
    for (const l of lessons) await asUser(pool, alice, (q) => q("select public.academy_complete_lesson($1, true, null)", [l.id]));
    const prog = await asUser(pool, alice, async (q) => (await q("select * from public.academy_my_progress()")).rows);
    const row = prog.find((p) => p.course_id === course.id)!;
    expect(Number(row.completed)).toBe(Number(row.total));
    expect((await pool.query("select count(*) n from public.academy_badges where user_id = $1 and badge = $2", [alice, `course:${course.slug}`])).rows[0].n).toBe("1");
    await expect(asUser(pool, outsider, (q) => q("select public.academy_complete_lesson($1, true, null)", [lessons[0].id]))).rejects.toThrow(/not_member/);
  });
  it("presence: touch stamps only the caller with the server clock, distinct members, 5-minute window, admins count", async () => {
    const stats = async () => (await pool.query("select public.academy_stats() s")).rows[0].s;
    await pool.query("update public.academy_members set last_seen_at = null");
    expect((await stats()).online).toBe(0);
    // Member opens the Academy (bob is still an active member at this point in the suite).
    await asUser(pool, bob, (q) => q("select public.academy_touch()"));
    expect((await stats()).online).toBe(1);
    // Second tab / repeated beat: still one, and throttled (no rewrite inside a minute).
    const first = (await pool.query("select last_seen_at from public.academy_members where user_id = $1", [bob])).rows[0].last_seen_at;
    await asUser(pool, bob, (q) => q("select public.academy_touch()"));
    expect((await pool.query("select last_seen_at from public.academy_members where user_id = $1", [bob])).rows[0].last_seen_at).toEqual(first);
    expect((await stats()).online).toBe(1);
    // A platform admin who joined counts as online and as an admin.
    await asUser(pool, admin, (q) => q("select public.academy_touch()"));
    const s = await stats();
    expect(s.online).toBe(2);
    expect(s.admins).toBeGreaterThanOrEqual(1);
    // Older than the window: offline. Inside it: online.
    await pool.query("update public.academy_members set last_seen_at = now() - interval '6 minutes' where user_id = $1", [bob]);
    expect((await stats()).online).toBe(1);
    await asUser(pool, bob, (q) => q("select public.academy_touch()"));
    expect((await stats()).online).toBe(2);
    // Non-members can't register presence, and nobody can write last_seen_at directly (no forging others).
    await asUser(pool, outsider, (q) => q("select public.academy_touch()"));
    expect((await pool.query("select count(*) n from public.academy_members where user_id = $1", [outsider])).rows[0].n).toBe("0");
    await expect(asUser(pool, bob, (q) => q("update public.academy_members set last_seen_at = now() where user_id = $1", [alice]))).rejects.toThrow(/permission denied/);
    await asAnon(async (q) => { await expect(q("select public.academy_touch()")).rejects.toThrow(/permission denied/); });
    expect((await stats()).online).toBe(2);
  });
});
