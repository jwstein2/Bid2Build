import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb, type Row } from "./harness";
import { pickAnswer } from "@/lib/academy/kb/answer";
import type { KbResult } from "@/lib/academy/kb/types";

/**
 * Academy knowledge engine (20270220001000 + seed 20270220002000): jurisdiction-aware search, documented applicability,
 * verified-only guard, usage-rights guard, invalidation of dependent study content, learner RPCs, RLS and rollback.
 * Numbers in test names refer to the Academy-specific tests in the implementation spec.
 */
const available = await dbAvailable();
const d = available ? describe : describe.skip;

d("academy knowledge engine", () => {
  let pool: Pool;
  let drop: () => Promise<void>;
  let admin: string;
  let learner: string;
  beforeAll(async () => {
    ({ pool, drop } = await freshDb("academy_kb_test"));
    admin = await createUser(pool, "kb-admin@example.com");
    learner = await createUser(pool, "kb-learner@example.com");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [admin]);
  }, 180_000);
  afterAll(async () => { await drop?.(); });

  const search = async (q: string | null, state: string | null, trades: string[] | null = null, opts: { local?: string; section?: string; history?: boolean } = {}) =>
    (await pool.query("select * from public.academy_kb_search($1, $2, $3, $4, null, null, $5, $6, 30)", [q, state, opts.local ?? null, trades, opts.section ?? null, opts.history ?? false])).rows as Row[];
  const anon = async (sql: string, params: unknown[] = []) => {
    const c = await pool.connect();
    try { await c.query("begin; set local role anon"); return (await c.query(sql, params)).rows as Row[]; } finally { await c.query("rollback").catch(() => {}); c.release(); }
  };

  it("seeds 50 states + DC + federal, with coverage marked honestly", async () => {
    const r = (await pool.query("select level, coverage, count(*)::int n from public.academy_kb_jurisdictions group by 1, 2 order by 1, 2")).rows;
    const states = r.filter((x) => x.level === "state").reduce((a, x) => a + x.n, 0);
    expect(states).toBe(51);
    expect(r.find((x) => x.level === "state" && x.coverage === "verified")).toBeUndefined();
    expect(r.find((x) => x.level === "state" && x.coverage === "partial")?.n).toBe(1); // Minnesota only
  });

  it("every verified source, adoption and section has a verification record with evidence and an official URL", async () => {
    const missing = await pool.query(`
      select 'source' t, id::text from public.academy_kb_sources s where status = 'verified' and not exists (select 1 from public.academy_kb_verifications v where v.target_type = 'source' and v.target_id = s.id::text and v.result = 'verified' and v.evidence <> '' and v.source_url like 'https://%')
      union all select 'adoption', id::text from public.academy_kb_adoptions a where status = 'verified' and not exists (select 1 from public.academy_kb_verifications v where v.target_type = 'adoption' and v.target_id = a.id::text and v.evidence <> '' and v.source_url like 'https://%')
      union all select 'section', id::text from public.academy_kb_sections s where status = 'verified' and not exists (select 1 from public.academy_kb_verifications v where v.target_type = 'section' and v.target_id = s.id::text and v.evidence <> '' and v.content_hash is not null)`);
    expect(missing.rows).toEqual([]);
  });

  it("1. a Minnesota location gets Minnesota results but never assumes the municipality", async () => {
    const rows = await search("What is the maximum deck stair riser height?", "MN", ["decks"]);
    expect(rows[0].citation).toBe("Minn. R. 1309.0311, subp. 2");
    expect(rows[0].applicability.status).toBe("jurisdiction_confirmation_needed");
    expect(rows[0].applicability.reason).toBe("local_not_selected");
    expect(rows.every((r) => r.applicability.status !== "verified_applicable" || r.source_jurisdiction !== "MN" || r.citation.startsWith("Minn. R. 1315"))).toBe(true);
  });

  it("the page's Quick Answer comes only from verified, applicable, strongly matched sections; otherwise the unverified message", async () => {
    const deck = pickAnswer((await search("deck stair riser height", "MN", ["decks"])) as unknown as KbResult[]);
    expect(deck?.citation).toBe("Minn. R. 1309.0311, subp. 2");
    // No Minnesota plumbing code is on file: keyword matches on OSHA text must not become an answer.
    expect(pickAnswer((await search("plumbing vent pipe size", "MN", ["plumbing"])) as unknown as KbResult[])).toBeNull();
    // Texas has no verified building code adoption: a Minnesota rule must never answer a Texas question.
    const tx = pickAnswer((await search("deck stair riser height", "TX", ["decks"])) as unknown as KbResult[]);
    expect(tx === null || tx.source_jurisdiction !== "MN").toBe(true);
  });

  it("statewide rules without a local step are Verified Applicable (Minnesota Electrical Code)", async () => {
    const rows = await search("What electrical code applies to this installation?", "MN", ["electrical"]);
    const nec = rows.find((r) => r.citation === "Minn. R. 1315.0200, subp. 1a");
    expect(nec?.applicability.status).toBe("verified_applicable");
    expect(nec?.applicability.effective_date).toBe("2026-08-17");
  });

  it("2/3. another state's rules never leak in; a Texas source is found for Texas and the state can be switched", async () => {
    const tx = await search("deck stairs guard", "TX", ["decks"]);
    expect(tx.some((r) => r.source_jurisdiction === "MN")).toBe(false);
    await pool.query(`insert into public.academy_kb_sources (id, family_slug, title, short_title, edition, publisher, jurisdiction_id, rights, rights_note, status)
      values ('00000000-0000-0000-0000-00000000a001', 'mn_rules', 'Test Texas rule', 'Tex. Test', '2026', 'Test', 'TX', 'metadata_only', 'Test source for jurisdiction filtering only.', 'pending_review')`);
    await pool.query(`insert into public.academy_kb_sections (source_id, section_number, citation, title, kind, body_kind, topics, status)
      values ('00000000-0000-0000-0000-00000000a001', '99.1', 'Tex. Test 99.1', 'Texas deck stair test rule', 'title_only', 'title_only', array['deck stairs'], 'pending_review')`);
    expect((await search("deck stairs", "TX")).some((r) => r.citation === "Tex. Test 99.1")).toBe(true);
    expect((await search("deck stairs", "MN")).some((r) => r.citation === "Tex. Test 99.1")).toBe(false);
    const mnApplic = (await pool.query("select public.academy_kb_applicability(id, 'MN') a from public.academy_kb_sections where citation = 'Tex. Test 99.1'")).rows[0].a;
    expect(mnApplic.status).toBe("unavailable");
    await pool.query("delete from public.academy_kb_sources where id = '00000000-0000-0000-0000-00000000a001'");
  });

  it("4. an electrical search does not return roofing-only rules", async () => {
    const rows = await search("flashing shingles roof coverings code", "MN", ["electrical"]);
    expect(rows.some((r) => r.trades.length > 0 && !r.trades.includes("electrical"))).toBe(false);
    expect(rows.some((r) => r.citation.startsWith("Minn. R. 1309.0905"))).toBe(false);
  });

  it("5. a general contractor search spans trades", async () => {
    const rows = await search("roof coverings stairs footings", "MN", ["general-contracting"]);
    const trades = new Set(rows.flatMap((r) => r.trades));
    expect(rows.some((r) => r.citation.startsWith("Minn. R. 1309.0905"))).toBe(true);
    expect(rows.some((r) => r.citation.startsWith("Minn. R. 1309.0311"))).toBe(true);
    expect(trades.size).toBeGreaterThan(3);
  });

  it("6. results carry genuine citations, editions and official links", async () => {
    const rows = await search("trench protection 5 feet", "TX", ["excavation"]);
    const top = rows[0];
    expect(top.citation).toBe("29 CFR 1926.652(a)");
    expect(top.applicability.status).toBe("verified_applicable");
    expect(top.official_url).toMatch(/^https:\/\/www\.ecfr\.gov\/current\/title-29\/section-1926\.652/);
    expect(top.body).toContain("less than 5 feet");
    expect(top.page).toBeNull(); // online regulation: never a made-up page number
    expect(top.edition).toMatch(/^eCFR \d{4}-\d{2}-\d{2}$/);
  });

  it("7. no source means no result, and unverified rows never expose requirement text", async () => {
    expect(await search("quantum flux capacitor setback", "MN")).toEqual([]);
    const irc = (await search(null, "MN", null, { section: "R311.7" })).find((r) => r.citation === "2018 IRC Section R311.7");
    expect(irc?.body).toBeNull();
    expect(irc?.body_kind).toBe("title_only");
    expect(irc?.applicability.status).toBe("source_review_needed");
  });

  it("8. superseded or replaced editions are never presented as current", async () => {
    // MN's 2023 NEC adoption expired Aug 17, 2026: a 2023 NEC row reads as a different edition.
    const nec23 = (await pool.query("select id from public.academy_kb_sources where family_slug = 'nec' and edition = '2023'")).rows[0].id;
    await pool.query(`insert into public.academy_kb_sections (id, source_id, section_number, citation, title, kind, body_kind, topics, status)
      values ('00000000-0000-0000-0000-00000000b023', $1, '210.8', '2023 NEC 210.8', 'GFCI protection test row', 'title_only', 'title_only', array['gfci'], 'pending_review')`, [nec23]);
    const a = (await pool.query("select public.academy_kb_applicability('00000000-0000-0000-0000-00000000b023', 'MN') a")).rows[0].a;
    expect(a.status).toBe("not_adopted");
    expect(a.other_edition).toBe("2026");
    // The same row on 2026-08-01 (before the switch) is the adopted edition again (edition history kept).
    const past = (await pool.query("select public.academy_kb_applicability('00000000-0000-0000-0000-00000000b023', 'MN', null, '2026-08-01') a")).rows[0].a;
    expect(past.status).toBe("source_review_needed"); // title-only row: never 'verified'
    expect(past.reason).toBe("section_not_verified");
    await pool.query("select set_config('academy.kb_verifying', 'on', false)");
    await pool.query("update public.academy_kb_sources set status = 'superseded' where id = $1", [nec23]);
    await pool.query("select set_config('academy.kb_verifying', 'off', false)");
    expect((await search("gfci", "MN")).some((r) => r.citation === "2023 NEC 210.8")).toBe(false);
    expect((await search("gfci", "MN", null, { history: true })).find((r) => r.citation === "2023 NEC 210.8")?.applicability.status).toBe("superseded");
  });

  it("9. local amendments are respected: an IRC section number finds Minnesota's amendment first", async () => {
    const rows = await search(null, "MN", null, { section: "R311.7.1" });
    expect(rows[0].citation).toBe("Minn. R. 1309.0311, subp. 2");
    expect(rows[0].amends_section).toBe("R311.7.1");
    expect(rows[0].amend_action).toBe("replaced");
    expect(rows.some((r) => r.citation === "2018 IRC Section R311.7")).toBe(true);
  });

  it("OSHA rules defer to State Plans", async () => {
    const mn = (await search("fall protection 6 feet", "MN", ["roofing"])).find((r) => r.citation === "29 CFR 1926.501(b)");
    expect(mn?.applicability.status).toBe("source_review_needed");
    expect(mn?.applicability.reason).toBe("state_plan");
    const tx = (await search("fall protection 6 feet", "TX", ["roofing"])).find((r) => r.citation === "29 CFR 1926.501(b)");
    expect(tx?.applicability.status).toBe("verified_applicable");
  });

  it("10. 'verified' can only be set through academy_kb_verify, and only by an admin with evidence", async () => {
    const sec = (await pool.query("select id from public.academy_kb_sections where status = 'pending_review' limit 1")).rows[0].id;
    await expect(pool.query("update public.academy_kb_sections set status = 'verified' where id = $1", [sec])).rejects.toThrow(/verify_via_rpc/);
    await expect(asUser(pool, learner, (q) => q("select public.academy_kb_verify('section', $1, 'manual_review', 'verified')", [sec]))).rejects.toThrow(/admin_only/);
    await expect(asUser(pool, admin, (q) => q("select public.academy_kb_verify('section', $1, 'official_text', 'verified')", [sec]))).rejects.toThrow(/evidence_required/);
    await asUser(pool, admin, (q) => q("select public.academy_kb_verify('section', $1, 'manual_review', 'verified', null, null, null, null, null, 'Checked against the publisher copy')", [sec]));
    expect((await pool.query("select status from public.academy_kb_sections where id = $1", [sec])).rows[0].status).toBe("verified");
    expect((await pool.query("select count(*)::int n from public.academy_kb_verifications where target_id = $1 and method = 'manual_review' and actor_id = $2", [sec, admin])).rows[0].n).toBe(1);
  });

  it("10. learners and anonymous visitors cannot write knowledge tables or upload around the review", async () => {
    await expect(asUser(pool, learner, (q) => q("insert into public.academy_kb_documents (title, kind, url, rights_basis) values ('x doc', 'url', 'https://example.com/a', 'I say so, trust me')"))).rejects.toThrow(/permission denied/);
    await expect(anon("update public.academy_kb_sections set body = 'x'")).rejects.toThrow(/permission denied/);
    await expect(pool.query("insert into public.academy_kb_documents (title, kind, url, rights_basis, status) values ('Unconfirmed doc', 'url', 'https://example.com/b', 'Public domain federal publication', 'approved')")).rejects.toThrow(/rights_unconfirmed/);
    await pool.query("insert into public.academy_kb_documents (title, kind, url, rights_basis, sha256) values ('Doc A', 'url', 'https://example.com/c', 'Public domain federal publication', $1)", ["a".repeat(64)]);
    await expect(pool.query("insert into public.academy_kb_documents (title, kind, url, rights_basis, sha256) values ('Doc A again', 'url', 'https://example.com/d', 'Public domain federal publication', $1)", ["a".repeat(64)])).rejects.toThrow(/duplicate key/);
  });

  it("11. full text cannot be stored for a source whose rights don't allow it", async () => {
    const irc = (await pool.query("select id from public.academy_kb_sources where family_slug = 'irc' and edition = '2018'")).rows[0].id;
    await expect(pool.query("insert into public.academy_kb_sections (source_id, section_number, citation, title, body_kind, body, status) values ($1, 'R311.7.5.1', '2018 IRC R311.7.5.1', 'Risers', 'full_text', 'copied text', 'draft')", [irc])).rejects.toThrow(/rights_fulltext/);
    await expect(pool.query("insert into public.academy_kb_sections (source_id, section_number, citation, title, body_kind, body, status) values ($1, 'R311.7.5.1', '2018 IRC R311.7.5.1', 'Risers', 'excerpt', 'copied text', 'draft')", [irc])).rejects.toThrow(/rights_excerpt/);
  });

  it("anonymous visitors read verified material but not drafts, staff queues or the answer cache", async () => {
    expect((await anon("select count(*)::int n from public.academy_kb_sections where status = 'verified'"))[0].n).toBeGreaterThan(100);
    await pool.query(`insert into public.academy_kb_sections (source_id, section_number, citation, title, body_kind, body, status)
      select id, 'draft-1', 'Draft 1', 'Draft row', 'full_text', 'draft text', 'draft' from public.academy_kb_sources where family_slug = 'osha_construction'`);
    expect((await anon("select count(*)::int n from public.academy_kb_sections where status = 'draft'"))[0].n).toBe(0);
    expect((await anon("select count(*)::int n from public.academy_kb_review_queue"))[0].n).toBe(0);
    await expect(anon("select * from public.academy_kb_answer_cache")).rejects.toThrow(/permission denied/);
    await expect(anon("select public.academy_kb_log_search('x', 'MN', null, false)")).rejects.toThrow(/permission denied/);
    await expect(anon("select public.academy_kb_health()")).rejects.toThrow(/forbidden|permission denied/);
  });

  it("12/13/14. flashcard progress, short quizzes and long exams (only with enough approved questions)", async () => {
    const sec = (await pool.query("select id from public.academy_kb_sections where citation = '29 CFR 1926.652(a)'")).rows[0].id;
    for (let i = 0; i < 50; i++) {
      await pool.query(`insert into public.academy_kb_items (kind, deck, prompt, answer, options, correct, explanation, section_id, citation, basis, status)
        values ('question', 'test-deck', $1, 'B', array['A', 'B', 'C', 'D'], 1, 'Because.', $2, '29 CFR 1926.652(a)', 'regulatory', 'approved')`, [`Test question number ${i}?`, sec]);
    }
    const ids = (await pool.query("select id from public.academy_kb_items where deck = 'test-deck' order by prompt")).rows.map((r) => r.id as string);
    const five = await asUser(pool, learner, async (q) => (await q("select public.academy_kb_start('quiz', $1::uuid[]) id", [ids.slice(0, 5)])).rows[0].id as string);
    const res5 = await asUser(pool, learner, async (q) => (await q("select public.academy_kb_save($1, $2::jsonb, 5, true) r", [five, JSON.stringify(Object.fromEntries(ids.slice(0, 5).map((id, i) => [id, i < 4 ? 1 : 0])))])).rows[0].r);
    expect(res5).toEqual({ correct: 4, total: 5, finished: true });
    const fifty = await asUser(pool, learner, async (q) => (await q("select public.academy_kb_start('exam', $1::uuid[], '{}'::jsonb, null, 3600) id", [ids])).rows[0].id as string);
    const res50 = await asUser(pool, learner, async (q) => (await q("select public.academy_kb_save($1, $2::jsonb, 50, true) r", [fifty, JSON.stringify(Object.fromEntries(ids.map((id) => [id, 1])))])).rows[0].r);
    expect(res50.correct).toBe(50);
    await asUser(pool, learner, (q) => q("select public.academy_kb_answer($1, false)", [ids[0]]));
    await asUser(pool, learner, (q) => q("select public.academy_kb_answer($1, true)", [ids[0]]));
    await asUser(pool, learner, (q) => q("select public.academy_kb_answer($1, true)", [ids[0]]));
    const prog = await asUser(pool, learner, async (q) => (await q("select box, right_count, wrong_count from public.academy_kb_item_progress where item_id = $1", [ids[0]])).rows[0]);
    expect(prog).toEqual({ box: 3, right_count: 2, wrong_count: 1 });
    // Another learner can't read it.
    const other = await createUser(pool, "kb-other@example.com");
    expect(await asUser(pool, other, async (q) => (await q("select count(*)::int n from public.academy_kb_item_progress")).rows[0].n)).toBe(0);
    await expect(asUser(pool, learner, (q) => q("select public.academy_kb_start('quiz', array[gen_random_uuid()])"))).rejects.toThrow(/bad_items/);
  });

  it("18/19. changing a cited section flags dependent cards, invalidates cached answers and leaves other content alone", async () => {
    const courses = (await pool.query("select count(*)::int n, md5(string_agg(id::text || title, ',' order by id)) h from public.academy_courses")).rows[0];
    const sec = (await pool.query("select id from public.academy_kb_sections where citation = '29 CFR 1926.652(a)'")).rows[0].id;
    await pool.query("insert into public.academy_kb_answer_cache (key, question_norm, section_ids, answer) values ($1, 'trench', array[$2::uuid], '{}')", ["b".repeat(64), sec]);
    await pool.query("update public.academy_kb_sections set body = body || ' (test edit)' where id = $1", [sec]);
    expect((await pool.query("select count(*)::int n from public.academy_kb_items where section_id = $1 and needs_review", [sec])).rows[0].n).toBe(50);
    expect((await pool.query("select invalidated_at is not null v from public.academy_kb_answer_cache where key = $1", ["b".repeat(64)])).rows[0].v).toBe(true);
    expect((await pool.query("select count(*)::int n from public.academy_kb_review_queue where kind = 'stale_content' and target_id = $1 and status = 'open'", [sec])).rows[0].n).toBe(1);
    expect((await anon("select count(*)::int n from public.academy_kb_items where deck = 'test-deck'"))[0].n).toBe(0); // hidden while under review
    const after = (await pool.query("select count(*)::int n, md5(string_agg(id::text || title, ',' order by id)) h from public.academy_courses")).rows[0];
    expect(after).toEqual(courses);
    // Search still answers while content is under review.
    expect((await search("trench protection", "TX", ["excavation"])).length).toBeGreaterThan(0);
  });

  it("correction reports: anonymous allowed, deduplicated into one review item, rate limited", async () => {
    const sec = (await pool.query("select id from public.academy_kb_sections where citation = 'Minn. R. 1309.0311, subp. 2'")).rows[0].id;
    await anon("select public.academy_kb_report('section', $1, 'outdated_code', 'Seems old', 'MN')", [sec]);
    await asUser(pool, learner, (q) => q("select public.academy_kb_report('section', $1, 'outdated_code', null, 'MN')", [sec]));
    const items = (await pool.query("select affected from public.academy_kb_review_queue where kind = 'user_feedback' and target_id = $1", [sec])).rows;
    expect(items).toHaveLength(1);
    expect(items[0].affected.reports).toBe(1); // the anon helper rolls its transaction back; the signed-in report is counted
    for (let i = 0; i < 19; i++) await asUser(pool, learner, (q) => q("select public.academy_kb_report('section', $1, 'unclear_explanation')", [sec]));
    await expect(asUser(pool, learner, (q) => q("select public.academy_kb_report('section', $1, 'unclear_explanation')", [sec]))).rejects.toThrow(/rate_limited/);
  });

  it("search trends are stored without identity and scrub contact details", async () => {
    await pool.query("select public.academy_kb_log_search('Deck stairs at 1234 Main St call 507-555-1234 bob@example.com', 'MN', 'decks', false)");
    const r = (await pool.query("select query_norm from public.academy_kb_search_stats")).rows.map((x) => x.query_norm);
    expect(r.join(" ")).not.toMatch(/1234 main|555-1234|bob@example/);
    const cols = (await pool.query("select column_name from information_schema.columns where table_name = 'academy_kb_search_stats'")).rows.map((x) => x.column_name);
    expect(cols).not.toContain("user_id");
  });

  it("six-month review queues every current source once per half-year", async () => {
    const n1 = (await pool.query("select public.academy_kb_queue_semiannual() n")).rows[0].n;
    const n2 = (await pool.query("select public.academy_kb_queue_semiannual() n")).rows[0].n;
    expect(n1).toBeGreaterThan(10);
    expect(n2).toBe(0);
  });

  it("rolls back cleanly without touching the rest of the Academy", async () => {
    const before = (await pool.query("select count(*)::int n from public.academy_courses")).rows[0].n;
    await pool.query(readFileSync(path.join(import.meta.dirname, "../../docs/academy/rollback_20270220001000.sql"), "utf8"));
    expect((await pool.query("select to_regclass('public.academy_kb_sections') r")).rows[0].r).toBeNull();
    expect((await pool.query("select count(*)::int n from public.academy_courses")).rows[0].n).toBe(before);
    expect((await pool.query("select column_name from information_schema.columns where table_name = 'academy_settings' and column_name like 'kb_%'")).rows).toEqual([]);
  });
});
