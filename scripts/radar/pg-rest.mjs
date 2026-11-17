// Minimal PostgREST stand-in for the Opportunity Radar browser walk: translates supabase-js requests on
// radar_* tables (and the radar_* RPCs) into SQL against a throwaway test database, so the real
// migration, triggers and two-reply cap run end to end. Test tooling only. Never point production at it.
import pg from "pg";

const ID = /^[a-z_][a-z0-9_]*$/;
let pool = null;
let types = null;

export function radarRestEnabled() { return Boolean(process.env.RADAR_PG_URL); }
/** Table/RPC prefixes served from the test database (PG_REST_PREFIXES=radar_,bid_check_,trial_). */
export const PREFIXES = (process.env.PG_REST_PREFIXES ?? "radar_").split(",").map((s) => s.trim()).filter((s) => /^[a-z_]+$/.test(s));
export const pgRestPath = new RegExp(`^/rest/v1/(rpc/)?(${PREFIXES.join("|")})`);

async function columnTypes() {
  if (types) return types;
  pool ??= new pg.Pool({ connectionString: process.env.RADAR_PG_URL, max: 5 });
  const r = await pool.query("select table_name, column_name, data_type from information_schema.columns where table_schema = 'public' and table_name like any($1)", [PREFIXES.map((p) => `${p}%`)]);
  types = {};
  for (const x of r.rows) (types[x.table_name] ??= {})[x.column_name] = x.data_type;
  return types;
}

/**
 * PG_REST_AS_USER=<auth user id>: every request runs as that signed-in user (role authenticated, RLS on),
 * like real PostgREST. Without it requests run as the database owner (the radar / bid check walks).
 */
async function exec(sql, params) {
  const asUser = process.env.PG_REST_AS_USER;
  if (!asUser) return pool.query(sql, params);
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [asUser]);
    const r = await c.query(sql, params);
    await c.query("commit");
    return r;
  } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}

const fail = (send, res, e) => send(res, 400, { code: e.code ?? "P0001", message: e.message, details: null, hint: null });

function filters(u, params, tableTypes) {
  const where = [];
  for (const [k, v] of u.searchParams) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(k)) continue;
    if (!ID.test(k) || !(k in tableTypes)) throw Object.assign(new Error(`unknown column ${k}`), { code: "42703" });
    const m = v.match(/^(eq|neq|gte|lte|gt|lt|is|in)\.(.*)$/s);
    if (!m) continue;
    const [, op, val] = m;
    if (op === "is") { where.push(`${k} is ${val === "null" ? "null" : val === "true" ? "true" : "false"}`); continue; }
    if (op === "in") {
      const items = val.replace(/^\(|\)$/g, "").split(",").map((s) => s.replace(/^"|"$/g, ""));
      params.push(items); where.push(`${k}::text = any($${params.length})`); continue;
    }
    const sqlOp = { eq: "=", neq: "<>", gte: ">=", lte: "<=", gt: ">", lt: "<" }[op];
    params.push(val); where.push(`${k}::text ${sqlOp} $${params.length}::text`);
    if (op !== "eq" && op !== "neq") { where.pop(); where.push(`${k} ${sqlOp} $${params.length}`); }
  }
  return where.length ? ` where ${where.join(" and ")}` : "";
}

function selectList(u) {
  const s = u.searchParams.get("select") ?? "*";
  if (s === "*") return "*";
  const cols = s.split(",").map((c) => c.trim());
  // JSON paths like snapshot->business->>logoPath come back under the last key, as in PostgREST.
  const JSONPATH = /^[a-z_][a-z0-9_]*(->>?[A-Za-z_][A-Za-z0-9_]*)+$/;
  if (!cols.every((c) => ID.test(c) || JSONPATH.test(c))) throw new Error("bad select");
  return cols.map((c) => (ID.test(c) ? c : `${c.replace(/(->>?)([A-Za-z0-9_]+)/g, "$1'$2'")} as "${c.split(/->>?/).at(-1)}"`)).join(", ");
}

const val = (type, v) => (v !== null && typeof v === "object" && (type === "jsonb" || type === "json") ? JSON.stringify(v) : v);

