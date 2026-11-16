// Fresh throwaway database for the bid check browser walk: Supabase stubs + every migration, plus the
// mock signed-in user (same id and email as scripts/ux-audit/mock-supabase.mjs). Prints its URL.
//   scripts/test-db.sh start && export RADAR_PG_URL=$(node scripts/bid-check/setup-db.mjs)
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { Client } = require("pg");
const ROOT = path.resolve(import.meta.dirname, "../..");
const ADMIN = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";
const NAME = "b2b_walk_bid_check";
const a = new Client({ connectionString: ADMIN }); await a.connect();
await a.query(`drop database if exists ${NAME} with (force)`); await a.query(`create database ${NAME}`); await a.end();
const url = ADMIN.replace(/\/[^/]*$/, `/${NAME}`);
const c = new Client({ connectionString: url }); await c.connect();
await c.query(readFileSync(path.join(ROOT, "supabase/tests/00_stub_supabase.sql"), "utf8"));
for (const f of readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort()) await c.query(readFileSync(path.join(ROOT, "supabase/migrations", f), "utf8"));
await c.query("insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-4000-8000-000000000001', 'ux-test@built2bid.test', now())");
await c.end();
console.log(url);
