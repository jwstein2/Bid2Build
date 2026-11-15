import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
let admin: string;
let n = 0;

async function opp(extra: Record<string, unknown> = {}) {
  n++;
  const hash = n.toString(16).padStart(64, "0");
  const { rows } = await pool.query(
    `insert into public.radar_opportunities (source_key, canonical_url, url_hash, platform_thread_id, title, priority, score, status)
     values ($1, $2, $3, $4, $5, $6, $7, coalesce($8, 'new')) returning id`,
    [extra.source_key ?? "reddit", `https://reddit.com/r/contractor/comments/x${n}`, hash, `t3_x${n}`, "What estimating software do you use?", "A", 90, extra.status ?? null],
  );
  return rows[0].id as string;
}
const draft = (id: string, reply: number) => pool.query("insert into public.radar_drafts (opportunity_id, reply_number, body, engine) values ($1, $2, 'Reply text here', 'rules') returning id", [id, reply]).then((r) => r.rows[0].id as string);
const approve = (draftId: string) => pool.query("update public.radar_drafts set status = 'approved', approved_by = $2, approved_at = now() where id = $1", [draftId, admin]);
const posted = (draftId: string) => pool.query("update public.radar_drafts set status = 'posted_manual' where id = $1", [draftId]);
const state = async (id: string) => (await pool.query("select status, owner_replies_used, reopened from public.radar_opportunities where id = $1", [id])).rows[0];

