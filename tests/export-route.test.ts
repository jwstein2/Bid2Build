/**
 * The export endpoint (Download PDF and Send via My Email): readiness is checked before any bid credit
 * can be spent, both actions go through the same finalize_bid call, and "bytes" delivery returns the
 * PDF for the share sheet. Fake database, no network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultBusinessProfile, defaultProposalConfig } from "@/lib/proposal/types";
import { est, item } from "./helpers";

const state = {
  estimate: est({ title: "Smith deck", customer: { name: "Pat Smith", projectAddress: "48 Oak Lane" }, items: [item("g1", "10", "20")] }),
  business: { ...defaultBusinessProfile(), companyName: "Acme Decks" },
  finalizeCalls: [] as Record<string, unknown>[],
  versions: new Map<string, number>(),
  charged: 0,
};

const admin = {
  rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name !== "finalize_bid") return { data: null, error: null };
    state.finalizeCalls.push(args);
    // Mirrors finalize_bid's rule: an unchanged version (same content hash) is never charged again.
    const hash = String(args.p_content_hash);
    const existing = state.versions.get(hash);
    const charged = state.charged === 0 && existing === undefined;
    if (charged) state.charged++;
    const n = existing ?? state.versions.size + 1;
    state.versions.set(hash, n);
    return { data: { version_id: `v${n}`, version_number: n, new_version: existing === undefined, charged, credit_source: charged ? "starter" : "none", starter_balance: 2, monthly_balance: 0, unlimited: false, next_cycle_at: "2026-12-01" }, error: null };
  }),
  storage: { from: () => ({ download: async () => ({ data: null }), upload: async () => ({ error: null }), createSignedUrl: async () => ({ data: { signedUrl: "https://storage.test/signed" } }) }) },
  from: () => ({ insert: async () => ({ error: null }), upsert: async () => ({ error: null }) }),
};

vi.mock("@/lib/supabase/server", () => ({
  getUser: async () => ({ id: "u1", email: "c@x.test", emailVerified: true, verified: true }),
  createClient: async () => ({}),
  createAdminClient: () => admin,
}));
vi.mock("@/lib/data/server", () => ({
  loadEstimate: async () => ({ estimate: state.estimate, proposalConfig: defaultProposalConfig() }),
  loadBusiness: async () => ({ business: state.business }),
}));
vi.mock("@/lib/pdf/render", () => ({ renderProposalPdf: async () => Buffer.from("%PDF-1.7 test"), pdfFilename: () => "Acme-Decks-Proposal.pdf" }));
vi.mock("@/lib/market/server", () => ({ captureObservation: async () => {} }));
vi.mock("@/lib/http/api", async (orig) => ({ ...(await orig<typeof import("@/lib/http/api")>()), sameOrigin: async () => true, rateLimit: async () => true }));

const { POST } = await import("@/app/api/estimates/[id]/export/route");
const call = async (body?: unknown) => {
  const r = await POST(new Request("http://localhost/api/estimates/e1/export", { method: "POST", ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) }), { params: Promise.resolve({ id: "e1" }) } as never);
  return { status: r.status, body: await r.json() };
};

beforeEach(() => {
  state.estimate = est({ title: "Smith deck", customer: { name: "Pat Smith", projectAddress: "48 Oak Lane" }, items: [item("g1", "10", "20")] });
  state.business = { ...defaultBusinessProfile(), companyName: "Acme Decks" };
  state.finalizeCalls = []; state.versions.clear(); state.charged = 0;
});

describe("POST /api/estimates/[id]/export", () => {
  it("refuses a proposal with missing required details before spending a credit", async () => {
    state.estimate = { ...state.estimate, customer: { name: "Pat Smith" } };
    const r = await call();
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("not_ready");
    expect(r.body.error.message).toBe("Add a project address before downloading this proposal.");
    expect(r.body.error.missing[0]).toMatchObject({ code: "project_address", step: "project", fieldId: "c-addr" });
    expect(state.finalizeCalls).toHaveLength(0);
  });
  it("refuses a missing company name and a $0 estimate", async () => {
    state.business = { ...state.business, companyName: "" };
    expect((await call()).body.error.missing.map((m: { code: string }) => m.code)).toEqual(["company_name"]);
    state.business = { ...state.business, companyName: "Acme" };
    state.estimate = { ...state.estimate, items: [item("g1", "10", "0")] };
    expect((await call()).body.error.code).toBe("not_ready");
    expect(state.finalizeCalls).toHaveLength(0);
  });
  it("Download PDF returns a short-lived link, not the bytes", async () => {
    const r = await call();
    expect(r.status).toBe(200);
    expect(r.body.url).toBe("https://storage.test/signed");
    expect(r.body.pdfBase64).toBeUndefined();
  });
  it("Send via My Email gets the bytes through the same finalize step", async () => {
    const r = await call({ deliver: "bytes" });
    expect(r.status).toBe(200);
    expect(Buffer.from(r.body.pdfBase64, "base64").toString()).toBe("%PDF-1.7 test");
    expect(r.body.filename).toBe("Acme-Decks-Proposal.pdf");
    expect(state.finalizeCalls).toHaveLength(1);
  });
  it("switching from Download to Send for an unchanged proposal reuses the version and charges nothing", async () => {
    const a = await call();
    const b = await call({ deliver: "bytes" });
    const c = await call({ deliver: "bytes" });
    expect(a.body.charged).toBe(true);
    expect([b.body.charged, c.body.charged]).toEqual([false, false]);
    expect(new Set([a.body.versionNumber, b.body.versionNumber, c.body.versionNumber]).size).toBe(1);
    expect(state.finalizeCalls[0].p_content_hash).toBe(state.finalizeCalls[1].p_content_hash);
  });
  it("ignores unknown delivery values", async () => {
    expect((await call({ deliver: "email-it-for-me" })).body.pdfBase64).toBeUndefined();
  });
});
