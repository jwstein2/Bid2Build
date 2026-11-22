import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

/**
 * Study bank seed (20270222004000): original flashcards/questions and practice exams. Regulatory items must point at
 * a verified section; learners can read approved items anonymously and track progress only for themselves.
 */
const available = await dbAvailable();
const d = available ? describe : describe.skip;

d("academy study bank", () => {
  let pool: Pool;
  let drop: () => Promise<void>;
  beforeAll(async () => { ({ pool, drop } = await freshDb("academy_kb_study_test")); }, 180_000);
  afterAll(async () => { await drop?.(); });

  it("seeds approved items and published exams", async () => {
    const r = (await pool.query("select count(*)::int n, count(*) filter (where kind = 'question')::int q, count(*) filter (where basis = 'regulatory')::int reg from public.academy_kb_items where status = 'approved'")).rows[0];
    expect(r.n).toBeGreaterThanOrEqual(200);
    expect(r.q).toBeGreaterThanOrEqual(150);
    expect(r.reg).toBeGreaterThan(100);
    const e = (await pool.query("select count(*)::int n, count(*) filter (where book_policy = 'unverified')::int unverified from public.academy_kb_exams where status = 'published'")).rows[0];
    expect(e.n).toBe(6);
    expect(e.unverified).toBe(6);
  });

  it("ties every regulatory item to a verified section with a citation", async () => {
    const r = (await pool.query(`select count(*)::int n from public.academy_kb_items i left join public.academy_kb_sections s on s.id = i.section_id
      where i.basis = 'regulatory' and (s.id is null or s.status <> 'verified' or coalesce(i.citation, '') = '')`)).rows[0];
    expect(r.n).toBe(0);
  });

  it("has enough questions for every exam's default length", async () => {
    const r = (await pool.query(`select e.slug, e.default_count, (select count(*) from public.academy_kb_items i where i.kind = 'question' and i.status = 'approved' and i.deck = any (e.decks)
      and (i.state_code is null or i.state_code = e.state_code))::int pool from public.academy_kb_exams e`)).rows;
    for (const row of r) expect(row.pool, row.slug).toBeGreaterThanOrEqual(row.default_count);
  });

  it("is safe to re-run", async () => {
    const before = (await pool.query("select (select count(*) from public.academy_kb_items)::int i, (select count(*) from public.academy_kb_exams)::int e")).rows[0];
    await pool.query(readFileSync("supabase/migrations/20270222004000_academy_kb_study_seed.sql", "utf8"));
    const after = (await pool.query("select (select count(*) from public.academy_kb_items)::int i, (select count(*) from public.academy_kb_exams)::int e")).rows[0];
    expect(after).toEqual(before);
  });

  it("scores a five-question quiz and a fifty-question exam for the signed-in learner only", async () => {
    const uid = await createUser(pool, "study-learner@example.test");
    const other = await createUser(pool, "study-other@example.test");
    const qs = (await pool.query("select id, correct from public.academy_kb_items where kind = 'question' and status = 'approved' order by sort_order limit 50")).rows;
    const five = qs.slice(0, 5);
    const res = await asUser(pool, uid, async (q) => {
      const id = (await q("select public.academy_kb_start('quiz', $1::uuid[], '{}'::jsonb, null, null) id", [five.map((x) => x.id)])).rows[0].id;
      const answers = Object.fromEntries(five.map((x, i) => [x.id, i < 3 ? x.correct : (x.correct + 1) % 2]));
      const saved = (await q("select public.academy_kb_save($1, $2::jsonb, 5, true) r", [id, JSON.stringify(answers)])).rows[0].r;
      const examId = (await q("select public.academy_kb_start('exam', $1::uuid[], '{}'::jsonb, 'general-contractor-knowledge-practice', 5400) id", [qs.map((x) => x.id)])).rows[0].id;
      const all = Object.fromEntries(qs.map((x) => [x.id, x.correct]));
      const exam = (await q("select public.academy_kb_save($1, $2::jsonb, 50, true) r", [examId, JSON.stringify(all)])).rows[0].r;
      await q("select public.academy_kb_answer($1, false)", [five[0].id]);
      return { saved, exam };
    });
    expect(res.saved).toMatchObject({ correct: 3, total: 5, finished: true });
    expect(res.exam).toMatchObject({ correct: 50, total: 50, finished: true });
    const seen = await asUser(pool, other, async (q) => (await q("select count(*)::int n from public.academy_kb_attempts")).rows[0].n);
    expect(seen).toBe(0);
    const mine = await asUser(pool, uid, async (q) => (await q("select count(*)::int n from public.academy_kb_item_progress where last_correct = false")).rows[0].n);
    expect(mine).toBe(1);
  });
});
