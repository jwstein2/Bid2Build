/** "Export everything": every section is included, pages past PostgREST's 1,000-row cap, secrets are stripped. */
import { describe, expect, it } from "vitest";
import { buildExport, EXPORT_TABLES, readTable, stripSecrets, type ExportClient } from "@/lib/account/export";

type Rows = Record<string, Record<string, unknown>[]>;
function fakeClient(tables: Rows, opts: { noId?: string[]; missing?: string[] } = {}): ExportClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    from: (t: string) => ({
      select: () => {
        let ordered = false;
        const q = {
          order: () => { ordered = true; return q; },
          range: async (from: number, to: number) => {
            calls.push(`${t}:${from}-${to}${ordered ? ":id" : ""}`);
            if (opts.missing?.includes(t)) return { data: null, error: { code: "42P01", message: "missing" } };
            if (ordered && opts.noId?.includes(t)) return { data: null, error: { code: "42703", message: "no id" } };
            return { data: (tables[t] ?? []).slice(from, to + 1), error: null };
          },
        };
        return q;
      },
    }),
  };
}

describe("account export", () => {
  it("covers projects, schedules, change orders, signatures, customer hub and company data", () => {
    for (const t of ["project_schedules", "schedule_tasks", "change_orders", "change_order_signatures", "signing_requests", "signatures", "customers", "comm_messages", "companies", "company_members", "estimates"]) {
      expect(EXPORT_TABLES).toContain(t);
    }
    expect(new Set(EXPORT_TABLES).size).toBe(EXPORT_TABLES.length);
  });

  it("removes link and reply tokens but keeps everything else", () => {
    expect(stripSecrets({ id: 1, token_hash: "a", invite_token_hash: "b", reply_token: "c", inbound_test_token: "d", input_tokens: 5, token_version: 2, title: "x" }))
      .toEqual({ id: 1, input_tokens: 5, token_version: 2, title: "x" });
  });

  it("reads past 1,000 rows and falls back when a table has no id column", async () => {
    const many = Array.from({ length: 2500 }, (_, i) => ({ id: i }));
    const c = fakeClient({ estimates: many, business_profiles: [{ user_id: "u1" }] }, { noId: ["business_profiles"] });
    expect((await readTable(c, "estimates")).rows).toHaveLength(2500);
    expect((await readTable(c, "business_profiles")).rows).toEqual([{ user_id: "u1" }]);
  });

  it("a missing table is empty, not a failed export", async () => {
    const out = await buildExport(fakeClient({ change_orders: [{ id: "co1", title: "Extra rail" }] }, { missing: ["comm_events"] }), { id: "u1", email: "a@b.test" }, new Date("2026-11-17T00:00:00Z"));
    expect(out.change_orders).toEqual([{ id: "co1", title: "Extra rail" }]);
    expect(out.comm_events).toEqual([]);
    expect((out.row_counts as Record<string, number>).change_orders).toBe(1);
    expect(out.account).toEqual({ id: "u1", email: "a@b.test" });
  });
});
