/**
 * Internal report endpoint authorization, enforced server-side on every request: free accounts get
 * 402, company members without cost + margin + internal-report permissions get 403, download and send
 * are separate permissions, other users' bids are not found.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { est, item } from "./helpers";

const S = {
  user: { id: "u1" } as { id: string } | null,
  estimateRow: { id: "e1", user_id: "u1", company_id: null as string | null } as Record<string, unknown> | null,
  premium: true,
  company: null as null | { id: string; permissions: string[] },
  logged: [] as Record<string, unknown>[],
};
const chain = (result: () => unknown) => {
  const c: Record<string, unknown> = {};
  for (const k of ["select", "eq", "order", "limit"]) c[k] = () => c;
  c.maybeSingle = async () => ({ data: result(), error: null });
  return c;
};
const supabase = {
  from: (t: string) => chain(() => (t === "estimates" ? S.estimateRow : null)),
  rpc: async (name: string) => ({ data: name === "library_access" ? S.premium : name === "my_company" ? S.company : null, error: null }),
};
vi.mock("@/lib/supabase/server", () => ({
  getUser: async () => S.user,
  createClient: async () => supabase,
  createAdminClient: () => ({ from: (t: string) => Object.assign(chain(() => ({ company_name: "Acme Decks" })), { insert: async (row: Record<string, unknown>) => { S.logged.push({ table: t, ...row }); return { error: null }; } }), storage: { from: () => ({ download: async () => ({ data: null }) }) } }),
}));
vi.mock("@/lib/data/server", () => ({ loadEstimate: async () => ({ estimate: est({ items: [item("g1", "2", "41.17")] }) }) }));
vi.mock("@/lib/http/api", async (orig) => ({ ...(await orig<typeof import("@/lib/http/api")>()), rateLimit: async () => true }));

const { GET } = await import("@/app/api/estimates/[id]/internal-report/route");
const ID = "11111111-1111-4111-8111-111111111111";
const call = (q = "") => GET(new Request(`http://localhost/api/estimates/${ID}/internal-report${q}`), { params: Promise.resolve({ id: ID }) } as never);

beforeEach(() => { S.user = { id: "u1" }; S.estimateRow = { id: ID, user_id: "u1", company_id: null }; S.premium = true; S.company = null; S.logged = []; });

describe("internal report route", () => {
  it("paid owner gets a private, uncached PDF", async () => {
    const r = await call("?download=1");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/pdf");
    expect(r.headers.get("cache-control")).toMatch(/no-store/);
    expect(r.headers.get("content-disposition")).toMatch(/^attachment; filename="INTERNAL_/);
    expect((await call()).headers.get("content-disposition")).toMatch(/^inline/);
  }, 30_000);
  it("free users can't generate it (402) and the check says why", async () => {
    S.premium = false;
    expect((await call()).status).toBe(402);
    expect(await (await call("?check=1")).json()).toMatchObject({ allowed: false, code: "upgrade_required" });
  });
  it("signed-out and other users' bids are refused", async () => {
    S.user = null;
    expect((await call()).status).toBe(401);
    S.user = { id: "u2" };
    expect((await call()).status).toBe(404);
    S.estimateRow = null;
    expect((await call()).status).toBe(404);
  });
  it("company bids need both cost and margin permissions", async () => {
    S.estimateRow = { id: ID, user_id: "u9", company_id: "c1" };
    S.company = { id: "c1", permissions: ["view_own_bids", "view_costs"] };
    expect((await call()).status).toBe(403);
    expect((await call("?download=1")).status).toBe(403);
    S.company = { id: "c2", permissions: ["view_costs", "view_margin"] };
    expect((await call()).status).toBe(403);
    S.company = { id: "c1", permissions: ["view_costs", "view_margin"] };
    expect((await call()).status).toBe(403); // Phase 9: View internal reports is its own permission
    S.company = { id: "c1", permissions: ["view_costs", "view_margin", "view_internal_reports"] };
    expect((await call()).status).toBe(200);
  }, 30_000);
  it("downloading and sending are separate permissions on company bids (Phase 9)", async () => {
    S.estimateRow = { id: ID, user_id: "u9", company_id: "c1" };
    S.company = { id: "c1", permissions: ["view_costs", "view_margin", "view_internal_reports"] };
    expect(await (await call("?check=1")).json()).toEqual({ allowed: true, canDownload: false, canSend: false });
    expect((await call("?download=1")).status).toBe(403);
    expect((await call("?download=1&purpose=send")).status).toBe(403);
    S.company.permissions.push("download_internal_reports");
    expect((await call("?download=1")).status).toBe(200);
    expect((await call("?download=1&purpose=send")).status).toBe(403);
    S.company.permissions.push("send_internal_reports");
    expect((await call("?download=1&purpose=send")).status).toBe(200);
  }, 30_000);
  it("logs who generated a report and how, never its contents (owner analytics)", async () => {
    await call("?download=1");
    await call("?download=1&purpose=send");
    await call("?check=1");
    expect(S.logged).toEqual([
      { table: "report_generations", user_id: "u1", company_id: null, kind: "internal_estimate", action: "download" },
      { table: "report_generations", user_id: "u1", company_id: null, kind: "internal_estimate", action: "send" },
    ]);
  }, 30_000);
  it("the check response never contains financial data", async () => {
    const body = await (await call("?check=1")).text();
    expect(body).toBe('{"allowed":true,"canDownload":true,"canSend":true}');
  });
});
