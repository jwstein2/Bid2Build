// Creates a throwaway Postgres database with the Supabase stubs + every migration, for the Complimentary
// Access browser walk. Prints its URL. Usage: scripts/test-db.sh start && node scripts/complimentary/setup-db.mjs
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const { Client } = createRequire(import.meta.url)("pg");
const ROOT = path.resolve(import.meta.dirname, "../..");
const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";
const NAME = "b2b_comp_walk";
const a = new Client({ connectionString: ADMIN_URL }); await a.connect();
await a.query(`drop database if exists ${NAME} with (force)`); await a.query(`create database ${NAME}`); await a.end();
const url = ADMIN_URL.replace(/\/[^/]*$/, `/${NAME}`);
const c = new Client({ connectionString: url }); await c.connect();
await c.query(fs.readFileSync(path.join(ROOT, "supabase/tests/00_stub_supabase.sql"), "utf8"));
const dir = path.join(ROOT, "supabase/migrations");
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) await c.query(fs.readFileSync(path.join(dir, f), "utf8"));
// The mock Supabase's signed-in user (scripts/ux-audit/mock-supabase.mjs) is the platform admin here.
await c.query("insert into auth.users (id, email, email_confirmed_at, last_sign_in_at) values ('00000000-0000-4000-8000-000000000001', 'ux-test@built2bid.test', now() - interval '30 days', now())");
await c.query("insert into public.admin_roles (user_id, role) values ('00000000-0000-4000-8000-000000000001', 'admin')");
await c.query("insert into auth.users (email, email_confirmed_at, last_sign_in_at) values ('existing@demo.test', now() - interval '60 days', now() - interval '2 days'), ('payer@demo.test', now() - interval '90 days', now() - interval '1 day')");
await c.query("insert into public.business_profiles (user_id, company_name) select id, 'Summit Roofing' from auth.users where email = 'existing@demo.test'");
await c.query(`select public.apply_subscription_update(id, 'cus_payer', 'sub_payer', 'active', 'annual', 'price_y', now() + interval '200 days', false, null, null, now()) from auth.users where email = 'payer@demo.test'`);
await c.end();
console.log(url);