export async function handleRadarRest(req, res, u, raw, send) {
  const t = await columnTypes();
  const rpc = u.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
  try {
    if (rpc) {
      const args = JSON.parse(raw || "{}");
      const keys = Object.keys(args).filter((k) => ID.test(k));
      const call = `public.${rpc[1]}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`;
      const vals = keys.map((k) => (args[k] !== null && typeof args[k] === "object" && !Array.isArray(args[k]) ? JSON.stringify(args[k]) : args[k]));
      // Functions returning a table/record come back as rows, like PostgREST; scalars and jsonb as the value.
      const kind = (await pool.query("select bool_or(p.proretset or p.prorettype = 'record'::regtype or t.typtype = 'c') as rows from pg_proc p join pg_type t on t.oid = p.prorettype where p.pronamespace = 'public'::regnamespace and p.proname = $1", [rpc[1]])).rows[0]?.rows;
      if (kind) return send(res, 200, (await exec(`select * from ${call}`, vals)).rows);
      const r = await exec(`select ${call} as v`, vals);
      return send(res, 200, r.rows[0].v);
    }
    const table = u.pathname.match(/^\/rest\/v1\/(\w+)$/)?.[1];
    if (!table || !t[table]) return send(res, 404, { message: "unknown radar table" });
    const tt = t[table];
    const one = (req.headers.accept ?? "").includes("vnd.pgrst.object");
    const params = [];
    const reply = (rows) => (one ? (rows.length ? send(res, 200, rows[0]) : send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" })) : send(res, req.method === "POST" ? 201 : 200, rows, { "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}` }));

    if (req.method === "GET" || req.method === "HEAD") {
      const where = filters(u, params, tt);
      // supabase-js { count: "exact", head: true }: HEAD with Prefer count=exact, total in Content-Range.
      if ((req.headers.prefer ?? "").includes("count=exact")) {
        const n = Number((await exec(`select count(*) as n from public.${table}${where}`, params)).rows[0].n);
        if (req.method === "HEAD") { res.writeHead(200, { "content-range": `*/${n}` }); return void res.end(); }
      }
      let sql = `select ${selectList(u)} from public.${table}${where}`;
      const order = u.searchParams.get("order");
      if (order) sql += ` order by ${order.split(",").map((o) => { const [c, dir] = o.split("."); if (!ID.test(c)) throw new Error("bad order"); return `${c} ${dir === "desc" ? "desc" : "asc"}`; }).join(", ")}`;
      const limit = Number(u.searchParams.get("limit") ?? 0);
      if (limit) sql += ` limit ${Math.min(limit, 10000)}`;
      return reply((await exec(sql, params)).rows);
    }
    const body = JSON.parse(raw || "null");
    const ret = u.searchParams.get("select") ? ` returning ${selectList(u)}` : " returning *";
    if (req.method === "POST") {
      const rows = (Array.isArray(body) ? body : [body]).filter(Boolean);
      const out = [];
      const upsert = (req.headers.prefer ?? "").includes("merge-duplicates");
      const ignore = (req.headers.prefer ?? "").includes("ignore-duplicates");
      const conflict = u.searchParams.get("on_conflict");
      for (const r of rows) {
        const cols = Object.keys(r).filter((c) => ID.test(c) && c in tt);
        const p = cols.map((c) => val(tt[c], r[c]));
        let sql = `insert into public.${table} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`;
        if (ignore && conflict && conflict.split(",").every((c) => ID.test(c))) sql += ` on conflict (${conflict}) do nothing`;
        else if (upsert && conflict && ID.test(conflict)) sql += ` on conflict (${conflict}) do update set ${cols.filter((c) => c !== conflict).map((c) => `${c} = excluded.${c}`).join(", ")}`;
        out.push(...(await exec(sql + ret, p)).rows);
      }
      return reply(out);
    }
    if (req.method === "PATCH") {
      const cols = Object.keys(body ?? {}).filter((c) => ID.test(c) && c in tt);
      for (const c of cols) params.push(val(tt[c], body[c]));
      const set = cols.map((c, i) => `${c} = $${i + 1}`).join(", ");
      return reply((await exec(`update public.${table} set ${set}${filters(u, params, tt)}${ret}`, params)).rows);
    }
    if (req.method === "DELETE") return reply((await exec(`delete from public.${table}${filters(u, params, tt)}${ret}`, params)).rows);
    return send(res, 405, { message: "method not supported" });
  } catch (e) {
    return fail(send, res, e);
  }
}
