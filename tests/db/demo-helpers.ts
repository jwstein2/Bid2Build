import type { Pool } from "pg";

/** Calls a SQL function with named arguments as the service role (what the server's service client does). */
export const pgRpc = (pool: Pool) => async (fn: string, args: Record<string, unknown>) => {
  const keys = Object.keys(args);
  const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`;
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("set local role service_role");
    const r = await c.query(sql, keys.map((k) => (args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k])));
    await c.query("commit");
    return r.rows[0]?.r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
};
