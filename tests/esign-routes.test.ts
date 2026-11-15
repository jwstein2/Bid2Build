/**
 * E-signature endpoints with a fake database: Create Signing Link shares the export's finalize path
 * (no extra credit for an unchanged proposal, readiness before any credit), only the owner can
 * create links, and Accept & Sign validates on the server, records server-built consent wording,
 * and keeps the signature when the signed PDF fails.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultBusinessProfile, defaultProposalConfig } from "@/lib/proposal/types";
import { CONSENT_VERSION } from "@/lib/esign/config";
import { est, item } from "./helpers";

process.env.NEXT_PUBLIC_ESIGNATURES = "on";

const state = {
  estimate: est({ title: "Smith deck", expirationDate: "2099-01-01", customer: { name: "Pat Smith", projectAddress: "48 Oak Lane" }, items: [item("g1", "10", "20")] }),
  owned: true,
  versions: new Map<string, number>(),
  charged: 0,
  rpc: [] as { name: string; args: Record<string, unknown> }[],
  acceptError: null as string | null,
  request: null as null | Record<string, unknown>,
  pdfOk: true,
  uploads: [] as string[],
};

const admin = {
  rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
    state.rpc.push({ name, args });
    if (name === "finalize_bid") {
      const hash = String(args.p_content_hash);
      const existing = state.versions.get(hash);
      const charged = state.charged === 0 && existing === undefined;
      if (charged) state.charged++;
      const n = existing ?? state.versions.size + 1;
      state.versions.set(hash, n);
      return { data: { version_id: `v${n}`, version_number: n, new_version: existing === undefined, charged, credit_source: charged ? "starter" : existing ? "existing_version" : "already_counted", starter_balance: 2, monthly_balance: 0, unlimited: false, next_cycle_at: "2026-12-01" }, error: null };
    }
    if (name === "create_signing_request") return { data: { id: "req-1", expires_at: args.p_expires_at, created_at: new Date().toISOString() }, error: null };
    if (name === "accept_signing_request") {
      if (state.acceptError) return { data: null, error: { message: state.acceptError } };
      return { data: [{ signature_id: "sig-1", created: true, request_id: "req-1" }], error: null };
    }
    return { data: null, error: null };
  }),
  storage: { from: () => ({ download: async () => ({ data: null }), upload: async (p: string) => { state.uploads.push(p); return { error: null }; }, createSignedUrl: async () => ({ data: { signedUrl: "https://storage.test/signed" } }) }) },
  from: () => ({ insert: async () => ({ error: null }), upsert: async () => ({ error: null }) }),
};

// Minimal RLS-client fake: the ownership check in the signing route.
const userClient = {
  from: () => {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: state.owned ? { id: "e1", status: state.estimate.status, expiration_date: state.estimate.expirationDate } : null }) };
    return q;
  },
};

vi.mock("@/lib/supabase/server", () => ({
  getUser: async () => ({ id: "u1", email: "c@x.test", emailVerified: true, verified: true }),
  createClient: async () => userClient,
  createAdminClient: () => admin,
}));
vi.mock("@/lib/data/server", () => ({
  loadEstimate: async () => ({ estimate: state.estimate, proposalConfig: defaultProposalConfig() }),
  loadBusiness: async () => ({ business: { ...defaultBusinessProfile(), companyName: "Acme Decks" } }),
}));
vi.mock("@/lib/pdf/render", () => ({ renderProposalPdf: async () => Buffer.from("%PDF-1.7 test"), pdfFilename: () => "Acme.pdf" }));
vi.mock("@/lib/market/server", () => ({ captureObservation: async () => {} }));
vi.mock("@/lib/http/api", async (orig) => ({ ...(await orig<typeof import("@/lib/http/api")>()), sameOrigin: async () => true, rateLimit: async () => true }));
vi.mock("@/lib/esign/server", async (orig) => ({
  ...(await orig<typeof import("@/lib/esign/server")>()),
  loadRequestByToken: async () => state.request,
  requestEvidence: async () => ({ ip: "203.0.113.9", userAgent: "test" }),
  ensureSignedPdf: async () => (state.pdfOk ? { ok: true, path: "p", filename: "f" } : { ok: false }),
}));

const { POST: exportPOST } = await import("@/app/api/estimates/[id]/export/route");
const { POST: signingPOST } = await import("@/app/api/estimates/[id]/signing/route");
const { POST: acceptPOST } = await import("@/app/api/sign/[token]/route");

const EID = "00000000-0000-4000-8000-000000000001";
const TOKEN = "A".repeat(43);
const json = async (r: Response) => ({ status: r.status, body: await r.json() });
const doExport = async () => json(await exportPOST(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ id: EID }) } as never));
const doSigning = async () => json(await signingPOST(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ id: EID }) } as never));
const doAccept = async (body: unknown, token = TOKEN) => json(await acceptPOST(new Request("http://x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), { params: Promise.resolve({ token }) } as never));

const doc = { brand: { companyName: "Acme Decks", contact: [] }, meta: { title: "Smith deck", number: "1042" }, customer: { name: "Pat Smith" }, pricing: { total: "$250.00" } };
const goodSign = { signerName: "Pat Smith", signerEmail: "pat@example.com", method: "typed", signatureText: "Pat Smith", consent: true, accept: true, consentVersion: CONSENT_VERSION };

beforeEach(() => {
  state.estimate = est({ title: "Smith deck", expirationDate: "2099-01-01", customer: { name: "Pat Smith", projectAddress: "48 Oak Lane" }, items: [item("g1", "10", "20")] });
  state.owned = true; state.versions.clear(); state.charged = 0; state.rpc = []; state.acceptError = null; state.pdfOk = true; state.uploads = [];
  state.request = { id: "req-1", estimateId: EID, userId: "u1", status: "pending", phase: "open", expiresAt: "2099-01-01T00:00:00Z", doc, versionNumber: 1 };
});

describe("Create Signing Link", () => {
  it("uses the same finalize path: downloading, then creating links, spends one credit in total", async () => {
    expect((await doExport()).body.charged).toBe(true);
    const a = await doSigning();
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ charged: false, versionNumber: 1, requestId: "req-1" });
    expect(a.body.url).toMatch(/\/sign\/[A-Za-z0-9_-]{43}$/);
    const b = await doSigning();
    expect(b.body.charged).toBe(false);
    expect(b.body.url).not.toBe(a.body.url);
    expect(state.charged).toBe(1);
    // The token itself never reaches the database: only a 64-hex hash.
    const created = state.rpc.filter((c) => c.name === "create_signing_request");
    expect(created).toHaveLength(2);
    for (const c of created) {
      expect(String(c.args.p_token_hash)).toMatch(/^[0-9a-f]{64}$/);
      expect(a.body.url).not.toContain(String(c.args.p_token_hash));
      expect(String(c.args.p_document_hash)).toMatch(/^[0-9a-f]{64}$/);
    }
    // The exact PDF under review is stored under a write-once path per request.
    expect(state.uploads).toContain(`u1/${EID}/signing/req-1.pdf`);
  });
  it("refuses incomplete proposals before any credit or link", async () => {
    state.estimate = { ...state.estimate, customer: { name: "Pat Smith" } };
    const r = await doSigning();
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("not_ready");
    expect(state.rpc).toHaveLength(0);
  });
  it("refuses a proposal whose expiration date has passed", async () => {
    state.estimate = { ...state.estimate, expirationDate: "2020-01-01" };
    const r = await doSigning();
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("proposal_expired");
    expect(state.rpc).toHaveLength(0);
  });
  it("only the bid's owner can create a link (a teammate who can view it can't)", async () => {
    state.owned = false;
    expect((await doSigning()).status).toBe(404);
    expect(state.rpc).toHaveLength(0);
  });
  it("is hidden when the feature flag is off", async () => {
    process.env.NEXT_PUBLIC_ESIGNATURES = "off";
    try { expect((await doSigning()).status).toBe(404); } finally { process.env.NEXT_PUBLIC_ESIGNATURES = "on"; }
  });
});

describe("Accept & Sign", () => {
  it("records the signature with server-built consent and acceptance wording", async () => {
    const r = await doAccept(goodSign);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ signed: true, signatureId: "sig-1", pdfReady: true });
    const call = state.rpc.find((c) => c.name === "accept_signing_request")!.args;
    expect(call.p_consent_text).toMatch(/Acme Decks/);
    expect(call.p_acceptance_text).toMatch(/\$250\.00/);
    expect(call.p_consent_version).toBe(CONSENT_VERSION);
    expect(call.p_ip).toBe("203.0.113.9");
    expect(String(call.p_token_hash)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("keeps the signature when the signed PDF can't be created", async () => {
    state.pdfOk = false;
    const r = await doAccept(goodSign);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ signed: true, pdfReady: false });
  });
  it("refuses missing consent, a mismatched typed signature, and stale consent wording", async () => {
    expect((await doAccept({ ...goodSign, consent: false })).status).toBe(422);
    expect((await doAccept({ ...goodSign, accept: undefined })).status).toBe(422);
    expect((await doAccept({ ...goodSign, signatureText: "Someone Else" })).body.error.field).toBe("signatureText");
    expect((await doAccept({ ...goodSign, consentVersion: "old" })).status).toBe(409);
    expect(state.rpc).toHaveLength(0);
  });
  it("bad, expired, revoked and already-signed links", async () => {
    expect((await doAccept(goodSign, "short")).status).toBe(404);
    state.request = null;
    expect((await doAccept(goodSign)).status).toBe(404);
    state.request = { id: "r", phase: "expired", doc };
    expect((await doAccept(goodSign)).body.error.code).toBe("link_expired");
    state.request = { id: "r", phase: "revoked", doc };
    expect((await doAccept(goodSign)).body.error.code).toBe("link_revoked");
    state.request = { id: "r", phase: "open", doc };
    state.acceptError = "already_signed";
    expect((await doAccept(goodSign)).status).toBe(409);
  });
});
