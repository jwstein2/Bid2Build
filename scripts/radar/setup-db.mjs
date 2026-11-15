// Throwaway Postgres database (Supabase stubs + every migration) for the Opportunity Radar browser walk.
// Usage: scripts/test-db.sh start && node scripts/radar/setup-db.mjs   (prints the database URL)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const { Client } = createRequire(import.meta.url)("pg");
const ROOT = path.resolve(import.meta.dirname, "../..");
const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";
const NAME = "b2b_radar_walk";
const a = new Client({ connectionString: ADMIN_URL }); await a.connect();
await a.query(`drop database if exists ${NAME} with (force)`); await a.query(`create database ${NAME}`); await a.end();
const url = ADMIN_URL.replace(/\/[^/]*$/, `/${NAME}`);
const c = new Client({ connectionString: url }); await c.connect();
await c.query(fs.readFileSync(path.join(ROOT, "supabase/tests/00_stub_supabase.sql"), "utf8"));
const dir = path.join(ROOT, "supabase/migrations");
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) await c.query(fs.readFileSync(path.join(dir, f), "utf8"));
await c.query("insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-4000-8000-000000000001', 'ux-test@built2bid.test', now())");
await c.end();
console.log(url);
