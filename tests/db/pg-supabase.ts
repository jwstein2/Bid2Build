import type { Pool } from "pg";
import pg from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A tiny stand-in for the Supabase service-role client that runs the query builder calls the trial
 * service uses (select/update/upsert with eq/in/lt/lte/gte/is filters, order, limit, single,
 * maybeSingle, rpc) as real SQL against the test database. Lets the TypeScript service and the
 * migration be tested together. Test-only.
 */
pg.types.setTypeParser(1184, (v: string) => new Date(v).toISOString()); // timestamptz -> ISO string, like PostgREST

type Op = { kind: "select" | "update" | "upsert"; cols: string; patch?: Record<string, unknown>; onConflict?: string; ignore?: boolean };

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`bad identifier ${s}`);
  return `"${s}"`;
};
const colList = (cols: string) => (cols.trim() === "*" ? "*" : cols.split(",").map((c) => ident(c.trim())).join(", "));

export function pgSupabase(pool: Pool): SupabaseClient {
  function from(table: string) {
    const where: string[] = [];
    const params: unknown[] = [];
    let op: Op = { kind: "select", cols: "*" };
    let returning: string | null = null;
    let order = "";
    let limit = "";
    let mode: "many" | "single" | "maybe" = "many";
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    const filt = (sql: (c: string) => string) => (k: string, ...rest: unknown[]) => { void rest; where.push(sql(ident(k))); return q; };

    async function run() {
      try {
        let sql: string;
        const w = where.length ? ` where ${where.join(" and ")}` : "";
        if (op.kind === "select") {
          sql = `select ${colList(op.cols)} from public.${ident(table)}${w}${order}${limit}`;
        } else if (op.kind === "update") {
          const sets = Object.entries(op.patch!).map(([k, v]) => `${ident(k)} = ${p(v)}`).join(", ");
          sql = `update public.${ident(table)} set ${sets}${w} returning ${returning ? colList(returning) : "*"}`;
        } else {
          const keys = Object.keys(op.patch!);
          const vals = keys.map((k) => p(op.patch![k]));
          const conflict = op.onConflict!.split(",").map((c) => ident(c.trim())).join(", ");
          const action = op.ignore ? "do nothing" : `do update set ${keys.map((k) => `${ident(k)} = excluded.${ident(k)}`).join(", ")}`;
          sql = `insert into public.${ident(table)} (${keys.map(ident).join(", ")}) values (${vals.join(", ")}) on conflict (${conflict}) ${action} returning ${returning ? colList(returning) : "*"}`;
        }
        const r = await pool.query(sql, params);
        if (mode === "single") return r.rows.length === 1 ? { data: r.rows[0], error: null } : { data: null, error: { code: "PGRST116", message: "not single" } };
        if (mode === "maybe") return { data: r.rows[0] ?? null, error: null };
        return { data: op.kind !== "select" && !returning ? null : r.rows, error: null };
      } catch (e) {
        const err = e as { code?: string; message?: string };
        return { data: null, error: { code: err.code, message: err.message } };
      }
    }

    const q: Record<string, unknown> = {
      select: (cols = "*") => { if (op.kind === "select") op.cols = cols; else returning = cols; return q; },
      update: (patch: Record<string, unknown>) => { op = { kind: "update", cols: "*", patch }; return q; },
      upsert: (row: Record<string, unknown>, o: { onConflict: string; ignoreDuplicates?: boolean }) => { op = { kind: "upsert", cols: "*", patch: row, onConflict: o.onConflict, ignore: o.ignoreDuplicates }; return q; },
      eq: (k: string, v: unknown) => filt((c) => `${c} = ${p(v)}`)(k),
      lt: (k: string, v: unknown) => filt((c) => `${c} < ${p(v)}`)(k),
      lte: (k: string, v: unknown) => filt((c) => `${c} <= ${p(v)}`)(k),
      gte: (k: string, v: unknown) => filt((c) => `${c} >= ${p(v)}`)(k),
      in: (k: string, v: unknown[]) => filt((c) => `${c} = any(${p(v)})`)(k),
      is: (k: string, v: null) => { void v; return filt((c) => `${c} is null`)(k); },
      order: (k: string, o?: { ascending?: boolean }) => { order = ` order by ${ident(k)} ${o?.ascending === false ? "desc" : "asc"}`; return q; },
      limit: (n: number) => { limit = ` limit ${Number(n)}`; return q; },
      single: () => { mode = "single"; return q; },
      maybeSingle: () => { mode = "maybe"; return q; },
      then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => run().then(resolve, reject),
    };
    return q;
  }

  async function rpc(name: string, args: Record<string, unknown> = {}) {
    const keys = Object.keys(args);
    try {
      const r = await pool.query(`select public.${ident(name)}(${keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(", ")}) as r`, keys.map((k) => args[k]));
      return { data: r.rows[0]?.r ?? null, error: null };
    } catch (e) {
      const err = e as { code?: string; message?: string };
      return { data: null, error: { code: err.code, message: err.message } };
    }
  }

  return { from, rpc } as unknown as SupabaseClient;
}
