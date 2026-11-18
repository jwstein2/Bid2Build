// Throwaway Postgres database for the Industry News browser walk (V6.8): Supabase stubs, every migration, the
// mock signed-in user, and articles ingested through the real pipeline from the MOCKED feeds in
// tests/fixtures/news-feeds.ts (no network). Test data only; never point this at production.
// Usage: scripts/test-db.sh start && export RADAR_PG_URL=$(npx tsx --conditions react-server scripts/industry-news/setup-db.mts)
import fs from "node:fs";
import path from "node:path";
import { Client, Pool } from "pg";
import { pgSupabase } from "../../tests/db/pg-supabase";
import { supabaseNewsStore } from "@/lib/news/store";
import { runIngest, type FetchLike } from "@/lib/news/ingest";
import { newsSource } from "@/lib/news/sources";
import { ACHR_RSS, FEMA_JSON, FR_JSON, OSHA_RSS } from "../../tests/fixtures/news-feeds";

const ROOT = path.resolve(import.meta.dirname, "../..");
const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";
const NAME = "b2b_industry_news_walk";
const USER = "00000000-0000-4000-8000-000000000001";

const a = new Client({ connectionString: ADMIN_URL }); await a.connect();
await a.query(`drop database if exists ${NAME} with (force)`); await a.query(`create database ${NAME}`); await a.end();
const url = ADMIN_URL.replace(/\/[^/]*$/, `/${NAME}`);
const c = new Client({ connectionString: url }); await c.connect();
await c.query(fs.readFileSync(path.join(ROOT, "supabase/tests/00_stub_supabase.sql"), "utf8"));
const dir = path.join(ROOT, "supabase/migrations");
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) await c.query(fs.readFileSync(path.join(dir, f), "utf8"));
await c.query("insert into auth.users (id, email, email_confirmed_at) values ($1, 'ux-test@built2bid.test', now())", [USER]);
await c.query("insert into public.news_user_prefs (user_id, followed_trades, service_counties) values ($1, '{roofing,hvac}', '{bay}')", [USER]);
await c.end();

const pool = new Pool({ connectionString: url, max: 4 });
const bodies: Record<string, string> = {
  "achrnews.com": ACHR_RSS, "osha.gov": OSHA_RSS, "federalregister.gov": JSON.stringify(FR_JSON), "fema.gov": JSON.stringify(FEMA_JSON),
};
const fetchImpl: FetchLike = async (u) => {
  const key = Object.keys(bodies).find((k) => u.includes(k));
  return { status: key ? 200 : 404, headers: { get: () => null }, text: async () => (key ? bodies[key] : "") };
};
const reports = await runIngest(supabaseNewsStore(pgSupabase(pool)), {
  fetchImpl, force: true, sources: ["achr-news", "osha-news", "fr-osha", "fema-declarations"].map((k) => newsSource(k)!),
});
console.error(JSON.stringify(reports));
await pool.end();
console.log(url);
