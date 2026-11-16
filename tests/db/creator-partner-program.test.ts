import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb, type Row } from "./harness";

/**
 * Creator Partner Program: real Postgres with every migration applied. Covers the Part 12 security
 * scenarios: separate tenants, opt-in sharing, revocation, seat reassignment, concurrency, expiry,
 * and that nothing touches Stripe tables or the regular Enterprise company model.
 */
const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;

const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const token = () => randomBytes(32).toString("base64url");
const sqlError = (p: Promise<unknown>) => p.then(() => null, (e: Error) => e.message);
const unlimited = async (u: string) => (await pool.query("select public.has_unlimited($1) as v", [u])).rows[0].v as boolean;
const entitlement = async (u: string) => (await pool.query("select * from public.user_entitlement($1)", [u])).rows[0] as Row;
const stripeCounts = async () => (await pool.query("select (select count(*) from public.subscriptions) s, (select count(*) from public.billing_customers) b")).rows[0];
const subscribe = (u: string) =>
  pool.query("select public.apply_subscription_update($1::uuid, $2, $3, 'active', 'monthly', 'price_m', '2099-01-01'::timestamptz, false, null, null, now())", [u, `cus_${u}`, `sub_${u}`]);
const as = <T = Row>(u: string, sql: string, params: unknown[] = []) => asUser(pool, u, (q) => q(sql, params)).then((r) => r.rows[0] as T);

async function estimate(user: string, title: string, opts: { customer?: string } = {}): Promise<string> {
  const e = (await pool.query(
    `insert into public.estimates (user_id, title, customer_name, customer_email, customer_phone, project_address, customer_notes, location_city, location_state, trades)
     values ($1, $2, $3, 'homeowner@private.test', '555-0100', '12 Secret Lane', 'gate code 1234', 'Tacoma', 'WA', '{deck}') returning id`,
    [user, title, opts.customer ?? "Jane Homeowner"])).rows[0].id;
  const g = (await pool.query("insert into public.estimate_groups (estimate_id, user_id, name) values ($1, $2, 'Framing') returning id", [e, user])).rows[0].id;
  await pool.query("insert into public.estimate_items (estimate_id, group_id, user_id, name, description, quantity, unit, unit_cost, notes) values ($1, $2, $3, 'Joists 2x10', 'Pressure treated', 20, 'each', 18.5, 'supplier: secret')", [e, g, user]);
  await pool.query("insert into public.estimate_items (estimate_id, group_id, user_id, name, quantity, unit_cost, show_on_proposal) values ($1, $2, $3, 'Internal labor buffer', 1, 300, false)", [e, g, user]);
  return e;
}

