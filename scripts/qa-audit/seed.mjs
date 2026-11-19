// QA audit seed: creates synthetic users in a LOCAL Supabase stack (never production).
// Usage: SUPABASE_URL=http://127.0.0.1:54321 SERVICE_KEY=... DB_URL=postgresql://... node scripts/qa-audit/seed.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg = require("pg");
const URL_ = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const KEY = process.env.SERVICE_KEY;
const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!/127\.0\.0\.1|localhost/.test(URL_ + DB)) throw new Error("refusing: seed only runs against a local stack");

export const USERS = {
  owner: "qa-owner@audit.test",
  free: "qa-free@audit.test",
  pro: "qa-pro@audit.test",
  entOwner: "qa-ent-owner@audit.test",
  entEstimator: "qa-ent-estimator@audit.test",
  rep1: "qa-rep1@audit.test",
  rep2: "qa-rep2@audit.test",
  salesAdmin: "qa-sales-admin@audit.test",
  outsider: "qa-outsider@audit.test",
};

async function ensureUser(email) {
  const h = { apikey: KEY, Authorization: `Bearer ${KEY}`, "content-type": "application/json" };
  const r = await fetch(`${URL_}/auth/v1/admin/users`, { method: "POST", headers: h, body: JSON.stringify({ email, email_confirm: true }) });
  if (r.ok) return (await r.json()).id;
  const list = await (await fetch(`${URL_}/auth/v1/admin/users?per_page=1000`, { headers: h })).json();
  const u = list.users.find((x) => x.email === email);
  if (!u) throw new Error(`could not create ${email}: ${r.status} ${await r.text()}`);
  return u.id;
}

const ids = {};
for (const [k, e] of Object.entries(USERS)) ids[k] = await ensureUser(e);
const c = new pg.Client({ connectionString: DB }); await c.connect();
await c.query("insert into public.admin_roles (user_id, role) values ($1, 'admin') on conflict do nothing", [ids.owner]);
await c.end();
console.log(JSON.stringify(ids, null, 2));
