// Throwaway Postgres database for the universal search browser walk (V6.4): Supabase stubs, every migration, and the
// shared search demo world (scripts/universal-search/seed.mjs), created through the real SQL functions.
// Usage: scripts/test-db.sh start && export RADAR_PG_URL=$(node scripts/universal-search/setup-db.mjs)
// Prints the database URL. Test data only (.test addresses); never point this at production.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { seedSearchWorld } from "./seed.mjs";
const { Client, Pool } = createRequire(import.meta.url)("pg");
const ROOT = path.resolve(import.meta.dirname, "../..");
const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";
const NAME = "b2b_universal_search_walk";

const a = new Client({ connectionString: ADMIN_URL }); await a.connect();
await a.query(`drop database if exists ${NAME} with (force)`); await a.query(`create database ${NAME}`); await a.end();
const url = ADMIN_URL.replace(/\/[^/]*$/, `/${NAME}`);
const c = new Client({ connectionString: url }); await c.connect();
await c.query(fs.readFileSync(path.join(ROOT, "supabase/tests/00_stub_supabase.sql"), "utf8"));
const dir = path.join(ROOT, "supabase/migrations");
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) await c.query(fs.readFileSync(path.join(dir, f), "utf8"));
await c.end();
const pool = new Pool({ connectionString: url, max: 4 });
const w = await seedSearchWorld(pool, { bulk: false });
fs.writeFileSync(process.env.SEARCH_WORLD_FILE ?? "/tmp/search-world.json", JSON.stringify(w));
await pool.end();
console.log(url);
