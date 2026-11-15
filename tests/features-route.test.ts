/**
 * /api/features: entitlement always comes from library_access() on the server, the first read stores
 * a starting state, and writes can only acknowledge, mark a notice seen or record the walkthrough.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { META_KEY } from "@/lib/features/state";

const S = {
  user: null as null | { id: string; created_at: string; user_metadata: Record<string, unknown> },
  premium: false,
  updates: [] as Record<string, unknown>[],
  updateError: null as null | { message: string },
};
const supabase = {
  auth: {
    getUser: async () => ({ data: { user: S.user }, error: S.user ? null : { message: "no session" } }),
    updateUser: async ({ data }: { data: Record<string, unknown> }) => {
      S.updates.push(data);
      if (!S.updateError && S.user) S.user.user_metadata = { ...S.user.user_metadata, ...data };
      return { error: S.updateError };
    },
  },
  rpc: async (name: string) => ({ data: name === "library_access" ? S.premium : null, error: null }),
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => supabase }));
vi.mock("@/lib/env", async (orig) => ({ ...(await orig<typeof import("@/lib/env")>()), isSupabaseConfigured: () => true }));
vi.mock("@/lib/http/api", async (orig) => ({ ...(await orig<typeof import("@/lib/http/api")>()), sameOrigin: async () => true }));

const { GET, POST } = await import("@/app/api/features/route");
const post = (body: unknown) => POST(new Request("http://localhost/api/features", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  S.user = { id: "u1", created_at: "2026-06-01T00:00:00Z", user_metadata: { full_name: "Pat" } };
  S.premium = false; S.updates = []; S.updateError = null;
});

describe("features route", () => {
  it("signed out: nothing", async () => {
    S.user = null;
    expect(await (await GET()).json()).toEqual({ signedIn: false });
  });
  it("first read stores the starting state without touching other metadata", async () => {
    S.premium = true;
    const j = await (await GET()).json();
    expect(j).toMatchObject({ signedIn: true, known: true, access: { unlimited: true } });
    expect(j.state.acked.sort()).toEqual(["library", "templates"]);
    expect(S.updates).toHaveLength(1);
    expect(S.user!.user_metadata.full_name).toBe("Pat");
    await GET();
    expect(S.updates).toHaveLength(1); // not rewritten on later reads
  });
  it("access comes from the server, never from stored state", async () => {
    S.user!.user_metadata[META_KEY] = { v: 1, acked: [], notice: null, tour: null, unlimited: true };
    expect((await (await GET()).json()).access.unlimited).toBe(false);
  });
  it("can't save: known=false so nothing opens automatically", async () => {
    S.updateError = { message: "down" };
    expect((await (await GET()).json()).known).toBe(false);
  });
  it("POST acknowledges, records notice and tour; rejects anything else", async () => {
    expect((await post({ ack: ["internal_report", "bogus"] })).status).toBe(200);
    expect((S.user!.user_metadata[META_KEY] as { acked: string[] }).acked).toEqual(["internal_report"]);
    expect((await post({ tour: "completed" })).status).toBe(200);
    expect((await post({ unlimited: true })).status).toBe(400);
    expect((await post({ tour: "hacked" })).status).toBe(400);
    S.user = null;
    expect((await post({ tour: "completed" })).status).toBe(401);
  });
});
