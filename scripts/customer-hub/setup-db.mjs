// Throwaway database for the Customer Hub browser walk. Reproduces the production situation found on
// 2026-11-17: bids carry the customer only as text (customer_id never set) and the customers table is empty.
//   scripts/test-db.sh start
//   export RADAR_PG_URL=$(node scripts/customer-hub/setup-db.mjs)            # after: Customer Hub migration applied (backfill ran)
//   export RADAR_PG_URL=$(node scripts/customer-hub/setup-db.mjs --before)   # before: stops before it
//   export RADAR_PG_URL=$(node scripts/customer-hub/setup-db.mjs --empty)    # empty account (PART=empty)
// Users: the mock signed-in user (same id as scripts/ux-audit/mock-supabase.mjs) and an outsider whose
// customer must never appear.
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { Client } = require("pg");
const ROOT = path.resolve(import.meta.dirname, "../..");
const ADMIN = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";
const BEFORE = process.argv.includes("--before");
const EMPTY = process.argv.includes("--empty"); // an account with no bids and no customers
const NAME = BEFORE ? "b2b_walk_customer_hub_before" : EMPTY ? "b2b_walk_customer_hub_empty" : "b2b_walk_customer_hub";
const HUB = "20261122001000_customer_hub.sql";
export const ME = "00000000-0000-4000-8000-000000000001";
const OUTSIDER = "00000000-0000-4000-8000-0000000000aa";

const a = new Client({ connectionString: ADMIN }); await a.connect();
await a.query(`drop database if exists ${NAME} with (force)`); await a.query(`create database ${NAME}`); await a.end();
const url = ADMIN.replace(/\/[^/]*$/, `/${NAME}`);
const c = new Client({ connectionString: url }); await c.connect();
await c.query(readFileSync(path.join(ROOT, "supabase/tests/00_stub_supabase.sql"), "utf8"));
const files = readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
for (const f of files.filter((f) => f < HUB)) await c.query(readFileSync(path.join(ROOT, "supabase/migrations", f), "utf8"));
await c.query("insert into auth.users (id, email, email_confirmed_at) values ($1, 'ux-test@built2bid.test', now()), ($2, 'outsider@else.test', now())", [ME, OUTSIDER]);

if (!EMPTY) {
const day = (n) => `now() - interval '${n} days'`;
await c.query("select set_config('app.stage_change', 'on', false)");
const bid = async (user, title, cust, stage, daysAgo, extra = {}) => (await c.query(
  `insert into public.estimates (user_id, title, estimate_number, trades, status, pipeline_stage, customer_name, customer_email, customer_phone, project_address, created_at, updated_at, stage_changed_at, won_at)
   values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, ${day(daysAgo + 2)}, ${day(daysAgo)}, ${day(daysAgo)}, $11) returning id`,
  [user, title, extra.number ?? "", extra.trades ?? ["siding"], extra.status ?? "draft", stage, cust.name, cust.email ?? null, cust.phone ?? null, cust.address ?? null, ["won", "scheduled", "in_progress", "completed"].includes(stage) ? new Date(Date.now() - daysAgo * 864e5) : null])).rows[0].id;
const version = (est, user, n, total) => c.query(
  `insert into public.estimate_versions (estimate_id, user_id, version_number, content_hash, snapshot, proposal, total_cost, subtotal, tax, total) values ($1, $2, $3, encode(sha256(random()::text::bytea), 'hex'), '{}', '{}', $4 * 0.7, $4, 0, $4) returning id`,
  [est, user, n, total]).then((r) => r.rows[0].id);

const pat = { name: "Pat Johnson", email: "pat@example.test", phone: "(555) 333-4444", address: "48 Oak Lane, Springfield" };
const deck = await bid(ME, "Back deck rebuild – Johnson", pat, "scheduled", 12, { number: "B-1001", trades: ["decks"], status: "finalized" });
await version(deck, ME, 1, 18450);
const siding = await bid(ME, "Siding replacement – Johnson residence", { ...pat, email: "PAT@example.test " }, "sent", 2, { number: "B-1004", status: "finalized" });
await version(siding, ME, 1, 23900);
await c.query(`insert into public.project_schedules (estimate_id, user_id, name, status, source_snapshot, calendar, start_date, updated_at)
  values ($1, $2, 'Johnson back deck', 'active', '{}', '{"workdays":[1,2,3,4,5]}', current_date + 3, ${day(1)})`, [deck, ME]);
const lee = await bid(ME, "Roof replacement – Lee", { name: "Morgan Lee", email: "morgan.lee@example.test", address: "9 Pine Rd" }, "won", 4, { number: "B-1003", trades: ["roofing"], status: "finalized" });
await version(lee, ME, 1, 31200);
await bid(ME, "Kitchen remodel – Ortiz-Washington", { name: "Sam Ortiz-Washington", address: "77 Harbor View Dr" }, "draft", 8, { number: "B-1002", trades: ["kitchen-remodeling"] });
const garage = await bid(ME, "Garage slab – Rivera", { name: "Chris Rivera", phone: "555-010-7788" }, "draft", 5, { number: "B-1005", trades: ["concrete"], status: "finalized" });
await version(garage, ME, 1, 9600);
await bid(ME, "Fence repair – Smith", { name: "John Smith", address: "12 Elm St" }, "completed", 40, { number: "B-0990", trades: ["fencing"], status: "finalized" });
await bid(ME, "Gutter guards – Smith", { name: "John Smith", address: "301 Lakeview Ave" }, "lost", 25, { number: "B-0995", trades: ["gutters"], status: "finalized" });
await bid(ME, "Untitled bid", { name: "" }, "draft", 1);
// Another contractor's customer: must never be visible to the mock user.
await bid(OUTSIDER, "Outsider bid", { name: "Secret Customer", email: "secret@else.test" }, "sent", 3);
await c.query("select set_config('app.stage_change', '', false)");

}

if (!BEFORE) for (const f of files.filter((f) => f >= HUB)) await c.query(readFileSync(path.join(ROOT, "supabase/migrations", f), "utf8"));
await c.end();
console.log(url);
