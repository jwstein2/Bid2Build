// Throwaway database for the V8.9 sales-invite + V8.10 workspace walk (real migrations, functions, RLS).
//   scripts/test-db.sh start
//   export RADAR_PG_URL=$(node scripts/sales-invite/setup-db.mjs)
// The mock's signed-in user (id ...0001) is the invited rep. The owner exists separately.
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { Client } = require("pg");
const ROOT = path.resolve(import.meta.dirname, "../..");
const ADMIN = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";
const NAME = "b2b_walk_sales_invite";
const ME = "00000000-0000-4000-8000-000000000001";
export const TOKENS = { main: "J".repeat(43), expired: "E".repeat(43), revoked: "R".repeat(43) };
const hash = (t) => createHash("sha256").update(t).digest("hex");

const a = new Client({ connectionString: ADMIN }); await a.connect();
await a.query(`drop database if exists ${NAME} with (force)`); await a.query(`create database ${NAME}`); await a.end();
const url = ADMIN.replace(/\/[^/]*$/, `/${NAME}`);
const c = new Client({ connectionString: url }); await c.connect();
await c.query(readFileSync(path.join(ROOT, "supabase/tests/00_stub_supabase.sql"), "utf8"));
for (const f of readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort()) {
  await c.query(readFileSync(path.join(ROOT, "supabase/migrations", f), "utf8"));
}
const one = async (sql, p = []) => Object.values((await c.query(sql, p)).rows[0])[0];
const owner = await one("insert into auth.users (email, email_confirmed_at) values ('owner@built2bid.org', now()) returning id");
await c.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [owner]);
// The rep's account: a brand-new verified account (no bids yet), same email as the invite.
await c.query("insert into auth.users (id, email, email_confirmed_at, created_at) values ($1, 'ux-test@built2bid.test', now(), now())", [ME]);
const save = async (email, name) => (await one("select public.admin_sales_member_save($1, null, $2, $3, null, 'rep', 'invited', null, true)", [owner, email, name])).id;
const josiah = await save("ux-test@built2bid.test", "Josiah Greene");
await c.query("select public.admin_sales_invite_create($1, $2, $3, 14)", [owner, josiah, hash(TOKENS.main)]);
const exp = await save("late@sales.example", "Late Rep");
await c.query("select public.admin_sales_invite_create($1, $2, $3, 14)", [owner, exp, hash(TOKENS.expired)]);
await c.query("update public.sales_rep_invites set expires_at = now() - interval '1 day' where token_hash = $1", [hash(TOKENS.expired)]);
const rev = await save("replaced@sales.example", "Replaced Rep");
await c.query("select public.admin_sales_invite_create($1, $2, $3, 14)", [owner, rev, hash(TOKENS.revoked)]);
await c.query("select public.admin_sales_invite_revoke($1, $2)", [owner, rev]);
await c.end();
console.log(url);
