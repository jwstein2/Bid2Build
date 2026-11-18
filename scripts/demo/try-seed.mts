/**
 * Local check: provision a demo workspace in a throwaway test database and apply the full dataset.
 * Usage: scripts/test-db.sh start && npx tsx scripts/demo/try-seed.ts
 */
import { freshDb, createUser } from "../../tests/db/harness";
import { buildDemoDataset } from "../../src/lib/demo/dataset";
import { applyDemoDataset } from "../../src/lib/demo/apply";
import { pgRpc } from "../../tests/db/demo-helpers";

const { pool } = await freshDb("b2b_demo_try");
const owner = await createUser(pool, "owner@built.test");
await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [owner]);
const demo = await createUser(pool, "owner-demo-1@example.com");
const ws = (await pool.query("select public.demo_provision($1, $2, 'owner_demo') as r", [owner, demo])).rows[0].r;
console.log(ws);
const d = buildDemoDataset({ kind: "owner_demo", namespace: ws.workspaceId, anchor: new Date().toISOString().slice(0, 10) });
console.time("apply");
const r = await applyDemoDataset(pgRpc(pool), ws.workspaceId, d);
console.timeEnd("apply");
console.log(r);
for (const t of ["customers", "estimates", "estimate_versions", "project_schedules", "schedule_tasks", "pm_resources", "fin_invoices", "fin_payments", "comm_messages"]) {
  console.log(t, (await pool.query(`select count(*) from public.${t}`)).rows[0].count);
}
await pool.end();
