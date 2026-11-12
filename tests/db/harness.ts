import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client, Pool } from "pg";

const ROOT = path.resolve(import.meta.dirname, "../..");
const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";

export async function dbAvailable(): Promise<boolean> {
  const c = new Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 1500 });
  try { await c.connect(); await c.end(); return true; } catch { return false; }
}

/** Create a fresh database with Supabase stubs + all migrations applied. */
export async function freshDb(name: string): Promise<{ pool: Pool; url: string; drop: () => Promise<void> }> {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();
  const url = ADMIN_URL.replace(/\/[^/]*$/, `/${name}`);
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query(readFileSync(path.join(ROOT, "supabase/tests/00_stub_supabase.sql"), "utf8"));
  const dir = path.join(ROOT, "supabase/migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    try { await c.query(readFileSync(path.join(dir, f), "utf8")); }
    catch (e) { throw new Error(`Migration ${f} failed: ${(e as Error).message}`); }
  }
  const seed = path.join(ROOT, "supabase/seed.sql");
  try { await c.query(readFileSync(seed, "utf8")); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  await c.end();
  const pool = new Pool({ connectionString: url, max: 20 });
  return {
    pool, url,
    drop: async () => {
      await pool.end();
      const a = new Client({ connectionString: ADMIN_URL });
      await a.connect();
      await a.query(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}

export async function createUser(pool: Pool, email: string, verified = true): Promise<string> {
  const r = await pool.query(
    "insert into auth.users (email, email_confirmed_at) values ($1, $2) returning id",
    [email, verified ? new Date() : null],
  );
  return r.rows[0].id;
}

/** Run queries as an authenticated end user, with RLS enforced. */
export async function asUser<T>(pool: Pool, userId: string, fn: (q: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    const out = await fn((sql, params) => client.query(sql, params as any[]) as any);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
