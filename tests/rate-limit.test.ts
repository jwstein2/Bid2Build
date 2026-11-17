import { beforeEach, describe, expect, it, vi } from "vitest";

// Durable rate limiter (platform audit): memory first, then the shared Supabase counter; never fails closed.
const rpc = vi.fn();
vi.mock("next/headers", () => ({ headers: async () => new Map([["x-forwarded-for", "203.0.113.9"]]) }));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => ({ rpc }) }));

async function load() {
  vi.resetModules();
  return (await import("@/lib/http/api")).rateLimit;
}

describe("rateLimit", () => {
  beforeEach(() => { rpc.mockReset(); process.env.SUPABASE_SECRET_KEY = "test"; });

  it("asks the shared counter with a hashed key (no raw IP) and obeys its answer", async () => {
    const rateLimit = await load();
    rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: false, error: null });
    expect(await rateLimit("auth", 5, 60_000)).toBe(true);
    expect(await rateLimit("auth", 5, 60_000)).toBe(false);
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe("rate_limit_hit");
    expect(args.p_key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(args)).not.toContain("203.0.113.9");
    expect(args).toMatchObject({ p_limit: 5, p_window_seconds: 60 });
  });

  it("the in-memory limit still blocks a burst without a database call", async () => {
    const rateLimit = await load();
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await rateLimit("burst", 1, 60_000)).toBe(true);
    expect(await rateLimit("burst", 1, 60_000)).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("falls back to memory before the SQL is applied, and stops asking", async () => {
    const rateLimit = await load();
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "not found" } });
    expect(await rateLimit("x", 3, 60_000)).toBe(true);
    expect(await rateLimit("x", 3, 60_000)).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("a database outage never locks people out", async () => {
    const rateLimit = await load();
    rpc.mockRejectedValue(new Error("network"));
    expect(await rateLimit("y", 3, 60_000)).toBe(true);
  });
});
