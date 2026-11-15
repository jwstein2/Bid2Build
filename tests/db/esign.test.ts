/**
 * E-signature tables and functions against a real Postgres with every migration applied:
 * creation rules, idempotent + concurrent acceptance, expiry/revocation, immutability, delete guards,
 * and tenant isolation (personal bids, Enterprise visibility, anon).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createHash } from "node:crypto";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;

const h = (c: string) => createHash("sha256").update(c).digest("hex");
const future = (days = 30) => new Date(Date.now() + days * 86_400_000).toISOString();
const PNG = "data:image/png;base64,iVBORw0KGgo=";

d("e-signatures (database)", () => {
  let owner: string, mgr: string, est: string, est2: string, solo: string, stranger: string, company: string;

  async function newBid(u: string, title: string, total = 18450) {
    const id = (await asUser(pool, u, (q) => q("insert into public.estimates (user_id, title, customer_name) values ($1, $2, 'John Smith') returning id", [u, title]))).rows[0].id;
    return { id, v1: await addVersion(id, u, 1, total) };
  }
  async function addVersion(estimateId: string, u: string, n: number, total: number) {
    const proposal = { meta: { title: "Backyard Deck Replacement", number: "1042" }, customer: { name: "John Smith" }, pricing: { total: `$${total}` } };
    return (await pool.query(
      `insert into public.estimate_versions (estimate_id, user_id, version_number, content_hash, snapshot, proposal, total_cost, subtotal, tax, total)
       values ($1, $2, $3, $4, '{}', $5, 1, $6, 0, $6) returning id`, [estimateId, u, n, h(String(n)), proposal, total])).rows[0].id as string;
  }
  const create = (u: string, e: string, v: string, tok: string, exp = future()) =>
    pool.query("select * from public.create_signing_request($1, $2, $3, $4, $5, $6)", [u, e, v, h(tok), h("d"), exp]).then((r) => r.rows[0]);
  const accept = (tok: string, name = "John Smith", email = "john@example.com", method = "typed") =>
    pool.query(
      `select * from public.accept_signing_request($1, $2, $3, $4, $5, $6, 'v1', 'I consent', 'I accept', now(), '203.0.113.9', 'test-agent')`,
      [h(tok), name, email, method, method === "typed" ? name : null, method === "drawn" ? PNG : null]).then((r) => r.rows[0]);

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_esign"));
    owner = await createUser(pool, "owner@acme.dev");
    mgr = await createUser(pool, "mgr@acme.dev");
    est = await createUser(pool, "est@acme.dev");
    est2 = await createUser(pool, "est2@acme.dev");
    solo = await createUser(pool, "solo@test.dev");
    stranger = await createUser(pool, "stranger@test.dev");
    company = (await pool.query("select public.create_company($1, 'Acme') as id", [owner])).rows[0].id;
    await pool.query("select public.apply_subscription_update(p_user_id => $1::uuid, p_stripe_customer_id => 'c', p_stripe_subscription_id => 's', p_status => 'active', p_plan => 'enterprise', p_price_id => 'p', p_current_period_end => '2099-01-01', p_cancel_at_period_end => false, p_canceled_at => null, p_ended_at => null, p_event_created => now(), p_company_id => $2::uuid, p_seat_quantity => 10)", [owner, company]);
    for (const [u, email, role] of [[mgr, "mgr@acme.dev", "manager"], [est, "est@acme.dev", "estimator"], [est2, "est2@acme.dev", "estimator"]] as const) {
      const t = (await asUser(pool, owner, (q) => q("select token from public.create_company_invitation($1, $2)", [email, role]))).rows[0].token;
      await asUser(pool, u, (q) => q("select public.accept_company_invitation($1)", [t]));
    }
  });
  afterAll(async () => { await drop?.(); });

  it("creates a request only for the owner's own version, with a sane expiry", async () => {
    const b = await newBid(solo, "Deck");
    await expect(create(stranger, b.id, b.v1, "x1")).rejects.toThrow(/estimate_not_found/);
    await expect(create(solo, b.id, b.v1, "x2", new Date(Date.now() + 60_000).toISOString())).rejects.toThrow(/invalid_expiry/);
    await expect(create(solo, b.id, b.v1, "x3", future(200))).rejects.toThrow(/invalid_expiry/);
    const r = await create(solo, b.id, b.v1, "x4");
    expect(r.status).toBe("pending");
    expect(r.content_hash).toBe(h("1"));
  });

  it("signs once; a replay by the same signer is idempotent, anyone else is refused", async () => {
    const b = await newBid(solo, "Patio");
    await create(solo, b.id, b.v1, "p1");
    const first = await accept("p1");
    expect(first.created).toBe(true);
    const again = await accept("p1");
    expect(again).toMatchObject({ signature_id: first.signature_id, created: false });
    await expect(accept("p1", "Someone Else", "else@example.com")).rejects.toThrow(/already_signed/);
    const s = (await pool.query("select * from public.signatures where id = $1", [first.signature_id])).rows[0];
    expect(s).toMatchObject({ estimate_id: b.id, version_id: b.v1, signer_name: "John Smith", method: "typed", signature_text: "John Smith", verification: "link_possession", pdf_status: "pending", proposal_number: "1042", ip_address: "203.0.113.9" });
    expect(Number(s.total)).toBe(18450);
    expect((await pool.query("select status, signed_at from public.signing_requests where token_hash = $1", [h("p1")])).rows[0].status).toBe("signed");
    // The same version can't be sent for signature again.
    await expect(create(solo, b.id, b.v1, "p2")).rejects.toThrow(/version_already_signed/);
  });

  it("concurrent submissions produce exactly one signature", async () => {
    const b = await newBid(solo, "Fence");
    await create(solo, b.id, b.v1, "c1");
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => accept("c1", `Signer ${i}`, `s${i}@example.com`)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await pool.query("select count(*)::int as n from public.signatures where estimate_id = $1", [b.id])).rows[0].n).toBe(1);
  });

  it("expired, revoked, superseded and archived links can't be signed", async () => {
    const b = await newBid(solo, "Roof");
    await create(solo, b.id, b.v1, "e1");
    await pool.query("update public.signing_requests set expires_at = now() - interval '1 minute', created_at = now() - interval '1 day' where token_hash = $1", [h("e1")]);
    await expect(accept("e1")).rejects.toThrow(/link_expired/);

    const r2 = await create(solo, b.id, b.v1, "e2");
    expect((await pool.query("select status, revoke_reason from public.signing_requests where token_hash = $1", [h("e1")])).rows[0]).toMatchObject({ status: "revoked", revoke_reason: "superseded" });
    await pool.query("select public.revoke_signing_request($1, $2)", [solo, r2.id]);
    await expect(accept("e2")).rejects.toThrow(/link_revoked/);
    await expect(pool.query("select public.revoke_signing_request($1, $2)", [stranger, r2.id])).rejects.toThrow(/request_not_found/);

    // A newer link (revision v2) supersedes the older pending one.
    const v2 = await addVersion(b.id, solo, 2, 19000);
    await create(solo, b.id, b.v1, "e3");
    await create(solo, b.id, v2, "e4");
    expect((await pool.query("select status, revoke_reason from public.signing_requests where token_hash = $1", [h("e3")])).rows[0]).toMatchObject({ status: "revoked", revoke_reason: "superseded" });
    await expect(accept("e3")).rejects.toThrow(/link_revoked/);

    await pool.query("update public.estimates set status = 'archived' where id = $1", [b.id]);
    await expect(accept("e4")).rejects.toThrow(/link_revoked/);
    await expect(create(solo, b.id, v2, "e5")).rejects.toThrow(/estimate_archived/);
    await expect(accept("nope")).rejects.toThrow(/link_invalid/);
  });

  it("signature evidence is write-once; only the signed-PDF state changes", async () => {
    const b = await newBid(solo, "Siding");
    await create(solo, b.id, b.v1, "i1");
    const { signature_id: id } = await accept("i1", "Ann Lee", "ann@example.com", "drawn");
    await expect(pool.query("update public.signatures set signer_name = 'X' where id = $1", [id])).rejects.toThrow(/signature_immutable/);
    await expect(pool.query("update public.signatures set total = 1 where id = $1", [id])).rejects.toThrow(/signature_immutable/);
    await pool.query("select public.record_signed_pdf($1, false, null, null, 'render failed')", [id]);
    expect((await pool.query("select pdf_status, pdf_attempts from public.signatures where id = $1", [id])).rows[0]).toMatchObject({ pdf_status: "failed", pdf_attempts: 1 });
    await pool.query("select public.record_signed_pdf($1, true, 'a/b.pdf', $2, null)", [id, h("f")]);
    await pool.query("select public.record_signed_pdf($1, true, 'other.pdf', $2, null)", [id, h("e")]); // no-op once ready
    expect((await pool.query("select pdf_status, pdf_path, pdf_hash from public.signatures where id = $1", [id])).rows[0]).toMatchObject({ pdf_status: "ready", pdf_path: "a/b.pdf", pdf_hash: h("f") });
    await expect(pool.query("update public.signatures set pdf_path = 'z' where id = $1", [id])).rejects.toThrow(/signature_immutable/);
    await expect(pool.query("delete from public.signatures where id = $1", [id])).rejects.toThrow(/signature_immutable/);
    // A signed bid (and its signed version) can be archived but not deleted.
    await expect(asUser(pool, solo, (q) => q("delete from public.estimates where id = $1", [b.id]))).rejects.toThrow(/estimate_signed/);
    await expect(pool.query("delete from public.estimate_versions where id = $1", [b.v1])).rejects.toThrow(/version_signed/);
    // Unsigned bids still delete normally (pending requests go with them).
    const c = await newBid(solo, "Gutter");
    await create(solo, c.id, c.v1, "i2");
    await asUser(pool, solo, (q) => q("delete from public.estimates where id = $1", [c.id]));
    expect((await pool.query("select count(*)::int n from public.signing_requests where token_hash = $1", [h("i2")])).rows[0].n).toBe(0);
  });

  it("tenant isolation: owner sees own; strangers, anon and signed-in users can't write or read token hashes", async () => {
    const b = await newBid(solo, "Isolated");
    await create(solo, b.id, b.v1, "t1");
    await accept("t1");
    const mine = await asUser(pool, solo, (q) => q("select s.id from public.signatures s where s.estimate_id = $1", [b.id]));
    expect(mine.rows).toHaveLength(1);
    const theirs = await asUser(pool, stranger, (q) => q("select id from public.signatures where estimate_id = $1 union all select id from public.signing_requests where estimate_id = $1", [b.id]));
    expect(theirs.rows).toHaveLength(0);
    await expect(asUser(pool, solo, (q) => q("select token_hash from public.signing_requests"))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, solo, (q) => q("update public.signing_requests set status = 'revoked'"))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, solo, (q) => q("insert into public.signatures (request_id) values (gen_random_uuid())"))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, solo, (q) => q("select public.accept_signing_request($1, 'a', 'b@c.d', 'typed', 'a', null, 'v', 'c', 'a', now(), null, null)", [h("t1")]))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, solo, (q) => q("select public.create_signing_request($1, $2, $3, $4, $5, $6)", [solo, b.id, b.v1, h("zz"), h("d"), future()]))).rejects.toThrow(/permission denied/);
    const c = await pool.connect();
    try {
      await c.query("begin; set local role anon");
      await expect(c.query("select id from public.signatures")).rejects.toThrow(/permission denied/);
    } finally { await c.query("rollback"); c.release(); }
  });

  it("Enterprise: owner with company visibility sees a teammate's signed bid; a peer estimator doesn't", async () => {
    const b = await newBid(est, "Company roof", 24000);
    expect((await pool.query("select company_id from public.estimates where id = $1", [b.id])).rows[0].company_id).toBe(company);
    const r = await create(est, b.id, b.v1, "ent1");
    expect(r.company_id).toBe(company);
    const { signature_id } = await accept("ent1");
    expect((await pool.query("select company_id from public.signatures where id = $1", [signature_id])).rows[0].company_id).toBe(company);
    const seen = async (u: string) => (await asUser(pool, u, (q) => q("select id from public.signatures where id = $1", [signature_id]))).rows.length;
    expect(await seen(est)).toBe(1);
    expect(await seen(owner)).toBe(1);
    expect(await seen(est2)).toBe(0);
    expect(await seen(solo)).toBe(0);
    // Only the bid's owner creates links, even for the company owner.
    await expect(create(owner, b.id, b.v1, "ent2")).rejects.toThrow(/estimate_not_found/);
  });

  it("deleting an account still cascades (the delete guards only block direct deletes)", async () => {
    const u = await createUser(pool, "leaving@test.dev");
    const b = await newBid(u, "Bye");
    await create(u, b.id, b.v1, "del1");
    await accept("del1");
    await pool.query("delete from auth.users where id = $1", [u]);
    expect((await pool.query("select count(*)::int n from public.signatures where user_id = $1", [u])).rows[0].n).toBe(0);
  });
});