d("Opportunity Radar schema: access, dedupe and the two-reply cap", () => {
  let alice: string;
  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_radar"));
    alice = await createUser(pool, "alice@test.dev");
    admin = await createUser(pool, "owner@test.dev");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [admin]);
  });
  afterAll(async () => { await drop?.(); });

  it("1. end users (even signed in) cannot read or write any radar table or function", async () => {
    await opp();
    for (const t of ["radar_opportunities", "radar_drafts", "radar_source_state", "radar_usage", "radar_settings"]) {
      await expect(asUser(pool, alice, (q) => q(`select * from public.${t}`))).rejects.toThrow(/permission denied/);
    }
    await expect(asUser(pool, alice, (q) => q("select public.radar_purge_content(1)"))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, admin, (q) => q("select * from public.radar_opportunities"))).rejects.toThrow(/permission denied/); // admins go through the server, never direct
  });

  it("4. duplicate discussions are rejected by canonical URL hash and by platform thread id", async () => {
    await expect(pool.query("insert into public.radar_opportunities (source_key, canonical_url, url_hash, title, priority, score) values ('reddit', 'https://reddit.com/a', $1, 't', 'A', 1)", ["1".padStart(64, "0")])).rejects.toThrow(/duplicate key/);
    await expect(pool.query("insert into public.radar_opportunities (source_key, canonical_url, url_hash, platform_thread_id, title, priority, score) values ('reddit', 'https://reddit.com/b', $1, 't3_x1', 't', 'A', 1)", ["f".padStart(64, "f")])).rejects.toThrow(/duplicate key/);
  });

  it("9 + 11 + 12. replies count only after approval and posting; the cap closes the conversation", async () => {
    const id = await opp();
    const d1 = await draft(id, 1);
    expect((await state(id)).status).toBe("awaiting_review");
    await expect(posted(d1)).rejects.toThrow(/bad_transition|approval_required/); // cannot post an unapproved draft
    await expect(pool.query("update public.radar_drafts set status = 'approved' where id = $1", [d1])).rejects.toThrow(/approval_required/);
    await approve(d1);
    expect((await state(id)).status).toBe("approved");
    await expect(draft(id, 2)).rejects.toThrow(/live_uq|duplicate key|reply_order/);
    await posted(d1);
    expect(await state(id)).toMatchObject({ status: "active", owner_replies_used: 1 });
    await expect(pool.query("update public.radar_drafts set body = 'changed' where id = $1", [d1])).rejects.toThrow(/immutable/);
    await expect(pool.query("delete from public.radar_drafts where id = $1", [d1])).rejects.toThrow(/immutable/);
    await pool.query("update public.radar_drafts set follow_up_text = null where id = $1", [d1]); // clearing third-party text is allowed

    await expect(draft(id, 1)).rejects.toThrow(/reply_order/);
    const d2 = await draft(id, 2);
    expect((await state(id)).status).toBe("followup_pending");
    await approve(d2);
    await posted(d2);
    expect(await state(id)).toMatchObject({ status: "completed", owner_replies_used: 2 });
    await expect(draft(id, 3)).rejects.toThrow(/reply_cap/);
  });

  it("9. API publishing is only 'published' with a platform confirmation id", async () => {
    const id = await opp();
    const d1 = await draft(id, 1);
    await approve(d1);
    await pool.query("update public.radar_drafts set status = 'publish_pending' where id = $1", [d1]);
    expect((await state(id)).owner_replies_used).toBe(0);
    await expect(pool.query("update public.radar_drafts set status = 'published' where id = $1", [d1])).rejects.toThrow(/unconfirmed/);
    await pool.query("update public.radar_drafts set status = 'published', platform_reply_id = 'abc123' where id = $1", [d1]);
    expect(await state(id)).toMatchObject({ status: "active", owner_replies_used: 1 });
  });

  it("13. the owner can reopen a completed conversation for exactly one more reply", async () => {
    const id = await opp();
    for (const r of [1, 2]) { const x = await draft(id, r); await approve(x); await posted(x); }
    await expect(pool.query("select public.radar_reopen($1, '')", [id])).rejects.toThrow(/reason_required/);
    await pool.query("select public.radar_reopen($1, 'Customer asked a billing question')", [id]);
    expect(await state(id)).toMatchObject({ status: "completed", reopened: true });
    const x = await draft(id, 3);
    await approve(x); await posted(x);
    expect(await state(id)).toMatchObject({ status: "completed", owner_replies_used: 3, reopened: false });
    await expect(draft(id, 4)).rejects.toThrow(/reply_cap/);
    await expect(pool.query("select public.radar_reopen($1, 'x')", [await opp()])).rejects.toThrow(/reason_required|bad_transition/);
  });

  it("rejected and archived discussions cannot get drafts; rejecting a draft restores the prior state", async () => {
    const a = await opp({ status: "archived" });
    await expect(draft(a, 1)).rejects.toThrow(/radar_closed/);
    const id = await opp();
    const d1 = await draft(id, 1);
    await pool.query("update public.radar_drafts set status = 'rejected' where id = $1", [d1]);
    expect((await state(id)).status).toBe("new");
  });

  it("retention purge clears stored text on old closed discussions but keeps the link", async () => {
    const id = await opp({ status: "archived" });
    await pool.query("update public.radar_opportunities set excerpt = 'old text', updated_at = now() - interval '200 days' where id = $1", [id]);
    await pool.query("alter table public.radar_opportunities disable trigger radar_opportunities_updated");
    await pool.query("update public.radar_opportunities set updated_at = now() - interval '200 days' where id = $1", [id]);
    await pool.query("alter table public.radar_opportunities enable trigger radar_opportunities_updated");
    expect((await pool.query("select public.radar_purge_content(90) as n")).rows[0].n).toBeGreaterThanOrEqual(1);
    const { rows } = await pool.query("select excerpt, canonical_url from public.radar_opportunities where id = $1", [id]);
    expect(rows[0].excerpt).toBeNull();
    expect(rows[0].canonical_url).toMatch(/^https:/);
  });

  it("19. the migration touches no subscription, credit or lead data", async () => {
    const { rows } = await pool.query("select count(*)::int as n from information_schema.triggers where event_object_table in ('subscriptions', 'credit_ledger', 'leads', 'profiles') and action_statement ilike '%radar%'");
    expect(rows[0].n).toBe(0);
  });
});
