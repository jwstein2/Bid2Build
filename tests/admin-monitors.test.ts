import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; vi.unstubAllGlobals(); });

describe("provider monitors", () => {
  it("stay Not connected and make no request when their variable is unset", async () => {
    delete process.env.NETLIFY_API_TOKEN; delete process.env.SUPABASE_MANAGEMENT_TOKEN; delete process.env.ANTHROPIC_ADMIN_KEY;
    const fetchSpy = vi.fn(); vi.stubGlobal("fetch", fetchSpy);
    const m = await import("@/lib/admin/monitors");
    expect((await m.netlifyUsage()).state).toBe("not_connected");
    expect((await m.supabaseUsage()).state).toBe("not_connected");
    expect((await m.anthropicCost(new Date("2026-11-15T12:00:00Z"))).state).toBe("not_connected");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports a rejected token by status only, never the token", async () => {
    process.env.NETLIFY_API_TOKEN = "nfp_secret_value";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    const { netlifyUsage } = await import("@/lib/admin/monitors");
    const r = await netlifyUsage();
    expect(r.state).toBe("error");
    expect(JSON.stringify(r)).not.toContain("nfp_secret_value");
  });

  it("reads Netlify plan and build minutes with GET requests", async () => {
    process.env.NETLIFY_API_TOKEN = "t"; delete process.env.NETLIFY_ACCOUNT_ID;
    const calls: { url: string; method?: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method });
      if (url.endsWith("/accounts")) return Response.json([{ id: "acc1", name: "Team", type_name: "Personal", billing_period: "monthly" }]);
      return Response.json([{ minutes: { current: 120, included_minutes: "300", period_end_date: "2026-12-01T00:00:00Z" } }]);
    }));
    const { netlifyUsage } = await import("@/lib/admin/monitors");
    const r = await netlifyUsage();
    expect(r.state).toBe("ok");
    if (r.state === "ok") expect(r.data).toMatchObject({ plan: "Personal", buildMinutes: { used: 120, included: 300 } });
    expect(calls.every((c) => !c.method || c.method === "GET")).toBe(true);
  });

  it("sums Supabase request counts and finds the project ref", async () => {
    const { sumCounts, projectRef } = await import("@/lib/admin/monitors");
    expect(projectRef("https://asiiqmegvajtuspeumio.supabase.co")).toBe("asiiqmegvajtuspeumio");
    expect(projectRef("https://example.com")).toBeNull();
    const rows = sumCounts({ result: [{ timestamp: 1, total_rest_requests: 5, total_auth_requests: 2 }, { timestamp: 2, total_rest_requests: "3" }] });
    expect(rows).toEqual([{ label: "rest requests", count: 8 }, { label: "auth requests", count: 2 }]);
    expect(sumCounts(null)).toEqual([]);
  });

  it("lists advertising setup without calling any API", async () => {
    delete process.env.META_ADS_ACCESS_TOKEN;
    const { adsSetup } = await import("@/lib/admin/monitors");
    const meta = adsSetup().find((a) => a.key === "meta-ads")!;
    expect(meta.missing).toContain("META_ADS_ACCESS_TOKEN");
  });
});
