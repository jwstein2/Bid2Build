/**
 * A tiny in-memory stand-in for the subset of supabase-js used by the creator outreach runner.
 * Supports: from().select(cols, {count, head}) / insert / update / upsert, filters eq, neq, is, in, lt,
 * lte, gte, or("a.is.null,a.lte.X"), order, limit, maybeSingle; rpc() via handlers. Unique checks are
 * supplied per table so tests catch double inserts.
 */
type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

export class MemoryDb {
  tables: Record<string, Row[]> = {};
  unique: Record<string, (a: Row, b: Row) => boolean> = {};
  rpcs: Record<string, (args: Record<string, unknown>) => unknown> = {};
  private seq = 0;
  id() { return `00000000-0000-4000-8000-${String(++this.seq).padStart(12, "0")}`; }
  t(name: string) { return (this.tables[name] ??= []); }
  from(name: string) { return new Query(this, name); }
  async rpc(name: string, args: Record<string, unknown>) { return { data: await this.rpcs[name]?.(args) ?? null, error: null }; }
}

const cmp = (a: unknown, b: unknown) => (a == null ? -1 : b == null ? 1 : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);

class Query {
  private filters: Filter[] = [];
  private op: "select" | "insert" | "update" | "upsert" = "select";
  private payload: Row | Row[] | null = null;
  private orders: { col: string; asc: boolean }[] = [];
  private lim = Infinity;
  private returning = false;
  private countMode = false;
  private head = false;
  private single = false;
  private upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  constructor(private db: MemoryDb, private table: string) {}
  select(_cols?: string, opts?: { count?: string; head?: boolean }) { if (this.op === "select") { this.countMode = Boolean(opts?.count); this.head = Boolean(opts?.head); } else this.returning = true; return this; }
  insert(p: Row | Row[]) { this.op = "insert"; this.payload = p; return this; }
  update(p: Row) { this.op = "update"; this.payload = p; return this; }
  upsert(p: Row | Row[], o: { onConflict?: string; ignoreDuplicates?: boolean } = {}) { this.op = "upsert"; this.payload = p; this.upsertOpts = o; return this; }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
  neq(c: string, v: unknown) { this.filters.push((r) => r[c] !== v); return this; }
  is(c: string, v: null) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
  in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  lt(c: string, v: unknown) { this.filters.push((r) => r[c] != null && cmp(r[c], v) < 0); return this; }
  lte(c: string, v: unknown) { this.filters.push((r) => r[c] != null && cmp(r[c], v) <= 0); return this; }
  gte(c: string, v: unknown) { this.filters.push((r) => r[c] != null && cmp(r[c], v) >= 0); return this; }
  or(expr: string) {
    const parts = expr.split(",").map((p) => { const [c, op, ...rest] = p.split("."); return { c, op, v: rest.join(".") }; });
    this.filters.push((r) => parts.some(({ c, op, v }) => (op === "is" ? (r[c] ?? null) === null : op === "lte" ? r[c] != null && cmp(r[c], v) <= 0 : false)));
    return this;
  }
  order(col: string, o: { ascending?: boolean } = {}) { this.orders.push({ col, asc: o.ascending !== false }); return this; }
  limit(n: number) { this.lim = n; return this; }
  maybeSingle() { this.single = true; return this; }
  then<T>(res: (v: { data: unknown; error: { message: string; code?: string } | null; count?: number }) => T, rej?: (e: unknown) => T) {
    try { return Promise.resolve(this.run()).then(res, rej); } catch (e) { return Promise.reject(e).then(res, rej); }
  }
  private match() { return this.db.t(this.table).filter((r) => this.filters.every((f) => f(r))); }
  private run() {
    const rows = this.db.t(this.table);
    const now = new Date().toISOString();
    if (this.op === "insert" || this.op === "upsert") {
      const list: Row[] = (Array.isArray(this.payload) ? this.payload : [this.payload!]).map((p) => ({ id: this.db.id(), created_at: now, ...p }));
      const out: Row[] = [];
      for (const r of list) {
        const key = this.upsertOpts.onConflict;
        const clash = key ? rows.find((x) => key.split(",").every((k) => x[k] === r[k])) : rows.find((x) => this.db.unique[this.table]?.(x, r));
        if (clash) {
          if (this.op === "upsert" && this.upsertOpts.ignoreDuplicates) continue;
          if (this.op === "upsert") { Object.assign(clash, r); out.push(clash); continue; }
          return { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } };
        }
        rows.push(r); out.push(r);
      }
      return { data: this.returning ? out : null, error: null };
    }
    if (this.op === "update") {
      const hit = this.match();
      for (const r of hit) Object.assign(r, this.payload, { updated_at: now });
      return { data: this.returning ? hit : null, error: null };
    }
    let hit = this.match();
    for (const o of [...this.orders].reverse()) hit = [...hit].sort((a, b) => (o.asc ? cmp(a[o.col], b[o.col]) : -cmp(a[o.col], b[o.col])));
    hit = hit.slice(0, this.lim);
    if (this.countMode) return { data: this.head ? null : hit, count: hit.length, error: null };
    if (this.single) return { data: hit[0] ?? null, error: null };
    return { data: hit, error: null };
  }
}
