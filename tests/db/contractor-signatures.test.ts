/**
 * V5.3 contractor-side signatures against a real Postgres with every migration applied: company policy
 * and permissions, personal signature credentials, rep authorization, automatic vs interactive
 * application, contractor-first and customer-first sequences, missing-signer handling, revocation,
 * ownership change, historical (pre-feature) contracts, immutability, payment-schedule preservation
 * and tenant isolation.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createHash } from "node:crypto";
import { asUser, createUser, dbAvailable, freshDb, type Row } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;

const h = (c: string) => createHash("sha256").update(c).digest("hex");
const future = (days = 30) => new Date(Date.now() + days * 86_400_000).toISOString();
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const SCHEDULE = [{ label: "Deposit", percent: "30", amount: "$5,535.00" }, { label: "On completion", percent: "70", amount: "$12,915.00" }];

d("contractor signatures (database)", () => {
  let owner: string, mgr: string, rep: string, rep2: string, viewer: string, solo: string, stranger: string, company: string, otherOwner: string, otherCompany: string;
  let n = 0;

  async function newBid(u: string, title = "Deck", total = 18450) {
    const id = (await asUser(pool, u, (q) => q("insert into public.estimates (user_id, title, customer_name) values ($1, $2, 'John Smith') returning id", [u, title]))).rows[0].id as string;
    return { id, v1: await addVersion(id, u, 1, total) };
  }
  async function addVersion(estimateId: string, u: string, num: number, total: number) {
    const proposal = { meta: { title: "Backyard Deck Replacement", number: "1042" }, brand: { companyName: "Acme Exteriors LLC" }, customer: { name: "John Smith" }, pricing: { total: `$${total}` }, paymentSchedule: SCHEDULE };
    return (await pool.query(
      `insert into public.estimate_versions (estimate_id, user_id, version_number, content_hash, snapshot, proposal, total_cost, subtotal, tax, total)
       values ($1, $2, $3, $4, '{}', $5, 1, $6, 0, $6) returning id`, [estimateId, u, num, h(`${estimateId}${num}`), proposal, total])).rows[0].id as string;
  }
  /** create_signing_request + contractor_record_requirement, exactly as the route does. */
  async function link(u: string, e: string, v: string) {
    const tok = `tok${++n}`;
    const r = (await pool.query("select * from public.create_signing_request($1, $2, $3, $4, $5, $6)", [u, e, v, h(tok), h("d"), future()])).rows[0];
    const req = (await pool.query("select * from public.contractor_record_requirement($1, $2)", [r.id, u])).rows[0];
    return { tok, request: r, req };
  }
  const accept = async (tok: string) => {
    const row = (await pool.query(
      "select * from public.accept_signing_request($1, 'John Smith', 'john@example.com', 'typed', 'John Smith', null, 'v1', 'I consent', 'I accept', now(), '203.0.113.9', 'test-agent')", [h(tok)])).rows[0];
    const after = (await pool.query("select public.contractor_after_customer_signed($1) as v", [row.signature_id])).rows[0].v;
    return { signatureId: row.signature_id as string, after };
  };
  const adopt = (u: string, name: string, opts: { auto?: boolean; method?: "typed" | "drawn"; title?: string } = {}) =>
    pool.query("select * from public.contractor_adopt_credential($1, $2, $3, $4, $5, $6, $7, 'adopt-v1', 'I adopt this signature', $8, $9, '198.51.100.7', 'ua')", [
      u, name, opts.title ?? null, opts.method ?? "typed", opts.method === "drawn" ? null : name, opts.method === "drawn" ? PNG : null, opts.method === "drawn" ? h("img") : null,
      opts.auto ? "I authorize automatic application" : null, { method: "recent_sign_in", authenticatedAt: new Date().toISOString() },
    ]).then((r) => r.rows[0] as Row);
  const savePolicy = (actor: string, co: string | null, settings: Record<string, unknown>) =>
    pool.query("select * from public.contractor_save_policy($1, $2, $3)", [actor, co, settings]).then((r) => r.rows[0] as Row);
  const grant = (actor: string, co: string, u: string, scope = "own_bids", auto = false, title: string | null = null) =>
    pool.query("select * from public.contractor_grant_authorization($1, $2, $3, $4, $5, $6)", [actor, co, u, scope, auto, title]).then((r) => r.rows[0] as Row);
  const resolve = (e: string) => pool.query("select public.contractor_resolve_signer($1) as v", [e]).then((r) => r.rows[0].v as Row);
  const apply = (e: string, v: string, signer: string, actor: string | null, application = "interactive", trigger = "countersign_action") =>
    pool.query("select * from public.contractor_apply_signature($1, $2, $3, $4, $5, $6, $7, '198.51.100.9', 'Mozilla/5.0', now())", [
      e, v, signer, actor, application, trigger, application === "interactive" ? "I sign this agreement on behalf of the company" : null,
    ]).then((r) => r.rows[0] as Row);
  const autoApply = (e: string, v: string, signer: string, actor: string | null, trigger = "signing_link_created") =>
    pool.query("select * from public.contractor_apply_signature($1, $2, $3, $4, 'auto_policy', $5, null, null, null, null)", [e, v, signer, actor, trigger]).then((r) => r.rows[0] as Row);

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_contractor_sign"));
    owner = await createUser(pool, "owner@acme.dev");
    mgr = await createUser(pool, "mgr@acme.dev");
    rep = await createUser(pool, "rep@acme.dev");
    rep2 = await createUser(pool, "rep2@acme.dev");
    viewer = await createUser(pool, "viewer@acme.dev");
    solo = await createUser(pool, "solo@test.dev");
    stranger = await createUser(pool, "stranger@test.dev");
    otherOwner = await createUser(pool, "boss@other.dev");
    company = (await pool.query("select public.create_company($1, 'Acme') as id", [owner])).rows[0].id;
    otherCompany = (await pool.query("select public.create_company($1, 'Other Co') as id", [otherOwner])).rows[0].id;
    for (const [co, o] of [[company, owner], [otherCompany, otherOwner]]) {
      await pool.query("select public.apply_subscription_update(p_user_id => $1::uuid, p_stripe_customer_id => $3, p_stripe_subscription_id => $3, p_status => 'active', p_plan => 'enterprise', p_price_id => 'p', p_current_period_end => '2099-01-01', p_cancel_at_period_end => false, p_canceled_at => null, p_ended_at => null, p_event_created => now(), p_company_id => $2::uuid, p_seat_quantity => 10)", [o, co, `c_${co}`]);
    }
    for (const [u, email, role] of [[mgr, "mgr@acme.dev", "manager"], [rep, "rep@acme.dev", "estimator"], [rep2, "rep2@acme.dev", "estimator"], [viewer, "viewer@acme.dev", "viewer"]] as const) {
      const t = (await asUser(pool, owner, (q) => q("select token from public.create_company_invitation($1, $2)", [email, role]))).rows[0].token;
      await asUser(pool, u, (q) => q("select public.accept_company_invitation($1)", [t]));
    }
  });
  afterAll(async () => { await drop?.(); });

  it("defaults: with no saved policy a contractor signature is required and countersigned by hand", async () => {
    const b = await newBid(solo, "Default");
    const r = await resolve(b.id);
    expect(r).toMatchObject({ required: true, signerId: solo, autoEligible: false, missing: "no_signature_on_file" });
    expect(r.policy).toMatchObject({ configured: false, mode: "manual" });
  });

  it("1/16: only the owner (or someone the owner trusted) configures the company policy", async () => {
    await expect(savePolicy(rep, company, { mode: "company_signer" })).rejects.toThrow(/forbidden/);
    await expect(savePolicy(mgr, company, { mode: "company_signer" })).rejects.toThrow(/forbidden/);
    await expect(savePolicy(stranger, company, { mode: "company_signer" })).rejects.toThrow(/forbidden/);
    // A default signer must be authorized for the company.
    await expect(savePolicy(owner, company, { mode: "company_signer", defaultSignerId: rep })).rejects.toThrow(/signer_not_authorized/);
    const p1 = await savePolicy(owner, company, { mode: "company_signer", defaultSignerId: owner, autoApplyAllowed: true });
    expect(p1).toMatchObject({ company_id: company, mode: "company_signer", default_signer_id: owner, auto_apply_allowed: true, revision: 1 });
    // The owner can trust a manager with change_proposal_policy (owner-only grant), who may then manage it.
    await asUser(pool, owner, (q) => q("select public.update_company_member($1, 'manager', $2, '{}')", [mgr, ["change_proposal_policy"]]));
    const p2 = await savePolicy(mgr, company, { mode: "company_signer", defaultSignerId: owner, autoApplyAllowed: true });
    expect(p2.revision).toBe(2);
    expect((await pool.query("select count(*)::int n from public.contractor_signing_policy_history where policy_id = $1", [p1.id])).rows[0].n).toBe(2);
    // A company member can't create a separate solo policy.
    await expect(savePolicy(rep, null, { mode: "manual" })).rejects.toThrow(/use_company_policy/);
  });

  it("2/14: personal signature credentials are versioned, write-once and revocable", async () => {
    const c1 = await adopt(owner, "Dana Owner", { auto: true, title: "President" });
    expect(c1).toMatchObject({ version: 1, status: "active", auto_apply_authorized: true, legal_name: "Dana Owner" });
    const c2 = await adopt(owner, "Dana M. Owner", { auto: true, title: "President", method: "drawn" });
    expect(c2.version).toBe(2);
    expect((await pool.query("select status from public.contractor_signer_credentials where id = $1", [c1.id])).rows[0].status).toBe("superseded");
    await expect(pool.query("update public.contractor_signer_credentials set legal_name = 'X' where id = $1", [c2.id])).rejects.toThrow(/record_immutable/);
    await expect(pool.query("update public.contractor_signer_credentials set status = 'active' where id = $1", [c1.id])).rejects.toThrow(/record_immutable/);
    await expect(pool.query("delete from public.contractor_signer_credentials where id = $1", [c2.id])).rejects.toThrow(/record_immutable/);
    // Each person reads only their own signature.
    expect((await asUser(pool, owner, (q) => q("select id from public.contractor_signer_credentials"))).rows.length).toBe(2);
    expect((await asUser(pool, mgr, (q) => q("select id from public.contractor_signer_credentials where user_id = $1", [owner]))).rows.length).toBe(0);
    // Revoking automatic use keeps the signature for interactive signing only.
    const s = await adopt(solo, "Sam Solo", { auto: true });
    const r = (await pool.query("select * from public.contractor_revoke_credential($1, 'auto_apply')", [solo])).rows[0];
    expect(r.status).toBe("active");
    expect(r.auto_apply_revoked_at).not.toBeNull();
    await expect(pool.query("update public.contractor_signer_credentials set auto_apply_revoked_at = null where id = $1", [s.id])).rejects.toThrow(/record_immutable/);
  });

  it("3/16: reps can't grant themselves authority; the owner authorizes them", async () => {
    await expect(grant(rep, company, rep)).rejects.toThrow(/forbidden/);
    await expect(grant(owner, company, owner)).rejects.toThrow(/self_grant/);
    // The trusted manager can authorize others but never themselves.
    await expect(grant(mgr, company, mgr)).rejects.toThrow(/self_grant/);
    await expect(grant(owner, company, viewer)).rejects.toThrow(/not_a_member/);
    await expect(grant(owner, company, solo)).rejects.toThrow(/not_a_member/);
    const a = await grant(owner, company, rep, "own_bids", true, "Sales Representative");
    expect(a).toMatchObject({ scope: "own_bids", auto_apply_allowed: true, status: "active", granted_by: owner });
    await expect(pool.query("update public.contractor_signing_authorizations set scope = 'company_bids' where id = $1", [a.id])).rejects.toThrow(/record_immutable/);
    // The roster never exposes signature images.
    const roster = (await pool.query("select public.contractor_company_signers($1, $2) as v", [owner, company])).rows[0].v as Row[];
    expect(JSON.stringify(roster)).not.toContain("iVBOR");
    expect(roster.find((x) => x.userId === rep)?.authorization).toMatchObject({ scope: "own_bids" });
    await expect(pool.query("select public.contractor_company_signers($1, $2)", [rep, company])).rejects.toThrow(/forbidden/);
  });

  it("4/7/9/10: Mode A automatic company signature applied before sending (contractor-first)", async () => {
    const b = await newBid(rep, "Roof A");
    const r = await resolve(b.id);
    expect(r).toMatchObject({ required: true, signerId: owner, via: "company_signer", autoEligible: true, autoTiming: "before_send", signerName: "Dana M. Owner", signerTitle: "President" });
    const before = Date.now();
    const c = await autoApply(b.id, b.v1, owner, rep);
    expect(c).toMatchObject({ application: "auto_policy", trigger: "signing_link_created", sequence: "contractor_first", authority: "company_owner", signer_id: owner, signer_name: "Dana M. Owner", credential_version: 2, triggered_by: rep, corrective: false, company_name: "Acme Exteriors LLC" });
    // No fabricated interaction evidence on an automatic application.
    expect(c.ip_address).toBeNull();
    expect(c.user_agent).toBeNull();
    expect(c.session_authenticated_at).toBeNull();
    expect(c.statement_text).toBe("I authorize automatic application");
    expect(new Date(c.authorization_given_at).getTime()).toBeLessThanOrEqual(new Date(c.applied_at).getTime());
    expect(new Date(c.applied_at).getTime()).toBeGreaterThanOrEqual(before - 2000);
    expect(c.policy_snapshot).toMatchObject({ mode: "company_signer", revision: 2 });
    const { tok, req } = await link(rep, b.id, b.v1);
    expect(req).toMatchObject({ required: true, sequence: "contractor_first", mode: "company_signer", policy_revision: 2 });
    const { signatureId, after } = await accept(tok);
    expect(after.state).toBe("fully_executed");
    const ex = (await pool.query("select * from public.contractor_executed_documents where signature_id = $1", [signatureId])).rows[0];
    const sig = (await pool.query("select signed_at from public.signatures where id = $1", [signatureId])).rows[0];
    expect(new Date(ex.executed_at).toISOString()).toBe(new Date(sig.signed_at).toISOString()); // the later of the two real times
    expect(ex.contractor_signature_id).toBe(c.id);
  });

  it("4: automatic application is refused when it isn't authorized", async () => {
    const b = await newBid(rep, "Roof B");
    // Someone other than the resolved signer can't be auto-applied.
    await expect(autoApply(b.id, b.v1, rep, rep)).rejects.toThrow(/auto_not_permitted|no_signature_on_file/);
    // Company turns automatic application off -> fresh approval needed for each contract.
    await savePolicy(owner, company, { mode: "company_signer", defaultSignerId: owner, autoApplyAllowed: false });
    expect((await resolve(b.id)).autoEligible).toBe(false);
    await expect(autoApply(b.id, b.v1, owner, rep)).rejects.toThrow(/auto_not_permitted/);
    await savePolicy(owner, company, { mode: "company_signer", defaultSignerId: owner, autoApplyAllowed: true });
    expect((await resolve(b.id)).autoEligible).toBe(true);
  });

  it("5/6/19: Mode C manual countersignature after the customer signs (customer-first)", async () => {
    await savePolicy(owner, company, { mode: "manual", defaultSignerId: owner });
    const b = await newBid(rep2, "Siding C");
    const { tok, req } = await link(rep2, b.id, b.v1);
    expect(req).toMatchObject({ required: true, sequence: "customer_first", mode: "manual" });
    const { signatureId, after } = await accept(tok);
    expect(after).toMatchObject({ state: "awaiting_contractor", signerId: owner });
    expect((await pool.query("select count(*)::int n from public.contractor_executed_documents where signature_id = $1", [signatureId])).rows[0].n).toBe(0);
    // Shown to the people who can countersign it.
    const forOwner = (await pool.query("select * from public.contractor_awaiting_for($1)", [owner])).rows.map((x) => x.signature_id);
    expect(forOwner).toContain(signatureId);
    expect((await pool.query("select * from public.contractor_awaiting_for($1)", [rep])).rows.map((x) => x.signature_id)).not.toContain(signatureId);
    // Manual mode never auto-applies.
    await expect(autoApply(b.id, b.v1, owner, null, "customer_signed")).rejects.toThrow(/auto_not_permitted/);
    // Nobody signs with another person's signature.
    await expect(apply(b.id, b.v1, owner, mgr)).rejects.toThrow(/signer_mismatch/);
    const customerBefore = (await pool.query("select * from public.signatures where id = $1", [signatureId])).rows[0];
    const c = await apply(b.id, b.v1, owner, owner);
    expect(c).toMatchObject({ application: "interactive", trigger: "countersign_action", sequence: "customer_first", customer_signature_id: signatureId, ip_address: "198.51.100.9", corrective: false });
    expect(new Date(c.applied_at).getTime()).toBeGreaterThanOrEqual(new Date(customerBefore.signed_at).getTime());
    // Customer acceptance evidence is untouched.
    const customerAfter = (await pool.query("select * from public.signatures where id = $1", [signatureId])).rows[0];
    expect(customerAfter).toEqual(customerBefore);
    const ex = (await pool.query("select * from public.contractor_executed_documents where signature_id = $1", [signatureId])).rows[0];
    expect(new Date(ex.executed_at).toISOString()).toBe(new Date(c.applied_at).toISOString());
    // Idempotent for the same signer; a second, different countersignature is refused.
    expect((await apply(b.id, b.v1, owner, owner)).id).toBe(c.id);
    const events = (await pool.query("select event from public.contractor_signing_events where estimate_id = $1 order by id", [b.id])).rows.map((x) => x.event);
    expect(events).toEqual(["requirement_recorded", "countersign_requested", "contractor_signed_interactive", "fully_executed"]);
  });

  it("4/6: automatic application after the customer signs (customer-first auto)", async () => {
    await savePolicy(owner, company, { mode: "company_signer", defaultSignerId: owner, autoApplyAllowed: true, autoApplyTiming: "after_customer" });
    const b = await newBid(rep, "Gutters");
    const { tok } = await link(rep, b.id, b.v1);
    const { signatureId, after } = await accept(tok);
    expect(after.state).toBe("fully_executed");
    const c = (await pool.query("select * from public.contractor_signatures where version_id = $1", [b.v1])).rows[0];
    expect(c).toMatchObject({ application: "auto_policy", trigger: "customer_signed", sequence: "customer_first", customer_signature_id: signatureId, triggered_by: null });
  });

  it("3/B: Mode B uses the assigned rep's signature when authorized, else falls back to the company signer", async () => {
    await savePolicy(owner, company, { mode: "sales_rep", repSignaturesAllowed: true, defaultSignerId: owner, autoApplyAllowed: true });
    const repBid = await newBid(rep, "Rep bid");
    // Rep authorized but no signature on file yet -> company signer.
    expect(await resolve(repBid.id)).toMatchObject({ signerId: owner, via: "company_signer_fallback" });
    await adopt(rep, "Riley Rep", { auto: true });
    expect(await resolve(repBid.id)).toMatchObject({ signerId: rep, via: "sales_rep", authority: "company_authorization", signerTitle: "Sales Representative", autoEligible: true });
    // rep2 isn't authorized -> company signer.
    const rep2Bid = await newBid(rep2, "Rep2 bid");
    await adopt(rep2, "Robin Rep");
    expect(await resolve(rep2Bid.id)).toMatchObject({ signerId: owner, via: "company_signer_fallback" });
    // own_bids scope: rep can't sign rep2's bid.
    await expect(apply(rep2Bid.id, rep2Bid.v1, rep, rep)).rejects.toThrow(/signer_not_authorized/);
    const c = await autoApply(repBid.id, repBid.v1, rep, rep);
    expect(c).toMatchObject({ signer_id: rep, authority: "company_authorization", signer_title: "Sales Representative" });
  });

  it("8: missing signer -> awaiting contractor signature, never auto-filled", async () => {
    const u = await createUser(pool, "newbie@test.dev");
    const b = await newBid(u, "No sig yet");
    const { tok } = await link(u, b.id, b.v1);
    const { after } = await accept(tok);
    expect(after).toMatchObject({ state: "awaiting_contractor", missing: "no_signature_on_file" });
    expect((await pool.query("select count(*)::int n from public.contractor_signatures where estimate_id = $1", [b.id])).rows[0].n).toBe(0);
    await expect(apply(b.id, b.v1, u, u)).rejects.toThrow(/no_signature_on_file/);
    // Once they adopt a signature they can countersign (still customer-first, dated now).
    await adopt(u, "Nova Newbie");
    expect((await apply(b.id, b.v1, u, u)).sequence).toBe("customer_first");
  });

  it("14: revoking authorization or the signature stops future use; executed documents stay", async () => {
    await savePolicy(owner, company, { mode: "sales_rep", repSignaturesAllowed: true, defaultSignerId: owner, autoApplyAllowed: true });
    const signedBefore = (await pool.query("select * from public.contractor_signatures where signer_id = $1", [rep])).rows;
    expect(signedBefore.length).toBeGreaterThan(0);
    await pool.query("select public.contractor_revoke_authorization($1, $2, $3)", [owner, company, rep]);
    const b = await newBid(rep, "After revoke");
    expect(await resolve(b.id)).toMatchObject({ signerId: owner, via: "company_signer_fallback" });
    await expect(apply(b.id, b.v1, rep, rep)).rejects.toThrow(/signer_not_authorized/);
    // Revoke the owner's signature entirely: nothing can be applied until a new one is adopted.
    await pool.query("select public.contractor_revoke_credential($1, 'all')", [owner]);
    expect(await resolve(b.id)).toMatchObject({ missing: "no_signature_on_file", autoEligible: false });
    const signedAfter = (await pool.query("select * from public.contractor_signatures where signer_id = $1", [rep])).rows;
    expect(signedAfter).toEqual(signedBefore);
    await adopt(owner, "Dana M. Owner", { auto: true, title: "President" });
  });

  it("15: a change of company owner moves implicit authority; old documents keep their signer", async () => {
    const co = (await pool.query("select public.create_company($1, 'Handover Inc') as id", [await createUser(pool, "first@handover.dev")])).rows[0].id as string;
    const first = (await pool.query("select owner_user_id from public.companies where id = $1", [co])).rows[0].owner_user_id as string;
    const second = await createUser(pool, "second@handover.dev");
    await pool.query("insert into public.company_members (company_id, user_id, role) values ($1, $2, 'manager')", [co, second]);
    await adopt(first, "First Owner", { auto: true });
    await adopt(second, "Second Owner", { auto: true });
    await savePolicy(first, co, { mode: "company_signer", autoApplyAllowed: true });
    const b = await newBid(first, "Handover job");
    expect(await resolve(b.id)).toMatchObject({ signerId: first, authority: "company_owner" });
    const c = await autoApply(b.id, b.v1, first, first);
    // Ownership changes hands (support-assisted transfer).
    await pool.query("update public.company_members set role = 'manager' where company_id = $1 and user_id = $2", [co, first]);
    await pool.query("update public.company_members set role = 'owner' where company_id = $1 and user_id = $2", [co, second]);
    await pool.query("update public.companies set owner_user_id = $2 where id = $1", [co, second]);
    const b2 = await newBid(first, "After handover");
    expect(await resolve(b2.id)).toMatchObject({ signerId: second, authority: "company_owner" });
    await expect(apply(b2.id, b2.v1, first, first)).rejects.toThrow(/signer_not_authorized/);
    expect((await pool.query("select signer_id, signer_name, authority from public.contractor_signatures where id = $1", [c.id])).rows[0]).toMatchObject({ signer_id: first, signer_name: "First Owner", authority: "company_owner" });
  });

  it("11/17: historical customer-signed contracts are never altered; a corrective countersignature is separate and dated now", async () => {
    const b = await newBid(solo, "Historical");
    // A link from before this feature: no requirement row.
    const r = (await pool.query("select * from public.create_signing_request($1, $2, $3, $4, $5, $6)", [solo, b.id, b.v1, h("hist"), h("d"), future()])).rows[0];
    const s = (await pool.query("select * from public.accept_signing_request($1, 'Old Customer', 'old@example.com', 'typed', 'Old Customer', null, 'v1', 'c', 'a', now(), null, null)", [h("hist")])).rows[0];
    await pool.query("update public.signatures set pdf_status = 'ready', pdf_path = 'x.pdf', pdf_hash = $2 where id = $1", [s.signature_id, h("orig")]).catch(() => null);
    expect((await pool.query("select public.contractor_after_customer_signed($1) as v", [s.signature_id])).rows[0].v).toEqual({ state: "historical" });
    // Never automatically backfilled.
    await adopt(solo, "Sam Solo", { auto: true });
    await savePolicy(solo, null, { mode: "company_signer", autoApplyAllowed: true });
    await expect(autoApply(b.id, b.v1, solo, solo)).rejects.toThrow(/auto_not_permitted/);
    const before = (await pool.query("select * from public.signatures where id = $1", [s.signature_id])).rows[0];
    const c = await apply(b.id, b.v1, solo, solo);
    expect(c).toMatchObject({ corrective: true, trigger: "corrective_countersign", sequence: "customer_first" });
    expect(new Date(c.applied_at).getTime()).toBeGreaterThan(new Date(before.signed_at).getTime());
    expect((await pool.query("select * from public.signatures where id = $1", [s.signature_id])).rows[0]).toEqual(before);
    expect(r.status).toBe("pending");
    // Executed records are immutable.
    await expect(pool.query("update public.contractor_signatures set signer_name = 'Someone' where id = $1", [c.id])).rejects.toThrow(/record_immutable/);
    await expect(pool.query("update public.contractor_signatures set applied_at = now() - interval '30 days' where id = $1", [c.id])).rejects.toThrow(/record_immutable/);
    await expect(pool.query("delete from public.contractor_signatures where id = $1", [c.id])).rejects.toThrow(/record_immutable/);
    await expect(pool.query("delete from public.estimate_versions where id = $1", [b.v1])).rejects.toThrow(/version_signed/);
    await pool.query("select public.contractor_record_executed_pdf($1, true, 'exec.pdf', $2, null)", [s.signature_id, h("exec")]);
    await pool.query("select public.contractor_record_executed_pdf($1, true, 'other.pdf', $2, null)", [s.signature_id, h("other")]);
    expect((await pool.query("select pdf_path from public.contractor_executed_documents where signature_id = $1", [s.signature_id])).rows[0].pdf_path).toBe("exec.pdf");
    await expect(pool.query("update public.contractor_executed_documents set executed_at = now() where signature_id = $1", [s.signature_id])).rejects.toThrow(/record_immutable/);
  });

  it("18: applying a contractor signature never changes the version, its payment schedule, the pipeline or billing", async () => {
    await savePolicy(owner, company, { mode: "manual", defaultSignerId: owner });
    const b = await newBid(rep, "Money check", 18450);
    const { tok } = await link(rep, b.id, b.v1);
    await accept(tok);
    const snap = async () => ({
      version: (await pool.query("select proposal, total, content_hash from public.estimate_versions where id = $1", [b.v1])).rows[0],
      estimate: (await pool.query("select status, pipeline_stage, won_at from public.estimates where id = $1", [b.id])).rows[0],
      sigs: (await pool.query("select count(*)::int n from public.signatures where estimate_id = $1", [b.id])).rows[0].n,
    });
    const before = await snap();
    await apply(b.id, b.v1, owner, owner);
    const after = await snap();
    expect(after).toEqual(before);
    expect(after.version.proposal.paymentSchedule).toEqual(SCHEDULE);
  });

  it("20: tenant isolation and no end-user writes", async () => {
    const b = await newBid(otherOwner, "Other co job");
    await adopt(otherOwner, "Olive Other", { auto: true });
    await savePolicy(otherOwner, otherCompany, { mode: "company_signer", autoApplyAllowed: true });
    await autoApply(b.id, b.v1, otherOwner, otherOwner);
    // Acme's owner can't sign, manage or read Other Co's records.
    await expect(apply(b.id, b.v1, owner, owner)).rejects.toThrow(/signer_not_authorized/);
    await expect(savePolicy(owner, otherCompany, { mode: "manual" })).rejects.toThrow(/forbidden/);
    await expect(grant(owner, otherCompany, otherOwner)).rejects.toThrow(/forbidden/);
    const seen = await asUser(pool, owner, (q) => q(
      `select id::text from public.contractor_signatures where estimate_id = $1
       union all select id::text from public.contractor_signing_policies where company_id = $2
       union all select id::text from public.contractor_signer_credentials where user_id = $3
       union all select id::text from public.contractor_signing_events where company_id = $2`, [b.id, otherCompany, otherOwner]));
    expect(seen.rows).toHaveLength(0);
    // Company members see their own company's signed documents; a peer estimator only what they may view.
    const acmeDoc = (await pool.query("select id, estimate_id from public.contractor_signatures where company_id = $1 and signer_id = $2 limit 1", [company, rep])).rows[0];
    expect((await asUser(pool, owner, (q) => q("select id from public.contractor_signatures where id = $1", [acmeDoc.id]))).rows).toHaveLength(1);
    expect((await asUser(pool, rep2, (q) => q("select id from public.contractor_signatures where id = $1", [acmeDoc.id]))).rows).toHaveLength(0);
    // Nobody writes directly or calls the functions as an end user.
    for (const sql of [
      "insert into public.contractor_signatures (estimate_id) values (gen_random_uuid())",
      "update public.contractor_signing_policies set mode = 'manual'",
      "insert into public.contractor_signer_credentials (user_id) values (auth.uid())",
      "select public.contractor_save_policy(auth.uid(), null, '{}')",
      "select public.contractor_can_manage_signing(auth.uid(), gen_random_uuid())",
    ]) await expect(asUser(pool, owner, (q) => q(sql))).rejects.toThrow(/permission denied/);
    const c = await pool.connect();
    try {
      await c.query("begin; set local role anon");
      await expect(c.query("select id from public.contractor_signatures")).rejects.toThrow(/permission denied/);
    } finally { await c.query("rollback"); c.release(); }
  });

  it("account deletion of a rep still works; their applied signatures keep the recorded name", async () => {
    const leaver = await createUser(pool, "leaver@acme.dev");
    const t = (await asUser(pool, owner, (q) => q("select token from public.create_company_invitation($1, 'estimator')", ["leaver@acme.dev"]))).rows[0].token;
    await asUser(pool, leaver, (q) => q("select public.accept_company_invitation($1)", [t]));
    await grant(owner, company, leaver, "company_bids", false, "Estimator");
    await adopt(leaver, "Lee Leaver");
    const b = await newBid(owner, "Signed by leaver");
    const c = await apply(b.id, b.v1, leaver, leaver);
    await pool.query("delete from public.company_members where user_id = $1", [leaver]);
    await pool.query("delete from auth.users where id = $1", [leaver]);
    const row = (await pool.query("select signer_id, signer_name, credential_id from public.contractor_signatures where id = $1", [c.id])).rows[0];
    expect(row).toMatchObject({ signer_id: null, signer_name: "Lee Leaver", credential_id: null });
  });
});
