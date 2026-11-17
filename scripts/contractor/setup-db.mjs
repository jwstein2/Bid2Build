// Throwaway Postgres database for the contractor-signature browser walk (V5.3): Supabase stubs, every
// migration, and test-only bids in each signing state, created through the real SQL functions.
// Usage: scripts/test-db.sh start && npx tsx scripts/esign/fixture.ts > /tmp/esign-fixture.json && node scripts/contractor/setup-db.mjs /tmp/esign-fixture.json
// Prints the database URL. Test data only (example.test addresses); never point this at production.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const { Client } = createRequire(import.meta.url)("pg");
const ROOT = path.resolve(import.meta.dirname, "../..");
const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";
const NAME = "b2b_contractor_walk";
const fixture = JSON.parse(fs.readFileSync(process.argv[2] ?? "/tmp/esign-fixture.json", "utf8"));

const a = new Client({ connectionString: ADMIN_URL }); await a.connect();
await a.query(`drop database if exists ${NAME} with (force)`); await a.query(`create database ${NAME}`); await a.end();
const url = ADMIN_URL.replace(/\/[^/]*$/, `/${NAME}`);
const c = new Client({ connectionString: url }); await c.connect();
await c.query(fs.readFileSync(path.join(ROOT, "supabase/tests/00_stub_supabase.sql"), "utf8"));
const dir = path.join(ROOT, "supabase/migrations");
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) await c.query(fs.readFileSync(path.join(dir, f), "utf8"));

const h = (s) => createHash("sha256").update(s).digest("hex");
const OWNER = "00000000-0000-4000-8000-000000000001"; // the mock's signed-in user
const REP = "00000000-0000-4000-8000-000000000002";
const E = (n) => `11111111-1111-4111-8111-11111111111${n}`;
const V = (n) => `44444444-4444-4444-8444-00000000000${n}`;
const future = new Date(Date.now() + 30 * 864e5).toISOString();
const asUser = async (u, sql, params) => {
  await c.query("begin"); await c.query("set local role authenticated"); await c.query("select set_config('request.jwt.claim.sub', $1, true)", [u]);
  try { const r = await c.query(sql, params); await c.query("commit"); return r; } catch (e) { await c.query("rollback"); throw e; }
};

await c.query("insert into auth.users (id, email, email_confirmed_at) values ($1, 'ux-test@built2bid.test', now()), ($2, 'riley@summit.test', now())", [OWNER, REP]);
const company = (await c.query("select public.create_company($1, 'Summit Exteriors LLC') as id", [OWNER])).rows[0].id;
await c.query("select public.apply_subscription_update(p_user_id => $1::uuid, p_stripe_customer_id => 'cus_walk', p_stripe_subscription_id => 'sub_walk', p_status => 'active', p_plan => 'enterprise', p_price_id => 'p', p_current_period_end => '2099-01-01', p_cancel_at_period_end => false, p_canceled_at => null, p_ended_at => null, p_event_created => now(), p_company_id => $2::uuid, p_seat_quantity => 5)", [OWNER, company]);
const tok = (await asUser(OWNER, "select token from public.create_company_invitation('riley@summit.test', 'estimator')")).rows[0].token;
await asUser(REP, "select public.accept_company_invitation($1)", [tok]);
await c.query("update public.company_members set display_name = case when user_id = $1 then 'Alex Rivera' else 'Riley Brooks' end where company_id = $2", [OWNER, company]);