d("creator partner program (database)", () => {
  let owner: string, creator: string, freeUser: string, payer: string, stranger: string, late: string, unverified: string;
  let program: Row;

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_creator"));
    owner = await createUser(pool, "owner@built2bid.test");
    creator = await createUser(pool, "creator@deckacademy.test");
    freeUser = await createUser(pool, "free@contractor.test");
    payer = await createUser(pool, "payer@contractor.test");
    stranger = await createUser(pool, "stranger@contractor.test");
    late = await createUser(pool, "late@contractor.test");
    unverified = await createUser(pool, "unverified@contractor.test", false);
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [owner]);
    await subscribe(payer);
    // The migrations are idempotent.
    const { readFileSync } = await import("node:fs");
    for (const f of ["20261117001000_creator_partner_program.sql", "20261117002000_creator_outreach_crm.sql"]) {
      await pool.query(readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url), "utf8"));
    }
  });
  afterAll(async () => { await drop?.(); });

  it("customers cannot call owner functions or read program tables", async () => {
    expect(await sqlError(pool.query("select public.admin_creator_program_create($1, 'x@y.test', 'Workspace')", [stranger]))).toBe("forbidden");
    await expect(asUser(pool, stranger, (q) => q("select public.admin_creator_programs($1)", [stranger]))).rejects.toThrow(/permission denied/);
    for (const t of ["creator_programs", "creator_gifts", "mentorship_shares", "mentorship_comments", "creator_prospects", "creator_outreach_messages"]) {
      await expect(asUser(pool, stranger, (q) => q(`select * from public.${t}`))).rejects.toThrow(/permission denied/);
    }
    await expect(asUser(pool, stranger, (q) => q("select public.claim_creator_gift($1, $2)", [stranger, hash("x")]))).rejects.toThrow(/permission denied/);
  });

  it("a program cannot be provisioned until the creator's acceptance of terms is recorded", async () => {
    const before = await stripeCounts();
    program = (await pool.query("select public.admin_creator_program_create($1, 'Creator@DeckAcademy.test', 'Johnson Deck Academy — Built2Bid Learning Team', 'Deck Academy', 'https://www.youtube.com/@deckacademy', 2) as p", [owner])).rows[0].p;
    expect(program.state).toBe("draft");
    expect(await sqlError(pool.query("select public.admin_creator_program_provision($1, $2, $3)", [owner, program.id, hash(token())]))).toBe("terms_not_accepted");
    expect(await sqlError(pool.query("select public.admin_creator_program_record_terms($1, $2, 'v1', 'ok')", [owner, program.id]))).toBe("evidence_required");
    await pool.query("select public.admin_creator_program_record_terms($1, $2, 'v1', 'Written acceptance by email reply on 2026-11-20')", [owner, program.id]);
    const p = (await pool.query("select public.admin_creator_program_provision($1, $2, $3) as p", [owner, program.id, hash(token())])).rows[0].p;
    expect(p.existing_account).toBe(true);
    expect(p.state).toBe("active");
    expect(Math.round((new Date(p.expires_at).getTime() - new Date(p.starts_at).getTime()) / 86_400_000)).toBe(365);
    // The creator's own business gets regular Enterprise through the existing comp path; no Stripe rows.
    const ent = await entitlement(creator);
    expect(ent.tier).toBe("enterprise");
    expect(await stripeCounts()).toEqual(before);
    program = p;
  });

  it("only the creator can use the creator dashboard, and only after confirming terms in-app", async () => {
    expect(await sqlError(as(stranger, "select public.creator_dashboard($1)", [program.id]))).toBe("forbidden");
    expect(await sqlError(as(freeUser, "select public.creator_invite_gift($1, 'a@b.test', null, $2)", [program.id, hash(token())]))).toBe("forbidden");
    expect(await sqlError(as(creator, "select public.creator_invite_gift($1, 'free@contractor.test', null, $2)", [program.id, hash(token())]))).toBe("confirm_terms_first");
    await as(creator, "select public.creator_confirm_terms($1)", [program.id]);
    const dash = (await as(creator, "select public.creator_dashboard($1) as d", [program.id])).d;
    expect(dash.program.gift_allowance).toBe(2);
    expect(dash.gifts).toEqual([]);
  });

  let freeToken = "", freeGift = "";
  it("existing Free user claims a gift: own Unlimited, own company profile, never a member of the creator's company", async () => {
    freeToken = token();
    freeGift = (await as(creator, "select public.creator_invite_gift($1, 'Free@Contractor.test', 'Sam', $2) as g", [program.id, hash(freeToken)])).g.id;
    expect(await unlimited(freeUser)).toBe(false);
    // Wrong account / unverified email / bad token
    expect((await pool.query("select public.claim_creator_gift($1, $2) as r", [stranger, hash(freeToken)])).rows[0].r).toMatchObject({ ok: false, reason: "email_mismatch" });
    expect((await pool.query("select public.claim_creator_gift($1, $2) as r", [unverified, hash(freeToken)])).rows[0].r).toMatchObject({ ok: false, reason: "email_unverified" });
    expect((await pool.query("select public.claim_creator_gift($1, $2) as r", [freeUser, hash("nope")])).rows[0].r).toMatchObject({ ok: false, reason: "invalid" });
    const r = (await pool.query("select public.claim_creator_gift($1, $2) as r", [freeUser, hash(freeToken)])).rows[0].r;
    expect(r).toMatchObject({ ok: true, state: "active" });
    expect(await unlimited(freeUser)).toBe(true);
    expect(await entitlement(freeUser)).toMatchObject({ tier: "unlimited", source: "complimentary", company_id: null });
    const members = (await pool.query("select count(*)::int n from public.company_members where user_id = $1", [freeUser])).rows[0].n;
    expect(members).toBe(0);
    const grant = (await pool.query("select g.expires_at, p.expires_at as program_end from public.complimentary_grants g join public.creator_programs p on p.id = g.creator_program_id where g.creator_gift_id = $1", [freeGift])).rows[0];
    expect(new Date(grant.expires_at).getTime()).toBe(new Date(grant.program_end).getTime());
  });

  it("replaying a used token reveals nothing to anyone else", async () => {
    expect((await pool.query("select public.claim_creator_gift($1, $2) as r", [freeUser, hash(freeToken)])).rows[0].r).toMatchObject({ ok: true, already: true });
    expect((await pool.query("select public.claim_creator_gift($1, $2) as r", [stranger, hash(freeToken)])).rows[0].r).toEqual({ ok: false, reason: "invalid" });
  });

  it("two invitations racing for the final seat: exactly one wins", async () => {
    const results = await Promise.allSettled([
      as(creator, "select public.creator_invite_gift($1, 'race1@contractor.test', null, $2)", [program.id, hash(token())]),
      as(creator, "select public.creator_invite_gift($1, 'race2@contractor.test', null, $2)", [program.id, hash(token())]),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.message).toBe("no_seats");
    expect(await sqlError(as(creator, "select public.creator_invite_gift($1, 'more@contractor.test', null, $2)", [program.id, hash(token())]))).toBe("no_seats");
  });

  it("the owner can raise the allowance; an existing paid Unlimited customer keeps billing untouched", async () => {
    await pool.query("select public.admin_creator_program_set_allowance($1, $2, 5)", [owner, program.id]);
    expect(await sqlError(pool.query("select public.admin_creator_program_set_allowance($1, $2, 1)", [owner, program.id]))).toBe("below_used");
    const before = (await pool.query("select * from public.subscriptions where user_id = $1", [payer])).rows;
    const t = token();
    await as(creator, "select public.creator_invite_gift($1, 'payer@contractor.test', null, $2)", [program.id, hash(t)]);
    expect((await pool.query("select public.claim_creator_gift($1, $2) as r", [payer, hash(t)])).rows[0].r.ok).toBe(true);
    expect((await pool.query("select * from public.subscriptions where user_id = $1", [payer])).rows).toEqual(before);
    expect((await pool.query("select had_paid_subscription from public.complimentary_grants where user_id = $1", [payer])).rows[0].had_paid_subscription).toBe(true);
  });

  let shareId = "";
  let privateEstimate = "", sharedEstimate = "";
  it("the creator sees no bids by default, and cannot read participant data directly", async () => {
    privateEstimate = await estimate(freeUser, "Smith backyard deck");
    sharedEstimate = await estimate(freeUser, "Jones deck rebuild", { customer: "Bob Jones" });
    expect((await as(creator, "select public.creator_shares($1) as s", [program.id])).s).toEqual([]);
    const rls = await asUser(pool, creator, (q) => q("select id from public.estimates where user_id = $1", [freeUser]));
    expect(rls.rowCount).toBe(0);
    const items = await asUser(pool, creator, (q) => q("select id from public.estimate_items where user_id = $1", [freeUser]));
    expect(items.rowCount).toBe(0);
  });

  it("a participant can only share their own estimate", async () => {
    const payerEstimate = await estimate(payer, "Payer bid");
    expect(await sqlError(as(freeUser, "select public.share_estimate_for_mentorship($1, $2, false, false, false, '{}')", [program.id, payerEstimate]))).toBe("forbidden");
    expect(await sqlError(as(stranger, "select public.share_estimate_for_mentorship($1, $2, false, false, false, '{}')", [program.id, sharedEstimate]))).toBe("forbidden");
  });

  it("sharing one proposal exposes scope only: no customer details, no costs, no markup", async () => {
    shareId = (await as(freeUser, "select public.share_estimate_for_mentorship($1, $2, false, false, false, $3) as id", [program.id, sharedEstimate, { total: "1234.50", evil: "x".repeat(50) }])).id;
    const list = (await as(creator, "select public.creator_shares($1) as s", [program.id])).s;
    expect(list).toHaveLength(1);
    expect(list[0].title).toBeNull(); // project info not shared
    const v = (await as(creator, "select public.mentorship_share_view($1) as v", [shareId])).v;
    const text = JSON.stringify(v);
    for (const secret of ["Bob Jones", "homeowner@private.test", "555-0100", "12 Secret Lane", "gate code", "supplier: secret", "Internal labor buffer", "18.5", "Jones deck"]) {
      expect(text).not.toContain(secret);
    }
    expect(v.sections[0].items[0]).toMatchObject({ name: "Joists 2x10", description: "Pressure treated" });
    expect(v.sections[0].items[0].unit_cost).toBeUndefined();
    expect(v.pricing).toBeNull();
    expect(v.totals).toEqual({ total: "1234.50" });
    // The private estimate is still invisible.
    expect(JSON.stringify(await as(creator, "select public.creator_shares($1) as s", [program.id]))).not.toContain(privateEstimate);
  });

  it("sharing costs does not share markup or the pipeline", async () => {
    await as(freeUser, "select public.share_estimate_for_mentorship($1, $2, true, false, false, '{}')", [program.id, sharedEstimate]);
    const v = (await as(creator, "select public.mentorship_share_view($1) as v", [shareId])).v;
    expect(v.sections[0].items.map((i: Row) => i.name)).toContain("Internal labor buffer");
    expect(Number(v.sections[0].items[0].unit_cost)).toBe(18.5);
    expect(v.pricing).toBeNull();
    expect(JSON.stringify(v)).not.toContain("Bob Jones");
    expect(await sqlError(as(creator, "select public.creator_pipeline_summary($1, $2)", [program.id, freeGift]))).toBe("not_shared");
  });

  it("comments and suggestions each need their own opt-in; suggestions never edit the estimate", async () => {
    expect(await sqlError(as(creator, "select public.mentorship_add_comment($1, 'comment', 'Nice')", [shareId]))).toBe("comments_off");
    await as(freeUser, "select public.set_mentorship_consent($1, true, false, true)", [program.id]);
    await as(creator, "select public.mentorship_add_comment($1, 'comment', 'Check your joist spacing')", [shareId]);
    expect(await sqlError(as(creator, "select public.mentorship_add_comment($1, 'suggestion', 'Use 12 in OC')", [shareId]))).toBe("suggestions_off");
    await as(freeUser, "select public.set_mentorship_consent($1, true, true, true)", [program.id]);
    const before = (await pool.query("select updated_at from public.estimates where id = $1", [sharedEstimate])).rows[0];
    await as(creator, "select public.mentorship_add_comment($1, 'suggestion', 'Use 12 in OC')", [shareId]);
    expect((await pool.query("select updated_at from public.estimates where id = $1", [sharedEstimate])).rows[0]).toEqual(before);
    expect(await sqlError(as(stranger, "select public.mentorship_add_comment($1, 'comment', 'hi')", [shareId]))).toBe("forbidden");
    const summary = (await as(creator, "select public.creator_pipeline_summary($1, $2) as s", [program.id, freeGift])).s;
    expect(summary.by_stage).toBeDefined();
    expect(JSON.stringify(summary)).not.toMatch(/Jones|Smith|Secret/);
  });

  it("revoking a share cuts the creator off immediately", async () => {
    await as(freeUser, "select public.revoke_mentorship_share($1)", [shareId]);
    expect(await sqlError(as(creator, "select public.mentorship_share_view($1)", [shareId]))).toBe("forbidden");
    expect((await as(creator, "select public.creator_shares($1) as s", [program.id])).s).toEqual([]);
    // Re-share for the next tests.
    shareId = (await as(freeUser, "select public.share_estimate_for_mentorship($1, $2, false, false, true, '{}') as id", [program.id, sharedEstimate])).id;
    expect((await as(creator, "select public.creator_shares($1) as s", [program.id])).s[0].title).toBe("Jones deck rebuild");
  });

  it("removing a participant frees the seat, ends their gift and sharing, and gives the creator nothing", async () => {
    const used = (await pool.query("select public.creator_seats_used($1) n", [program.id])).rows[0].n;
    await as(creator, "select public.creator_revoke_gift($1, 'Not active')", [freeGift]);
    expect((await pool.query("select public.creator_seats_used($1) n", [program.id])).rows[0].n).toBe(used - 1);
    expect(await unlimited(freeUser)).toBe(false);
    expect(await sqlError(as(creator, "select public.mentorship_share_view($1)", [shareId]))).toBe("forbidden");
    expect(await sqlError(as(creator, "select public.creator_pipeline_summary($1, $2)", [program.id, freeGift]))).toBe("forbidden");
    // Their business records are untouched and still theirs alone.
    expect((await pool.query("select count(*)::int n from public.estimates where user_id = $1", [freeUser])).rows[0].n).toBe(2);
    expect((await asUser(pool, creator, (q) => q("select id from public.estimates where user_id = $1", [freeUser]))).rowCount).toBe(0);
    expect((await pool.query("select count(*)::int n from public.company_members where user_id = $1", [freeUser])).rows[0].n).toBe(0);
    // No reactivation loop: the same person can't be re-gifted in this program.
    expect(await sqlError(as(creator, "select public.creator_invite_gift($1, 'free@contractor.test', null, $2)", [program.id, hash(token())]))).toBe("already_gifted");
  });

  it("a reassigned seat never extends the promotional term", async () => {
    const t = token();
    await as(creator, "select public.creator_invite_gift($1, 'late@contractor.test', null, $2, $3)", [program.id, hash(t), freeGift]);
    await pool.query("select public.claim_creator_gift($1, $2)", [late, hash(t)]);
    const r = (await pool.query("select g.expires_at, p.expires_at program_end from public.complimentary_grants g join public.creator_programs p on p.id = g.creator_program_id where g.user_id = $1", [late])).rows[0];
    expect(new Date(r.expires_at).getTime()).toBeLessThanOrEqual(new Date(r.program_end).getTime());
    // Even the owner's extend can't push a gift grant past the program end.
    const gid = (await pool.query("select id from public.complimentary_grants where user_id = $1", [late])).rows[0].id;
    await pool.query("select public.admin_comp_extend($1, $2, 365)", [owner, gid]);
    const after = (await pool.query("select g.expires_at, p.expires_at program_end from public.complimentary_grants g join public.creator_programs p on p.id = g.creator_program_id where g.id = $1", [gid])).rows[0];
    expect(new Date(after.expires_at).getTime()).toBe(new Date(after.program_end).getTime());
  });

  it("an expired subscriber grant ends Unlimited and keeps their work", async () => {
    await estimate(late, "Late bid");
    await pool.query("update public.complimentary_grants set starts_at = now() - interval '2 days', expires_at = now() - interval '1 day' where user_id = $1", [late]);
    expect(await unlimited(late)).toBe(false);
    const mine = (await as(late, "select public.my_mentorship() as m")).m;
    expect(mine[0].state).toBe("expired");
    expect((await pool.query("select count(*)::int n from public.estimates where user_id = $1", [late])).rows[0].n).toBe(1);
  });

  it("an expired creator program ends every creator privilege", async () => {
    await pool.query("update public.creator_programs set starts_at = now() - interval '400 days', expires_at = now() - interval '1 day' where id = $1", [program.id]);
    expect(await sqlError(as(creator, "select public.creator_dashboard($1)", [program.id]))).toBe("program_inactive");
    expect(await sqlError(as(creator, "select public.mentorship_share_view($1)", [shareId]))).toBe("forbidden");
    expect(await sqlError(as(creator, "select public.creator_invite_gift($1, 'new@contractor.test', null, $2)", [program.id, hash(token())]))).toBe("program_inactive");
    const preview = (await pool.query("select public.creator_gift_preview($1) as p", [hash("nothing")])).rows[0].p;
    expect(preview).toEqual({ ok: false, reason: "invalid" });
  });

  it("outreach: suppressed emails can't be queued, one follow-up per prospect, reallocation stays in trade", async () => {
    const mk = async (name: string, trade: string, rank: number, email: string) =>
      (await pool.query("insert into public.creator_prospects (channel_name, trade, rank, contact_email, stage) values ($1, $2, $3, $4, 'qualified') returning id", [name, trade, rank, email])).rows[0].id;
    const a = await mk("Deck A", "Decks", 1, "a@decks.test");
    const b = await mk("Roof B", "Roofing", 2, "b@roof.test");
    const c = await mk("Deck C", "Decks", 3, "c@decks.test");
    await pool.query("insert into public.creator_cohort_slots (cohort, trade, reserved_prospect_id, reserved_at) values ('First cohort', 'Decks', $1, now())", [a]);
    await pool.query("insert into public.creator_outreach_suppressions (email, reason) values ('b@roof.test', 'unsubscribe')");
    expect(await sqlError(pool.query("insert into public.creator_outreach_messages (prospect_id, kind, to_email, subject, body_text, status, approved_at) values ($1, 'initial', 'b@roof.test', 'Hi', 'Body', 'approved', now())", [b]))).toBe("suppressed");
    await pool.query("insert into public.creator_outreach_messages (prospect_id, kind, to_email, subject, body_text, status, approved_at) values ($1, 'follow_up', 'a@decks.test', 'Re', 'Body', 'approved', now())", [a]);
    expect(await sqlError(pool.query("insert into public.creator_outreach_messages (prospect_id, kind, to_email, subject, body_text, status, approved_at) values ($1, 'follow_up', 'a@decks.test', 'Re', 'Body', 'approved', now())", [a]))).toMatch(/duplicate key/);
    await pool.query("update public.creator_prospects set stage = 'no_response_first_cohort' where id = $1", [a]);
    const next = (await pool.query("select public.creator_outreach_reallocate($1) n", [a])).rows[0].n;
    expect(next).toBe(c);
    expect((await pool.query("select stage from public.creator_prospects where id = $1", [a])).rows[0].stage).toBe("opportunity_reallocated");
    // A prospect can hold only one slot; a slot only one prospect.
    expect(await sqlError(pool.query("insert into public.creator_cohort_slots (cohort, trade, reserved_prospect_id, reserved_at) values ('First cohort', 'Decks', $1, now())", [c]))).toMatch(/duplicate key/);
    // No subscription was issued to anyone by reallocation.
    expect((await pool.query("select count(*)::int n from public.complimentary_grants where email like '%decks.test'")).rows[0].n).toBe(0);
  });
});
