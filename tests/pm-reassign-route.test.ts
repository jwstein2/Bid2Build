/** V4 Phase 9: the seat reassignment API maps database refusals to clear messages and never bills. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const S = { calls: [] as { name: string; args: unknown }[], error: null as null | { message: string } };
vi.mock("@/lib/supabase/server", () => ({
  getUser: async () => ({ id: "u1" }),
  createClient: async () => ({ rpc: async (name: string, args: unknown) => { S.calls.push({ name, args }); return S.error ? { data: null, error: S.error } : { data: { ok: true }, error: null }; } }),
}));
vi.mock("@/lib/http/api", async (orig) => ({ ...(await orig<typeof import("@/lib/http/api")>()), rateLimit: async () => true, sameOrigin: async () => true }));
process.env.NEXT_PUBLIC_PROJECT_SCHEDULING = "on";
const { POST } = await import("@/app/api/company/pm-editors/reassign/route");
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const call = (body: unknown) => POST(new Request("http://localhost/api/company/pm-editors/reassign", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => { S.calls = []; S.error = null; });

describe("seat reassignment API", () => {
  it("moves the seat with one database call (no Stripe, no seat purchase)", async () => {
    const r = await call({ from: A, to: B });
    expect(r.status).toBe(200);
    expect(S.calls).toEqual([{ name: "company_pm_reassign", args: { p_from: A, p_to: B } }]);
  });
  it("rejects bad input and maps refusals", async () => {
    expect((await call({ from: A })).status).toBe(400);
    expect((await call({ from: A, to: B, extra: 1 })).status).toBe(400);
    for (const [code, status] of [["forbidden", 403], ["already_editor", 409], ["not_member", 404], ["not_editor", 409], ["same_user", 400]] as const) {
      S.error = { message: code };
      const r = await call({ from: A, to: B });
      expect(r.status, code).toBe(status);
      expect((await r.json()).error.code).toBe(code);
    }
  });
});