const docs = {
  1: fixture.pendingDoc,
  2: fixture.signedDoc,
  4: { ...fixture.signedDoc, meta: { ...fixture.signedDoc.meta, title: "Roof repair – Chen", number: "B-1001" }, customer: { ...fixture.signedDoc.customer, name: "Lin Chen" } },
  5: { ...fixture.signedDoc, meta: { ...fixture.signedDoc.meta, title: "Fence install – Garcia", number: "B-0999" }, customer: { ...fixture.signedDoc.customer, name: "Maria Garcia" } },
};
const titles = { 1: ["Siding replacement – Johnson residence", "Pat Johnson"], 2: ["Deck rebuild – Lee", "Morgan Lee"], 4: ["Roof repair – Chen", "Lin Chen"], 5: ["Fence install – Garcia", "Maria Garcia"] };
for (const n of [1, 2, 4, 5]) {
  await asUser(OWNER, "insert into public.estimates (id, user_id, title, customer_name) values ($1, $2, $3, $4)", [E(n), OWNER, ...titles[n]]);
  await c.query("insert into public.estimate_versions (id, estimate_id, user_id, version_number, content_hash, snapshot, proposal, total_cost, subtotal, tax, total) values ($1, $2, $3, 1, $4, '{\"business\":{}}', $5, 1, 17985, 0, 17985)", [V(n), E(n), OWNER, h(`v${n}`), docs[n]]);
  await c.query("update public.estimates set status = 'finalized' where id = $1", [E(n)]);
}
const link = async (n, token) => {
  const r = (await c.query("select * from public.create_signing_request($1, $2, $3, $4, $5, $6)", [OWNER, E(n), V(n), h(token), h(`doc${n}`), future])).rows[0];
  await c.query("select * from public.contractor_record_requirement($1, $2)", [r.id, OWNER]);
  return r;
};
const accept = async (token, name) => {
  const row = (await c.query("select * from public.accept_signing_request($1, $2, 'customer@example.test', 'typed', $2, null, 'esign-consent-2026-11-15', 'I agree to use electronic records and signatures.', 'I accept this proposal.', now(), '203.0.113.9', 'Mozilla/5.0 (iPhone)')", [h(token), name])).rows[0];
  await c.query("select public.contractor_after_customer_signed($1)", [row.signature_id]);
  return row.signature_id;
};

// Roof repair – Chen: signed before contractor signatures existed (no requirement row) = historical.
const old = (await c.query("select * from public.create_signing_request($1, $2, $3, $4, $5, $6)", [OWNER, E(4), V(4), h("roof-token"), h("doc4"), future])).rows[0];
const oldSig = (await c.query("select * from public.accept_signing_request($1, 'Lin Chen', 'lin@example.test', 'typed', 'Lin Chen', null, 'esign-consent-2026-11-15', 'I agree to use electronic records and signatures.', 'I accept this proposal.', now() - interval '3 days', '203.0.113.20', 'Mozilla/5.0')", [h("roof-token")])).rows[0];
void old; void oldSig;

// Deck rebuild – Lee: default policy (manual countersign), customer signs first -> Awaiting Contractor Signature.
await link(2, "deck-token");
await accept("deck-token", "John Smith");

// The owner adopts a signature with automatic application, then the company turns on Mode A, before sending.
await c.query("select * from public.contractor_adopt_credential($1, 'Alex Rivera', 'Owner', 'typed', 'Alex Rivera', null, null, 'contractor-adopt-2026-11-17', 'I adopt this signature', 'I authorize automatic application', $2, '198.51.100.7', 'Mozilla/5.0')", [OWNER, { method: "recent_sign_in", authenticatedAt: new Date().toISOString() }]);
await c.query("select * from public.contractor_save_policy($1, $2, $3)", [OWNER, company, { mode: "company_signer", defaultSignerId: OWNER, autoApplyAllowed: true, autoApplyTiming: "before_send", repSignaturesAllowed: false, required: true }]);

// Fence install – Garcia: contractor signature applied automatically before sending, then customer signs = fully executed.
await c.query("select * from public.contractor_apply_signature($1, $2, $3, $4, 'auto_policy', 'signing_link_created', null, null, null, null)", [E(5), V(5), OWNER, OWNER]);
await link(5, "fence-token");
await accept("fence-token", "Maria Garcia");

// Siding – Johnson: contractor signed first (auto), customer link still open (the walk signs it as the customer).
await c.query("select * from public.contractor_apply_signature($1, $2, $3, $4, 'auto_policy', 'signing_link_created', null, null, null, null)", [E(1), V(1), OWNER, OWNER]);
await link(1, "walkTokenAbcdefghijklmnopqrstuvwxyz01234567");

await c.end();
console.log(url);
